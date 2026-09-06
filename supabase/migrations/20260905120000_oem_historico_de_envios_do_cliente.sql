-- ============================================================================
-- O histórico de envios ao OEM de UM cliente, numa linha do tempo só.
--
-- O modal "Histórico de envios" da ficha do cliente só sabia falar do Omie. O
-- OEM já registrava tudo, em TRÊS tabelas separadas, e nenhuma tela do cliente
-- lia nenhuma delas:
--
--   oem_sync_fila            módulo ativado, quantidade alterada, cancelamento
--   oem_estado_licenca_log   ativar / desativar / bloquear / desbloquear
--   oem_cadastro_licenca_log correção de nome e CNPJ da filial
--
-- Uma função só porque a alternativa era o navegador fazer 6 consultas e
-- costurar nome de produto, de módulo e de usuário na mão. As três já são
-- legíveis por RLS do tenant; o SECURITY DEFINER aqui existe pelos JOINs de
-- nome (profiles/funcionarios), não para driblar portão nenhum — o recorte por
-- tenant é repetido em cada fonte.
--
-- ---------------------------------------------------------------------------
-- SIMULAÇÃO VEM JUNTO, MARCADA
-- ---------------------------------------------------------------------------
-- Todo clique em Ativar/Bloquear simula antes de gravar (a rota do parceiro
-- salva a filial inteira; ver oem-licenca-estado). Isso quer dizer que metade
-- das linhas do log é leitura, não envio — inclusive as de quem abriu a
-- confirmação e desistiu. Elas voltam com `simulado = true` para a tela poder
-- escondê-las por padrão. Não filtro aqui: "por que não foi?" costuma ser
-- respondido justamente pela simulação que barrou.
--
-- ---------------------------------------------------------------------------
-- QUEM PEDIU, NÃO QUEM GRAVOU
-- ---------------------------------------------------------------------------
-- `quando` é o carimbo do CLIQUE (enfileirado_em na fila), não o do
-- processamento: quem lê quer saber quando a pessoa pediu. O processamento vai
-- junto em `processado_em`, para o caso de a diferença importar.
--
-- `usuario_id` volta sempre, mesmo quando o nome não resolve — a tela precisa
-- distinguir "usuário sem funcionário cadastrado" de "ninguém" (ver
-- fn_acting_user e o histórico de módulos, que já faz essa distinção).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_oem_historico_do_cliente(
  p_cliente_id uuid,
  p_tenant_id  uuid    DEFAULT NULL,
  p_limite     integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid    := coalesce(p_tenant_id, public.current_tenant_id());
  v_lim    integer := least(greatest(coalesce(p_limite, 200), 1), 1000);
BEGIN
  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Cliente não informado.' USING ERRCODE = '22023';
  END IF;

  -- coalesce POR FORA da expressão inteira. Com v_tenant e current_tenant_id()
  -- ambos NULL, `v = v` é NULL, `NULL OR false` é NULL, `NOT NULL` é NULL — o
  -- IF não dispara e o portão libera justamente para quem não tem perfil.
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    WITH linhas AS (
      -- ------------------------------------------------------------ módulos
      -- A fila é a fonte: ela é a única que sabe QUEM pediu. A
      -- `oem_baixa_modulo_log` guarda a conversa crua com o parceiro e nasceu
      -- sem `usuario_id`; repetir as duas aqui dobraria cada cancelamento.
      SELECT f.id::text                                  AS id,
             f.enfileirado_em                            AS quando,
             'modulo'::text                              AS grupo,
             f.acao                                      AS acao,
             f.status                                    AS status,
             false                                       AS simulado,
             NULL::boolean                               AS confirmado,
             f.filial_codigo                             AS filial_codigo,
             pr.nome                                     AS produto,
             coalesce(pm_cat.nome, pm_linha.nome)        AS modulo,
             -- Em 'cancelar' a quantidade da coluna é a que sobra; o que a
             -- pessoa pediu para tirar está no payload.
             CASE WHEN f.acao = 'cancelar'
                  THEN nullif(f.payload->>'quantidade_cancelar', '')::numeric
                  ELSE f.quantidade END                  AS quantidade,
             nullif(f.payload->>'motivo', '')            AS motivo,
             -- Pedido que nenhuma pessoa daqui digitou (calculadora, etc.).
             nullif(f.payload->>'fonte', '')             AS fonte,
             coalesce(f.ultimo_erro, f.motivo_recusa)    AS erro,
             f.processado_em                             AS processado_em,
             f.usuario_id                                AS usuario_id,
             fp.nome                                     AS quem,
             fd.nome                                     AS decidido_por,
             f.decidido_em                               AS decidido_em,
             NULL::text                                  AS campo,
             NULL::text                                  AS valor_anterior,
             NULL::text                                  AS valor_novo,
             NULL::boolean                               AS bloqueado_antes,
             NULL::boolean                               AS bloqueado_depois,
             NULL::boolean                               AS desativado_antes,
             NULL::boolean                               AS desativado_depois,
             NULL::text                                  AS baixa_em
        FROM public.oem_sync_fila f
        JOIN public.cliente_produtos cp               ON cp.id = f.cliente_produto_id
                                                    AND cp.cliente_id = p_cliente_id
        LEFT JOIN public.produtos pr                 ON pr.id = cp.produto_id
        LEFT JOIN public.produto_modulos pm_cat      ON pm_cat.id = f.modulo_catalogo_id
        LEFT JOIN public.cliente_produto_modulos cpm ON cpm.id = f.modulo_linha_id
        LEFT JOIN public.produto_modulos pm_linha    ON pm_linha.id = cpm.modulo_id
        LEFT JOIN public.profiles prof_p             ON prof_p.user_id = f.usuario_id
        LEFT JOIN public.funcionarios fp             ON fp.id = prof_p.funcionario_id
        LEFT JOIN public.profiles prof_d             ON prof_d.user_id = f.decidido_por
        LEFT JOIN public.funcionarios fd             ON fd.id = prof_d.funcionario_id
       WHERE f.tenant_id = v_tenant

      UNION ALL

      -- --------------------------------------------------- estado da licença
      -- `ok = false` é recusa do parceiro. `confirmado = false` NÃO é falha: é
      -- a releitura dele atrasando (medido em 28/08/2026). São status
      -- diferentes de propósito.
      SELECT l.id::text,
             l.criado_em,
             'licenca'::text,
             l.acao,
             CASE WHEN l.simulado             THEN 'simulado'
                  WHEN NOT l.ok               THEN 'erro'
                  WHEN l.confirmado IS FALSE  THEN 'sem_confirmacao'
                  ELSE 'ok' END,
             l.simulado,
             l.confirmado,
             l.filial_codigo,
             NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::text,
             -- A recusa do parceiro não vem no topo: o corpo dele fica aninhado
             -- em `resposta.resposta`. Sem esta cadeia a linha vermelha aparece
             -- sem dizer o que houve, que é exatamente o que se veio ver.
             coalesce(nullif(l.resposta->>'mensagem', ''),
                      nullif(l.resposta->'resposta'->>'erro', ''),
                      nullif(l.resposta->'resposta'->>'mensagem', ''),
                      nullif(l.resposta->>'erro', '')),
             NULL::timestamptz,
             l.usuario_id,
             fu.nome,
             NULL::text, NULL::timestamptz,
             NULL::text, NULL::text, NULL::text,
             l.bloqueado_antes, l.bloqueado_depois,
             l.desativado_antes, l.desativado_depois,
             -- Desativar no OEM é AGENDAMENTO: a licença fica de pé até esta
             -- data. Dizer só "desativada" contradiria o portal do parceiro.
             nullif(l.resposta->'conferencia'->>'baixa_em', '')
        FROM public.oem_estado_licenca_log l
        LEFT JOIN public.profiles prof    ON prof.user_id = l.usuario_id
        LEFT JOIN public.funcionarios fu  ON fu.id = prof.funcionario_id
       WHERE l.tenant_id = v_tenant
         AND l.cliente_id = p_cliente_id

      UNION ALL

      -- --------------------------------------------------- cadastro da filial
      SELECT c.id::text,
             c.criado_em,
             'cadastro'::text,
             c.campo,
             CASE WHEN c.simulado THEN 'simulado'
                  WHEN NOT c.ok   THEN 'erro'
                  ELSE 'ok' END,
             c.simulado,
             NULL::boolean,
             c.filial_codigo,
             NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::text,
             coalesce(nullif(c.resposta->>'mensagem', ''),
                      nullif(c.resposta->'resposta'->>'erro', ''),
                      nullif(c.resposta->'resposta'->>'mensagem', ''),
                      nullif(c.resposta->>'erro', '')),
             NULL::timestamptz,
             c.usuario_id,
             fu.nome,
             NULL::text, NULL::timestamptz,
             c.campo, c.valor_anterior, c.valor_novo,
             NULL::boolean, NULL::boolean, NULL::boolean, NULL::boolean,
             NULL::text
        FROM public.oem_cadastro_licenca_log c
        LEFT JOIN public.profiles prof    ON prof.user_id = c.usuario_id
        LEFT JOIN public.funcionarios fu  ON fu.id = prof.funcionario_id
       WHERE c.tenant_id = v_tenant
         AND c.cliente_id = p_cliente_id
    )
    SELECT jsonb_agg(x ORDER BY x.quando DESC)
      FROM (SELECT * FROM linhas ORDER BY quando DESC LIMIT v_lim) x
  ), '[]'::jsonb);
END;
$fn$;

ALTER FUNCTION public.fn_oem_historico_do_cliente(uuid, uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_historico_do_cliente(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_historico_do_cliente(uuid, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_historico_do_cliente(uuid, uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_oem_historico_do_cliente(uuid, uuid, integer) IS
  'Linha do tempo dos envios ao OEM de um cliente: modulos (oem_sync_fila), estado da licenca (oem_estado_licenca_log) e cadastro da filial (oem_cadastro_licenca_log). Simulacoes voltam marcadas com simulado=true; a tela e que decide esconde-las.';

COMMIT;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura), depois de aplicar:
--   select jsonb_array_length(public.fn_oem_historico_do_cliente(
--     (select cp.cliente_id
--        from public.oem_sync_fila f
--        join public.cliente_produtos cp on cp.id = f.cliente_produto_id
--       order by f.enfileirado_em desc limit 1)));
-- ---------------------------------------------------------------------------
