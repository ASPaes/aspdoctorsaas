-- Participantes do sub-ticket de treino (1:N) + presença por pessoa
--
-- Etapa 1 de 2 do design em
-- docs/superpowers/specs/2026-08-02-onboarding-treino-participantes-e-presenca-design.md
--
-- O que muda de conceito: quem esteve na sala deixa de ser um booleano ("proprietário
-- presente", informado em 2 de 26 sessões) e vira lista. proprietario_presente continua
-- existindo e continua sendo lido pelo dashboard — só troca de escritor.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A lista
--
--    nome/fone/email são CÓPIA, não JOIN: a lista é o registro do que aconteceu
--    naquele dia. Se o contato trocar de telefone, mudar de empresa ou for apagado
--    do cadastro, a ata do treino continua verdadeira. cliente_contato_id fica só
--    como rastro da origem, e por isso é ON DELETE SET NULL.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.onboarding_training_participants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id),
  training_id        uuid NOT NULL REFERENCES public.onboarding_training_sessions(id) ON DELETE CASCADE,
  cliente_contato_id uuid REFERENCES public.cliente_contatos(id) ON DELETE SET NULL,
  nome               text NOT NULL,
  tipo               text NOT NULL DEFAULT 'colaborador',
  fone               text,
  email              text,
  presente           boolean,
  presenca_em        timestamptz,
  presenca_por       uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onb_training_part_tipo_chk
    CHECK (tipo IN ('colaborador', 'responsavel_empresa', 'outro')),
  CONSTRAINT onb_training_part_nome_chk
    CHECK (btrim(nome) <> '')
);

COMMENT ON TABLE public.onboarding_training_participants IS
  'Quem participou de cada sessão de treino. presente NULL = não informado, nunca ausente.';
COMMENT ON COLUMN public.onboarding_training_participants.presente IS
  'NULL = chamada não respondida. true = presente. false = faltou.';
COMMENT ON COLUMN public.onboarding_training_participants.cliente_contato_id IS
  'Rastro da origem quando veio de cliente_contatos. Apagar o contato não apaga a ata.';

CREATE INDEX IF NOT EXISTS idx_onb_training_part_training
  ON public.onboarding_training_participants (training_id);
CREATE INDEX IF NOT EXISTS idx_onb_training_part_contato
  ON public.onboarding_training_participants (tenant_id, cliente_contato_id);
CREATE INDEX IF NOT EXISTS idx_onb_training_part_pendente
  ON public.onboarding_training_participants (training_id) WHERE presente IS NULL;

DROP TRIGGER IF EXISTS trg_onb_training_part_upd ON public.onboarding_training_participants;
CREATE TRIGGER trg_onb_training_part_upd
  BEFORE UPDATE ON public.onboarding_training_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.onboarding_training_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_training_participants_sel ON public.onboarding_training_participants;
DROP POLICY IF EXISTS onboarding_training_participants_ins ON public.onboarding_training_participants;
DROP POLICY IF EXISTS onboarding_training_participants_upd ON public.onboarding_training_participants;
DROP POLICY IF EXISTS onboarding_training_participants_del ON public.onboarding_training_participants;

CREATE POLICY onboarding_training_participants_sel ON public.onboarding_training_participants
  FOR SELECT TO authenticated USING (public.can_access_tenant_row(tenant_id));
CREATE POLICY onboarding_training_participants_ins ON public.onboarding_training_participants
  FOR INSERT TO authenticated WITH CHECK (public.can_access_tenant_row(tenant_id));
CREATE POLICY onboarding_training_participants_upd ON public.onboarding_training_participants
  FOR UPDATE TO authenticated USING (public.can_access_tenant_row(tenant_id))
                              WITH CHECK (public.can_access_tenant_row(tenant_id));
