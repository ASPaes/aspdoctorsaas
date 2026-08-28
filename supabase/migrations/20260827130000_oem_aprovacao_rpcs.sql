-- ============================================================================
-- Aprovação OEM (passo 2 de 4): as funções que a aba usa.
--
-- Cinco funções, nenhuma delas com efeito enquanto o passo 4 não ligar a trava:
-- sem linha em 'aguardando_aprovacao', listar devolve vazio e aprovar não acha
-- o que aprovar.
--
--   fn_oem_aprovacao_pode      o portão, num lugar só
--   fn_oem_aprovacao_status    o contador da aba
--   fn_oem_aprovacao_listar    a lista (aguardando em cima, decididos embaixo)
--   fn_oem_aprovacao_aprovar   aprova em lote  -> status vira 'pendente'
--   fn_oem_aprovacao_recusar   recusa em lote  -> status vira 'recusado'
--
-- APROVAR NÃO CHAMA O PARCEIRO. Ele só devolve a linha ao estado em que ela
-- nasceria hoje ('pendente') e zera a `proxima_tentativa_em`. Quem conversa com
-- o OEM continua sendo a `oem-sync-processar`, exatamente como antes — inclusive
-- a ordem OEM-primeiro-ficha-depois, o backoff e a `fn_oem_fila_aplicar`, que é
-- onde o upsell e o downsell nascem. Nenhuma delas é tocada aqui.
--
-- O PORTÃO É ADMIN, NÃO admin-or-head (decisão do Alexandre em 27/08/2026).
-- `is_admin_or_head()` é o portão de quem PEDE; aprovar é outra coisa. Não
-- existe `is_admin()` neste banco, então o papel é lido aqui — uma vez só, na
-- `fn_oem_aprovacao_pode`, para não repetir quatro vezes a armadilha do NULL:
-- com o perfil ausente, `v_role = 'admin'` é NULL, `NULL OR NULL` é NULL,
-- `NOT NULL` é NULL e o IF não dispara — o portão liberaria justamente para
-- quem não tem perfil. Por isso o `coalesce` fica POR FORA da expressão inteira.
-- Testável: rodando como `postgres` (sem tenant e sem perfil) tem que NEGAR.
--
-- POR QUE A LISTA NÃO FILTRA POR UNIDADE SOZINHA
-- A regra "a aba do OEM é por unidade" vale para NÚMERO: margem de uma conta
-- somada à de outra é número errado. Aqui é fila de trabalho, e o custo do erro
-- é o oposto — pedido que some da tela é pedido que nunca é aprovado, e o módulo
-- do cliente não entra sem ninguém saber por quê. Já aconteceu três vezes neste
-- projeto (guarda que barra o evento que deveria passar). Então:
--   · sem `p_unidades`, a lista traz o tenant inteiro;
--   · com `p_unidades` (o filtro global que a pessoa escolheu, e que ela desfaz
--     em "Todas"), filtra — mas cliente SEM unidade continua aparecendo, senão
--     ele viraria um pedido invisível;
--   · toda linha devolve `unidade_base_id` e `unidade`, para a tela mostrar de
--     qual operação é cada pedido.
-- ============================================================================

BEGIN;

