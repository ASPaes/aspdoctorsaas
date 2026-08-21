-- ============================================================================
-- Fila de sincronização do OEM.
--
-- Hoje a única escrita DS -> OEM (o cancelamento de módulo) chama a API do
-- parceiro na hora, de dentro do clique. Quando o parceiro recusa, o motivo
-- aparece num toast e some. Existe até um log de toda tentativa
-- (oem_baixa_modulo_log, com a resposta inteira), mas NENHUMA tela lê — na
-- prática, escrita que falha é escrita que ninguém sabe que falhou.
--
-- Esta fila é o mesmo desenho da omie_sync_fila: a ação nasce aqui, um
-- processador roda de 2 em 2 minutos, e o que falha FICA na fila com o motivo
-- em vez de evaporar. A diferença de operação em relação ao Omie é
-- deliberada: quem enfileira também pede o processamento na hora, então o
-- feedback imediato continua existindo e o cron é a rede de segurança.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.oem_sync_fila (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id),
  conta_integration_id  uuid REFERENCES public.oem_integration(id),

  -- O alvo. cliente_produto_id é o que liga a linha ao cliente na tela;
  -- modulo_linha_id é a linha de cliente_produto_modulos, quando existe.
  cliente_produto_id    uuid REFERENCES public.cliente_produtos(id) ON DELETE CASCADE,
  modulo_linha_id       uuid REFERENCES public.cliente_produto_modulos(id) ON DELETE SET NULL,

  acao                  text NOT NULL,
  empresa_codigo        text,
  filial_codigo         text,
  oem_modulo_codigo     integer,
  -- Quantidade que a licença deve ficar tendo no OEM. 0 = desativar o módulo.
  quantidade            numeric,
  -- Só é usado quando o módulo ainda não está na licença: sem preço, o parceiro
  -- recusa acrescentar (ele não inventa valor).
  valor_unitario        numeric,

  status                text NOT NULL DEFAULT 'pendente',
  tentativas            integer NOT NULL DEFAULT 0,
  ultimo_erro           text,
  resposta              jsonb,
  http                  integer,

  proxima_tentativa_em  timestamptz NOT NULL DEFAULT now(),
  enfileirado_em        timestamptz NOT NULL DEFAULT now(),
  processado_em         timestamptz,
  usuario_id            uuid,

  CONSTRAINT chk_oem_sync_acao   CHECK (acao IN ('ativar', 'quantidade', 'cancelar')),
  CONSTRAINT chk_oem_sync_status CHECK (status IN ('pendente','processando','ok','erro','invalido','ignorado'))
);

COMMENT ON TABLE public.oem_sync_fila IS
  'Fila de escrita DS -> OEM. Toda ação passa por aqui: o que falha fica com o motivo em vez de sumir num toast.';
COMMENT ON COLUMN public.oem_sync_fila.quantidade IS
  'Quantidade que a licença deve passar a ter no OEM. 0 desativa o módulo.';
COMMENT ON COLUMN public.oem_sync_fila.status IS
  'pendente/processando = em curso · ok = gravado no OEM · erro = falhou e vai tentar de novo · invalido = desistiu (esgotou tentativas ou recusa que repetir não resolve) · ignorado = não havia o que mandar.';

-- O processador varre por (status, proxima_tentativa_em); a tela varre por
-- tenant e data. Sem estes dois, as duas varreduras viram seq scan assim que a
-- fila tiver histórico.
CREATE INDEX IF NOT EXISTS idx_oem_sync_fila_pendente
  ON public.oem_sync_fila (status, proxima_tentativa_em)
  WHERE status IN ('pendente', 'erro');
CREATE INDEX IF NOT EXISTS idx_oem_sync_fila_tenant
  ON public.oem_sync_fila (tenant_id, enfileirado_em DESC);

ALTER TABLE public.oem_sync_fila ENABLE ROW LEVEL SECURITY;

-- Leitura para quem enxerga o tenant. Escrita, não: quem escreve é o
-- processador (service_role) e a RPC de enfileiramento, que valida por dentro.
DROP POLICY IF EXISTS oem_sync_fila_select ON public.oem_sync_fila;
CREATE POLICY oem_sync_fila_select ON public.oem_sync_fila
  FOR SELECT USING (
    tenant_id = (SELECT public.current_tenant_id())
    OR (SELECT public.is_super_admin())
  );

GRANT SELECT ON public.oem_sync_fila TO authenticated;
GRANT ALL    ON public.oem_sync_fila TO service_role;

