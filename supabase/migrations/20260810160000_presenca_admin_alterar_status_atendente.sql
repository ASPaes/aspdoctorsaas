-- DEM-0194: admin altera o status de presenca de qualquer atendente
--
-- Problema: atendente que fecha o navegador sem "Encerrar expediente" fica com
-- support_agent_presence.status = 'active' e continua recebendo distribuicao.
-- fn_assign_conversation_if_ready exige exatamente `pr.status = 'active'` (ver
-- 20260806170000_distribuicao_pool_restrito_ao_setor.sql:204), entao enquanto
-- ninguem mexer na linha o operador offline segue no pool.
--
-- Hoje as 5 RPCs de presenca (agent_presence_set_active / set_pause /
-- extend_pause / set_off / set_off_release_queue) escrevem SEMPRE em
-- `user_id = auth.uid()`. Nao existe caminho para um gestor corrigir a linha de
-- outra pessoa — nem pelo app, nem por RLS.
--
-- Esta funcao e o unico caminho autorizado para escrever presenca de terceiro.
--
-- Decisoes:
--
-- 1) SO 'active' e 'offline'. 'paused' exigiria motivo (support_pause_reasons) e
--    prazo, e nao resolve o problema do DEM — quem pausa alguem esta gerindo a
--    pausa daquela pessoa, nao consertando sessao fantasma. Fica de fora ate
--    alguem pedir. O caminho paused -> active ("Ocupado -> Disponivel" do DEM)
--    esta coberto: e p_status = 'active'.
--
-- 2) NAO toca em support_attendances. Requisito nao-funcional explicito do DEM:
--    nenhum impacto nos atendimentos em andamento. E o contrario de
--    agent_presence_set_off_release_queue, que devolve tudo para a fila — aquele
--    e o operador decidindo sobre os proprios chats; aqui e um terceiro. Os
--    atendimentos ficam com o dono; o que para e a distribuicao de conversa NOVA.
--
-- 3) Auditoria em support_agent_presence_events (tabela que ja existe e ja e o
--    extrato de presenca). event_type novo, `changed_by` no payload — a coluna
--    user_id continua sendo o ATENDIDO, senao o extrato dele ficaria com buraco.
--
-- 4) Idempotente: status igual ao atual retorna changed=false sem gravar evento,
--    para dois cliques nao virarem duas linhas de auditoria.

CREATE OR REPLACE FUNCTION public.agent_presence_admin_set_status(
  p_tenant_id uuid,
  p_user_id   uuid,
  p_status    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor      uuid := auth.uid();
  v_old_status text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_status NOT IN ('active', 'offline') THEN
    RAISE EXCEPTION 'Status invalido: % (esperado active ou offline)', p_status;
  END IF;

  -- Mesmo teste de permissao das outras RPCs de gestao (omie_fila_descartar,
  -- omie_fila_status_por_conta): super admin OU admin/head DO TENANT ALVO.
  -- p.tenant_id = p_tenant_id e o que impede admin de um tenant de mexer em
  -- atendente de outro quando o front manda um tenant que nao e o dele.
  IF NOT (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = v_actor
        AND p.tenant_id = p_tenant_id
        AND p.role IN ('admin', 'head')
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissao para alterar o status de atendentes deste tenant.';
  END IF;

  -- FOR UPDATE: o proprio atendente pode estar clicando em Pausar no mesmo
  -- instante. Sem o lock, o UPDATE dele poderia sobrescrever o do gestor depois
  -- da leitura e o evento gravado registraria um status anterior que nunca foi.
  SELECT status INTO v_old_status
  FROM public.support_agent_presence
  WHERE tenant_id = p_tenant_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Linha de presenca so nasce no primeiro "Iniciar expediente"
    -- (agent_presence_set_active). Quem nunca iniciou nao esta no pool de
    -- distribuicao e nao aparece na lista da equipe — nao ha o que corrigir.
    RAISE EXCEPTION 'Atendente sem registro de presenca neste tenant.';
  END IF;

  IF v_old_status = p_status THEN
    RETURN jsonb_build_object(
      'changed', false,
      'old_status', v_old_status,
      'new_status', p_status
    );
  END IF;

  IF p_status = 'offline' THEN
    UPDATE public.support_agent_presence SET
      status                = 'offline',
      shift_ended_at        = now(),
      pause_reason_id       = NULL,
      pause_started_at      = NULL,
      pause_expected_end_at = NULL,
      updated_at            = now()
    WHERE tenant_id = p_tenant_id AND user_id = p_user_id;
  ELSE
    UPDATE public.support_agent_presence SET
      status = 'active',
      -- Difere de agent_presence_set_active de proposito. La e COALESCE puro, o
      -- que faz um expediente reaberto herdar o shift_started_at do expediente
      -- anterior ja encerrado. Aqui, se o turno estava fechado (shift_ended_at
      -- preenchido), isto e um turno NOVO e o relogio recomeca — senao o painel
      -- da equipe mostraria "em expediente desde 08:00" para quem o gestor
      -- religou as 20:00.
      shift_started_at = CASE
        WHEN shift_ended_at IS NOT NULL OR shift_started_at IS NULL THEN now()
        ELSE shift_started_at
      END,
      shift_ended_at        = NULL,
      pause_reason_id       = NULL,
      pause_started_at      = NULL,
      pause_expected_end_at = NULL,
      updated_at            = now()
    WHERE tenant_id = p_tenant_id AND user_id = p_user_id;
  END IF;

  -- user_id = o ATENDENTE (dono do extrato). Quem mandou vai no payload.
  INSERT INTO public.support_agent_presence_events
    (tenant_id, user_id, event_type, payload)
  VALUES (
    p_tenant_id,
    p_user_id,
    CASE WHEN p_status = 'offline' THEN 'admin_shift_end' ELSE 'admin_set_active' END,
    jsonb_build_object(
      'changed_by', v_actor,
      'old_status', v_old_status,
      'new_status', p_status,
      'source',     'admin_team_panel'
    )
  );

  RETURN jsonb_build_object(
    'changed', true,
    'old_status', v_old_status,
    'new_status', p_status
  );
END;
$function$;

COMMENT ON FUNCTION public.agent_presence_admin_set_status(uuid, uuid, text) IS
  'DEM-0194: admin/head (ou super admin) forca o status de presenca de outro '
  'atendente — tipicamente derrubar quem fechou o navegador sem encerrar o '
  'expediente e continua recebendo distribuicao. Aceita apenas active/offline. '
  'NAO mexe em support_attendances: os atendimentos em andamento ficam com o '
  'dono, so a distribuicao de conversa nova para. Grava o evento em '
  'support_agent_presence_events com changed_by no payload.';

REVOKE ALL ON FUNCTION public.agent_presence_admin_set_status(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_presence_admin_set_status(uuid, uuid, text)
  TO authenticated, service_role;