-- ============================================================================
-- O portão. Um lugar só para auditar.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_pode(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text;
  v_super  boolean;
  v_tenant uuid;
BEGIN
  SELECT p.role, p.is_super_admin, p.tenant_id
    INTO v_role, v_super, v_tenant
    FROM public.profiles p
   WHERE p.user_id = auth.uid();

  -- Sem perfil, as três são NULL e o coalesce de fora devolve false.
  RETURN coalesce(
    coalesce(v_super, false)
    OR (v_role = 'admin' AND p_tenant_id IS NOT NULL AND v_tenant = p_tenant_id),
    false
  );
END;
$$;

COMMENT ON FUNCTION public.fn_oem_aprovacao_pode(uuid) IS
  'Quem pode aprovar/recusar pedido do OEM: admin do próprio tenant, ou super admin. Head NÃO — ele pede, não aprova.';

REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_pode(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_pode(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_aprovacao_pode(uuid) TO authenticated, service_role;

-- ============================================================================
-- O contador da aba. Chamado com frequência, então é uma agregação só.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_status(
  p_tenant_id uuid     DEFAULT NULL,
  p_unidades  bigint[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
  v_res    jsonb;
BEGIN
  IF NOT public.fn_oem_aprovacao_pode(v_tenant) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'aguardando',   count(*),
           'mais_antigo',  min(f.enfileirado_em),
           'adicoes',      count(*) FILTER (WHERE f.acao IN ('ativar','quantidade')),
           'cancelamentos',count(*) FILTER (WHERE f.acao = 'cancelar')
         )
    INTO v_res
    FROM public.oem_sync_fila f
    LEFT JOIN public.cliente_produtos cp ON cp.id = f.cliente_produto_id
    LEFT JOIN public.clientes c          ON c.id  = cp.cliente_id
   WHERE f.tenant_id = v_tenant
     AND f.status = 'aguardando_aprovacao'
     -- Cliente sem unidade nunca é escondido: ver o cabeçalho.
     AND (p_unidades IS NULL
          OR c.unidade_base_id IS NULL
          OR c.unidade_base_id = ANY(p_unidades));

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_status(uuid, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_status(uuid, bigint[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_aprovacao_status(uuid, bigint[]) TO authenticated, service_role;

-- ============================================================================
-- A lista. Uma chamada devolve tudo que a tela precisa mostrar — nome do
-- cliente, do produto, do módulo, quem pediu e os valores que estão em jogo.
--
-- Os valores saem do `payload` já desempacotados: é ele que carrega o que a
-- ficha vai receber DEPOIS do aceite (a linha do módulo ainda não existe no
-- caso 'ativar'). Quem aprova precisa ver o número antes de ele virar MRR.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_listar(
  p_tenant_id uuid     DEFAULT NULL,
  p_unidades  bigint[] DEFAULT NULL,
  p_limite    integer  DEFAULT 200,
  p_historico integer  DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
BEGIN
  IF NOT public.fn_oem_aprovacao_pode(v_tenant) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    WITH linhas AS (
      SELECT
        f.id,
        f.acao,
        f.status,
        f.quantidade,
        f.enfileirado_em,
        f.decidido_em,
        f.motivo_recusa,
        f.ultimo_erro,
        f.payload,
        f.cliente_produto_id,
        cp.cliente_id,
        coalesce(c.nome_fantasia, c.razao_social)                    AS cliente,
        c.unidade_base_id,
        ub.nome                                                      AS unidade,
        pr.nome                                                      AS produto,
        coalesce(pm_cat.nome, pm_linha.nome)                         AS modulo,
        -- Só faz sentido em 'quantidade': é o "de" do "de 2 para 5".
        cpm.quantidade                                               AS quantidade_atual,
        fp.nome                                                      AS pedido_por,
        fd.nome                                                      AS decidido_por,
        CASE WHEN f.status = 'aguardando_aprovacao' THEN 0 ELSE 1 END AS ordem
      FROM public.oem_sync_fila f
      LEFT JOIN public.cliente_produtos cp        ON cp.id = f.cliente_produto_id
      LEFT JOIN public.clientes c                 ON c.id  = cp.cliente_id
      LEFT JOIN public.unidades_base ub           ON ub.id = c.unidade_base_id
      LEFT JOIN public.produtos pr                ON pr.id = cp.produto_id
      LEFT JOIN public.produto_modulos pm_cat     ON pm_cat.id = f.modulo_catalogo_id
      LEFT JOIN public.cliente_produto_modulos cpm ON cpm.id = f.modulo_linha_id
      LEFT JOIN public.produto_modulos pm_linha   ON pm_linha.id = cpm.modulo_id
      LEFT JOIN public.profiles prof_p            ON prof_p.user_id = f.usuario_id
      LEFT JOIN public.funcionarios fp            ON fp.id = prof_p.funcionario_id
      LEFT JOIN public.profiles prof_d            ON prof_d.user_id = f.decidido_por
      LEFT JOIN public.funcionarios fd            ON fd.id = prof_d.funcionario_id
      WHERE f.tenant_id = v_tenant
        AND (f.status = 'aguardando_aprovacao' OR f.decidido_em IS NOT NULL)
        AND (p_unidades IS NULL
             OR c.unidade_base_id IS NULL
             OR c.unidade_base_id = ANY(p_unidades))
    ),
    recorte AS (
      (SELECT * FROM linhas WHERE ordem = 0
        ORDER BY enfileirado_em
        LIMIT greatest(coalesce(p_limite, 200), 1))
      UNION ALL
      (SELECT * FROM linhas WHERE ordem = 1
        ORDER BY decidido_em DESC
        LIMIT greatest(coalesce(p_historico, 30), 0))
    )
    SELECT jsonb_agg(
             jsonb_build_object(
               'id',                 r.id,
               'acao',               r.acao,
               'status',             r.status,
               -- O que a tela precisa dizer em uma palavra. 'aprovado' cobre a
               -- linha que já foi ao parceiro e a que ele recusou: o resultado
               -- do envio vai em `status`/`ultimo_erro`, separado da decisão de
               -- quem aprovou. Misturar os dois faria uma recusa do OEM parecer
               -- recusa do admin.
               'situacao',           CASE WHEN r.status = 'aguardando_aprovacao' THEN 'aguardando'
                                          WHEN r.status = 'recusado'             THEN 'recusado'
                                          ELSE 'aprovado' END,
               'cliente_id',         r.cliente_id,
               'cliente',            r.cliente,
               'unidade_base_id',    r.unidade_base_id,
               'unidade',            r.unidade,
               'produto',            r.produto,
               'modulo',             r.modulo,
               'quantidade',         r.quantidade,
               'quantidade_atual',   r.quantidade_atual,
               'quantidade_cancelar',nullif(r.payload->>'quantidade_cancelar','')::numeric,
               'vlr_mensal',         nullif(r.payload->>'vlr_mensal','')::numeric,
               'vlr_custo',          nullif(r.payload->>'vlr_custo','')::numeric,
               'vlr_ativacao',       coalesce(nullif(r.payload->>'vlr_ativacao','')::numeric,
                                              nullif(r.payload->>'vlr_ativacao_somar','')::numeric),
               'valor_downsell',     nullif(r.payload->>'valor_downsell','')::numeric,
               'motivo',             r.payload->>'motivo',
               'pedido_por',         r.pedido_por,
               'enfileirado_em',     r.enfileirado_em,
               'decidido_por',       r.decidido_por,
               'decidido_em',        r.decidido_em,
               'motivo_recusa',      r.motivo_recusa,
               'ultimo_erro',        r.ultimo_erro
             )
             -- Aguardando primeiro, do mais antigo para o mais novo (FIFO: quem
             -- pediu antes espera menos). O histórico embaixo, do mais recente.
             ORDER BY r.ordem,
                      CASE WHEN r.ordem = 0 THEN r.enfileirado_em END ASC,
                      r.decidido_em DESC
           )
      FROM recorte r
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_listar(uuid, bigint[], integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_listar(uuid, bigint[], integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_aprovacao_listar(uuid, bigint[], integer, integer) TO authenticated, service_role;

-- ============================================================================
-- Aprovar em lote.
--
-- Não chama o parceiro: devolve a linha a 'pendente', que é onde ela nasceria
-- antes desta mudança. Quem aprova pede o processamento logo depois (a tela
-- chama a `oem-sync-processar`), e o cron de 2 em 2 minutos é a rede.
--
-- Linha que não está aguardando é IGNORADA, não é erro: dois admins clicando
-- na mesma lista é o caso normal, e o segundo não pode levar um erro vermelho
-- por ter chegado meio segundo depois. O retorno diz quantas foram e quantas
-- já não estavam mais lá.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_aprovar(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedidas integer := coalesce(array_length(p_ids, 1), 0);
  v_negado  uuid;
  v_ok      integer;
BEGIN
  IF v_pedidas = 0 THEN
    RETURN jsonb_build_object('aprovadas', 0, 'ignoradas', 0);
  END IF;
  IF v_pedidas > 500 THEN
    RAISE EXCEPTION 'Lote grande demais: % linhas (máximo 500).', v_pedidas USING ERRCODE = '22023';
  END IF;

  -- O portão é por TENANT da linha, não por tenant de quem chamou: mandar uma
  -- lista com um id de outro tenant não pode aprovar nada. Falha inteira em vez
  -- de aprovar a parte permitida — aprovação parcial silenciosa é pior que erro.
  SELECT f.tenant_id INTO v_negado
    FROM public.oem_sync_fila f
   WHERE f.id = ANY(p_ids)
     AND NOT public.fn_oem_aprovacao_pode(f.tenant_id)
   LIMIT 1;
  IF v_negado IS NOT NULL THEN
    RAISE EXCEPTION 'Sem permissão para aprovar pedido deste tenant.' USING ERRCODE = '42501';
  END IF;

  WITH alvo AS (
    SELECT id FROM public.oem_sync_fila
     WHERE id = ANY(p_ids) AND status = 'aguardando_aprovacao'
     FOR UPDATE
  )
  UPDATE public.oem_sync_fila f
     SET status               = 'pendente',
         decidido_por         = public.fn_acting_user(),
         decidido_em          = now(),
         -- Sem isto a linha aprovada esperaria o carimbo antigo. É o mesmo
         -- "agora" que o enfileiramento dava.
         proxima_tentativa_em = now()
    FROM alvo
   WHERE f.id = alvo.id;

  GET DIAGNOSTICS v_ok = ROW_COUNT;

  RETURN jsonb_build_object('aprovadas', v_ok, 'ignoradas', v_pedidas - v_ok);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_aprovar(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_aprovar(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_aprovacao_aprovar(uuid[]) TO authenticated, service_role;

-- ============================================================================
-- Recusar em lote. Motivo obrigatório: sem ele, ninguém descobre depois por que
-- o módulo não entrou — que é exatamente o silêncio que a fila existe para não
-- repetir.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_recusar(p_ids uuid[], p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedidas integer := coalesce(array_length(p_ids, 1), 0);
  v_motivo  text    := btrim(coalesce(p_motivo, ''));
  v_negado  uuid;
  v_ok      integer;
BEGIN
  IF v_pedidas = 0 THEN
    RETURN jsonb_build_object('recusadas', 0, 'ignoradas', 0);
  END IF;
  IF v_pedidas > 500 THEN
    RAISE EXCEPTION 'Lote grande demais: % linhas (máximo 500).', v_pedidas USING ERRCODE = '22023';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Informe o motivo da recusa.' USING ERRCODE = '22023';
  END IF;

  SELECT f.tenant_id INTO v_negado
    FROM public.oem_sync_fila f
   WHERE f.id = ANY(p_ids)
     AND NOT public.fn_oem_aprovacao_pode(f.tenant_id)
   LIMIT 1;
  IF v_negado IS NOT NULL THEN
    RAISE EXCEPTION 'Sem permissão para recusar pedido deste tenant.' USING ERRCODE = '42501';
  END IF;

  WITH alvo AS (
    SELECT id FROM public.oem_sync_fila
     WHERE id = ANY(p_ids) AND status = 'aguardando_aprovacao'
     FOR UPDATE
  )
  UPDATE public.oem_sync_fila f
     SET status        = 'recusado',
         decidido_por  = public.fn_acting_user(),
         decidido_em   = now(),
         motivo_recusa = left(v_motivo, 500)
    FROM alvo
   WHERE f.id = alvo.id;

  GET DIAGNOSTICS v_ok = ROW_COUNT;

  RETURN jsonb_build_object('recusadas', v_ok, 'ignoradas', v_pedidas - v_ok);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_recusar(uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_recusar(uuid[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_aprovacao_recusar(uuid[], text) TO authenticated, service_role;

COMMIT;