-- ============================================================================
-- Enfileirar. É por aqui que a tela pede uma escrita no OEM — nunca por INSERT
-- direto, que a RLS não permite de propósito.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar(
  p_modulo_linha_id uuid,
  p_acao            text,
  p_quantidade      numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mod    public.cliente_produto_modulos;
  v_cp     public.cliente_produtos;
  v_conta  uuid;
  v_id     uuid;
BEGIN
  IF p_acao NOT IN ('ativar','quantidade','cancelar') THEN
    RAISE EXCEPTION 'Ação inválida: %', p_acao USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_mod FROM public.cliente_produto_modulos WHERE id = p_modulo_linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Mesmo portão das policies da tabela de módulos. coalesce porque helper que
  -- devolve NULL faria o IF nunca disparar — o portão passaria a liberar.
  IF NOT coalesce(
    (v_mod.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = v_mod.cliente_produto_id;

  -- Módulo digitado à mão não tem licença no parceiro. Enfileirar seria criar
  -- uma linha que nasce condenada a falhar.
  IF v_mod.origem <> 'oem' OR v_cp.oem_codigo_filial IS NULL OR v_mod.oem_modulo_codigo IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_conta
    FROM public.oem_integration
   WHERE tenant_id = v_mod.tenant_id AND ativo = true
   ORDER BY created_at
   LIMIT 1;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_linha_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, usuario_id
  ) VALUES (
    v_mod.tenant_id, v_conta, v_cp.id, v_mod.id,
    p_acao, v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_mod.oem_modulo_codigo,
    CASE WHEN p_acao = 'cancelar' THEN 0
         ELSE coalesce(p_quantidade, v_mod.quantidade, 1) END,
    v_mod.vlr_custo,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.fn_oem_enfileirar(uuid, text, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric) TO authenticated, service_role;

-- ============================================================================
-- Reprocessar uma linha parada, do painel.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_fila_reprocessar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linha public.oem_sync_fila;
BEGIN
  SELECT * INTO v_linha FROM public.oem_sync_fila WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
    (v_linha.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  IF v_linha.status = 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'Esta linha já foi gravada no OEM.');
  END IF;

  UPDATE public.oem_sync_fila
     SET status = 'pendente',
         tentativas = 0,
         proxima_tentativa_em = now(),
         ultimo_erro = NULL
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'mensagem', 'Linha devolvida para a fila.');
END;
$$;

ALTER FUNCTION public.fn_oem_fila_reprocessar(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_reprocessar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_reprocessar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_reprocessar(uuid) TO authenticated, service_role;

-- ============================================================================
-- O processador pega as linhas por aqui, não por SELECT + UPDATE separados.
--
-- `FOR UPDATE SKIP LOCKED` é o que impede duas execuções sobrepostas de pegarem
-- a mesma linha e mandarem a mesma escrita duas vezes para o parceiro — e o
-- cron de 2 em 2 minutos com uma chamada lenta produz exatamente isso.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_fila_claim(p_limite integer DEFAULT 20)
RETURNS SETOF public.oem_sync_fila
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH alvo AS (
    SELECT id
      FROM public.oem_sync_fila
     WHERE status IN ('pendente', 'erro')
       AND proxima_tentativa_em <= now()
     ORDER BY enfileirado_em
     LIMIT greatest(coalesce(p_limite, 20), 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.oem_sync_fila f
     SET status = 'processando',
         tentativas = f.tentativas + 1
    FROM alvo
   WHERE f.id = alvo.id
  RETURNING f.*;
$$;

ALTER FUNCTION public.fn_oem_fila_claim(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_claim(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_claim(integer) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_fila_claim(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_claim(integer) TO service_role;

-- ============================================================================
-- O que a tela mostra em cima: os contadores e a saúde do cron.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_fila_status(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
  v_res    jsonb;
BEGIN
  -- coalesce POR FORA da expressão inteira: com v_tenant e current_tenant_id()
  -- ambos NULL, `v = v` é NULL, `NULL OR false` é NULL e `NOT NULL` é NULL —
  -- o IF não dispara e o portão libera justamente para quem não tem perfil.
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'pendentes', count(*) FILTER (WHERE status IN ('pendente','processando')),
    'erros',     count(*) FILTER (WHERE status = 'erro'),
    'invalidos', count(*) FILTER (WHERE status = 'invalido'),
    'ok',        count(*) FILTER (WHERE status = 'ok'),
    'mais_antigo_pendente', min(enfileirado_em) FILTER (WHERE status IN ('pendente','processando'))
  ) INTO v_res
  FROM public.oem_sync_fila
  WHERE (v_tenant IS NULL OR tenant_id = v_tenant);

  RETURN v_res || jsonb_build_object(
    'cron_ultima', (SELECT ultima_execucao FROM public.cron_estado WHERE jobname = 'oem-sync-processar'),
    -- 2 em 2 minutos: passou de 6, alguma coisa parou.
    'cron_saudavel', (SELECT ultima_execucao > now() - interval '6 minutes'
                        FROM public.cron_estado WHERE jobname = 'oem-sync-processar')
  );
END;
$$;

ALTER FUNCTION public.fn_oem_fila_status(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_status(uuid) TO authenticated, service_role;

-- ============================================================================
-- A lista do painel. Uma chamada devolve a linha da fila já com o nome do
-- cliente, do produto e do módulo — o painel não precisa de 4 queries e de um
-- embed do PostgREST que a RLS pode barrar no meio.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_fila_listar(
  p_tenant_id uuid DEFAULT NULL,
  p_limite    integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
BEGIN
  -- coalesce POR FORA da expressão inteira: com v_tenant e current_tenant_id()
  -- ambos NULL, `v = v` é NULL, `NULL OR false` é NULL e `NOT NULL` é NULL —
  -- o IF não dispara e o portão libera justamente para quem não tem perfil.
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.ordem, x.enfileirado_em DESC)
      FROM (
        SELECT f.id, f.acao, f.status, f.tentativas, f.ultimo_erro, f.http,
               f.quantidade, f.oem_modulo_codigo, f.empresa_codigo, f.filial_codigo,
               f.enfileirado_em, f.processado_em, f.proxima_tentativa_em,
               coalesce(c.nome_fantasia, c.razao_social) AS cliente,
               pr.nome  AS produto,
               pm.nome  AS modulo,
               -- Erro em cima: é o que precisa de gente. 'ok' desce.
               CASE f.status WHEN 'invalido' THEN 0 WHEN 'erro' THEN 1
                             WHEN 'processando' THEN 2 WHEN 'pendente' THEN 3
                             ELSE 4 END AS ordem
          FROM public.oem_sync_fila f
          LEFT JOIN public.cliente_produtos cp ON cp.id = f.cliente_produto_id
          LEFT JOIN public.clientes c          ON c.id = cp.cliente_id
          LEFT JOIN public.produtos pr         ON pr.id = cp.produto_id
          LEFT JOIN public.cliente_produto_modulos cpm ON cpm.id = f.modulo_linha_id
          LEFT JOIN public.produto_modulos pm  ON pm.id = cpm.modulo_id
         WHERE (v_tenant IS NULL OR f.tenant_id = v_tenant)
         ORDER BY ordem, f.enfileirado_em DESC
         LIMIT greatest(coalesce(p_limite, 100), 1)
      ) x
  ), '[]'::jsonb);
END;
$$;

ALTER FUNCTION public.fn_oem_fila_listar(uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_listar(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_listar(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_listar(uuid, integer) TO authenticated, service_role;

-- ============================================================================
-- O cron. Mesmo desenho do cron_recon_espelho: segredo no Vault, nunca no
-- código, e o request_id gravado em cron_estado para a tela saber se rodou.
--
-- O segredo é criado aqui se ainda não existir. A edge function o lê do próprio
-- Vault para conferir o Bearer — assim ele mora num lugar só e não precisa ser
-- repetido em `supabase secrets set`.
-- ============================================================================
DO $seg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'oem_sync_cron_secret') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'oem_sync_cron_secret',
      'Bearer que o cron_oem_sync usa para chamar a edge function oem-sync-processar.'
    );
  END IF;
END
$seg$;

-- A edge function confere o Bearer por aqui, em vez de receber o segredo por
-- `supabase secrets set`. Assim ele mora num lugar só (o Vault) e não existe a
-- chance de as duas cópias divergirem.
CREATE OR REPLACE FUNCTION public.fn_oem_cron_secret_ok(p_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
     WHERE s.name = 'oem_sync_cron_secret'
       AND s.decrypted_secret = p_token
  );
$$;

ALTER FUNCTION public.fn_oem_cron_secret_ok(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_cron_secret_ok(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_cron_secret_ok(text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_cron_secret_ok(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_cron_secret_ok(text) TO service_role;

CREATE OR REPLACE FUNCTION public.cron_oem_sync() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_segredo text;
  v_req     bigint;
BEGIN
  SELECT s.decrypted_secret INTO v_segredo
    FROM vault.decrypted_secrets s
   WHERE s.name = 'oem_sync_cron_secret';

  IF v_segredo IS NULL THEN
    RAISE WARNING 'cron_oem_sync: segredo ausente no vault; nada disparado';
    RETURN;
  END IF;

  -- Fila vazia não merece uma chamada HTTP a cada 2 minutos. 720 chamadas/dia
  -- para não fazer nada é egress e log por nada.
  IF NOT EXISTS (
    SELECT 1 FROM public.oem_sync_fila
     WHERE status IN ('pendente','erro') AND proxima_tentativa_em <= now()
  ) THEN
    RETURN;
  END IF;

  SELECT net.http_post(
    url     := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/oem-sync-processar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_segredo
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_req;

  INSERT INTO public.cron_estado (jobname, ultimo_request_id, ultima_execucao)
  VALUES ('oem-sync-processar', v_req, now())
  ON CONFLICT (jobname) DO UPDATE
    SET ultimo_request_id = excluded.ultimo_request_id,
        ultima_execucao   = excluded.ultima_execucao;
END;
$$;

ALTER FUNCTION public.cron_oem_sync() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cron_oem_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_oem_sync() FROM anon;
REVOKE ALL ON FUNCTION public.cron_oem_sync() FROM authenticated;

SELECT cron.unschedule('oem-sync-processar')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oem-sync-processar');

SELECT cron.schedule('oem-sync-processar', '*/2 * * * *', $cron$SELECT public.cron_oem_sync();$cron$);