CREATE POLICY onboarding_training_participants_del ON public.onboarding_training_participants
  FOR DELETE TO authenticated USING (public.can_access_tenant_row(tenant_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. proprietario_presente vira derivado
--
--    Regra que preserva o passado: quando NENHUM participante do tipo
--    'responsavel_empresa' tem presença informada, a coluna NÃO É TOCADA. Sem isso,
--    as 2 sessões marcadas à mão hoje virariam NULL na primeira edição da lista.
--    NULL segue significando "não informado" — que foi exatamente a distinção que o
--    dashMetrics.ts ganhou em 02/08.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_onb_training_sync_proprietario(p_training_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_informados int; v_presentes int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE presente)
    INTO v_informados, v_presentes
    FROM public.onboarding_training_participants
   WHERE training_id = p_training_id
     AND tipo = 'responsavel_empresa'
     AND presente IS NOT NULL;

  IF v_informados = 0 THEN RETURN; END IF;

  UPDATE public.onboarding_training_sessions
     SET proprietario_presente = (v_presentes > 0)
   WHERE id = p_training_id
     AND proprietario_presente IS DISTINCT FROM (v_presentes > 0);
END $function$;

REVOKE ALL ON FUNCTION public.fn_onb_training_sync_proprietario(uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_onb_training_sync_proprietario(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_onb_training_part_proprietario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_onb_training_sync_proprietario(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.training_id ELSE NEW.training_id END);
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.trg_onb_training_part_proprietario() FROM PUBLIC, authenticated;

DROP TRIGGER IF EXISTS trg_onb_training_part_proprietario ON public.onboarding_training_participants;
CREATE TRIGGER trg_onb_training_part_proprietario
  AFTER INSERT OR UPDATE OR DELETE ON public.onboarding_training_participants
  FOR EACH ROW EXECUTE FUNCTION public.trg_onb_training_part_proprietario();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A coluna de texto morre
--    26 sessões na base, ZERO preenchidas, zero leitores no repo. Manter um text
--    chamado "participantes" ao lado da tabela "..._participants" é convite a bug.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.onboarding_training_sessions DROP COLUMN IF EXISTS participantes;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. O quadro passa a enxergar a chamada
--
--    ⚠️ security_invoker=true PRECISA ser repetido: CREATE OR REPLACE VIEW sem a
--    cláusula descarta a opção em silêncio (provado em 26/07, dfbbf64a).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.vw_onboarding_training_cards
WITH (security_invoker = true) AS
 SELECT t.id AS training_id,
    t.tenant_id,
    t.journey_id,
    t.ticket_id,
    tk.ticket_code,
    tk.sub_seq,
    pai.id AS parent_ticket_id,
    pai.ticket_code AS parent_ticket_code,
    t.titulo,
    t.status::text AS status,
    t.agendado_para,
    t.realizado_em,
    t.tentativas,
    t.no_show,
    t.is_retreinamento,
    t.link_agendamento,
    t.current_stage_id,
    t.conduzido_por,
    f.nome AS conduzido_por_nome,
    t.training_type_id,
    tt.nome AS training_type_nome,
    j.cliente_id,
    COALESCE(c.nome_fantasia, c.razao_social) AS cliente_nome,
    c.unidade_base_id AS cliente_unidade_id,
    j.situacao::text AS journey_situacao,
    j.demand_type_id,
    dt.nome AS demand_type_nome,
    dt.cor AS demand_type_cor,
    h.entrou_em AS etapa_entrou_em,
    t.created_at,
    t.cancelado_em,
    j.implantacao_iniciada_em,
    t.status = 'cancelado'::onb_treino_status AND j.implantacao_iniciada_em IS NOT NULL AND t.cancelado_em IS NOT NULL AND t.cancelado_em >= j.implantacao_iniciada_em AS cancelado_na_implantacao,
    COALESCE(pt.total, 0)::int     AS participantes_total,
    COALESCE(pt.presentes, 0)::int AS participantes_presentes,
    (COALESCE(pt.total, 0) = 0 OR COALESCE(pt.pendentes, 0) > 0) AS chamada_pendente
   FROM onboarding_training_sessions t
     JOIN support_tickets tk ON tk.id = t.ticket_id
     LEFT JOIN support_tickets pai ON pai.id = tk.parent_ticket_id
     JOIN onboarding_journeys j ON j.id = t.journey_id
     LEFT JOIN clientes c ON c.id = j.cliente_id
     LEFT JOIN onboarding_training_types tt ON tt.id = t.training_type_id
     LEFT JOIN onboarding_demand_types dt ON dt.id = j.demand_type_id
     LEFT JOIN profiles p ON p.user_id = t.conduzido_por
     LEFT JOIN funcionarios f ON f.id = p.funcionario_id
     LEFT JOIN LATERAL ( SELECT hh.entrou_em
           FROM onboarding_training_stage_history hh
          WHERE hh.training_id = t.id AND hh.saiu_em IS NULL
          ORDER BY hh.entrou_em DESC
         LIMIT 1) h ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS total,
                                count(*) FILTER (WHERE pp.presente) AS presentes,
                                count(*) FILTER (WHERE pp.presente IS NULL) AS pendentes
           FROM onboarding_training_participants pp
          WHERE pp.training_id = t.id) pt ON true
  WHERE t.deleted_at IS NULL;
