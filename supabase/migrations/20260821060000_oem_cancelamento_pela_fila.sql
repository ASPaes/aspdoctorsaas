-- ============================================================================
-- O cancelamento de módulo passa a nascer na fila.
--
-- A REGRA QUE NÃO MUDA: OEM primeiro, ficha depois. Recusa do parceiro não
-- altera nada aqui — é o que impede as duas bases de divergirem, e foi decidido
-- assim de propósito. O que muda é que a tentativa vira uma LINHA, com o motivo
-- escrito, em vez de um aviso de tela que some.
--
-- Como fica: quem clica enfileira (é aí que a permissão é conferida) e pede o
-- processamento na hora — o caminho feliz continua respondendo na hora. O que
-- o parceiro recusar fica na fila e o cron tenta de novo. A ficha só é tocada
-- depois do "ok" do OEM, dentro do processador.
--
-- Por isso a linha da fila precisa carregar também o lado da ficha (quanto
-- cancelar, motivo, data): quando a escrita no parceiro passar, na primeira
-- tentativa ou na quarta, o processador tem que conseguir terminar o serviço
-- sem ninguém por perto.
-- ============================================================================

ALTER TABLE public.oem_sync_fila
  ADD COLUMN IF NOT EXISTS payload jsonb;

COMMENT ON COLUMN public.oem_sync_fila.payload IS
  'O lado da ficha da mesma ação (quantidade a cancelar, motivo, data). Aplicado só depois do ok do parceiro.';

-- ============================================================================
-- 1. A regra do cancelamento sai de dentro do portão.
--
--    fn_cancelar_modulo_cliente continua sendo a porta de quem clica, com a
--    checagem de permissão. O miolo vira uma função à parte que o processador
--    pode chamar: quando a linha da fila é executada, a autorização JÁ
--    aconteceu — na hora do enfileiramento, com o usuário presente. Repetir a
--    checagem lá seria pedir permissão a um cron, que não tem perfil nenhum e
--    reprovaria sempre.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_cancelar_modulo_aplicar(
  p_id         uuid,
  p_quantidade numeric DEFAULT NULL,
  p_motivo     text    DEFAULT NULL,
  p_motivo_id  bigint  DEFAULT NULL,
  p_data       date    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row    public.cliente_produto_modulos;
  v_atual  numeric;
  v_cancel numeric;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  -- Meia-noite em São Paulo, não em UTC: `v_data::timestamptz` num banco em UTC
  -- cairia às 21h do dia anterior.
  v_data   date := coalesce(p_data, current_date);
BEGIN
  SELECT * INTO v_row FROM public.cliente_produto_modulos WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.ativo = false THEN
    RAISE EXCEPTION 'Este módulo já está cancelado.' USING ERRCODE = '22023';
  END IF;

  IF p_motivo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.motivos_cancelamento m
     WHERE m.id = p_motivo_id
       AND (m.tenant_id IS NULL OR m.tenant_id = v_row.tenant_id)
  ) THEN
    RAISE EXCEPTION 'Motivo de cancelamento inválido para este cliente.' USING ERRCODE = '23503';
  END IF;

  v_atual  := greatest(coalesce(v_row.quantidade, 1), 1);
  v_cancel := least(greatest(coalesce(p_quantidade, v_atual), 1), v_atual);

  IF v_cancel >= v_atual THEN
    UPDATE public.cliente_produto_modulos
       SET ativo                  = false,
           data_inativacao        = v_data,
           cancelado_manual       = true,
           cancelamento_motivo    = v_motivo,
           motivo_cancelamento_id = p_motivo_id,
           cancelado_em           = (v_data::timestamp AT TIME ZONE 'America/Sao_Paulo'),
           cancelado_por          = coalesce(auth.uid(), v_row.cancelado_por),
           updated_at             = now()
     WHERE id = p_id;

    RETURN jsonb_build_object('cancelado', true, 'parcial', false,
                              'quantidade', v_cancel, 'data', v_data);
  END IF;

  UPDATE public.cliente_produto_modulos
     SET quantidade             = v_atual - v_cancel,
         quantidade_manual      = v_atual - v_cancel,
         cancelamento_motivo    = v_motivo,
         motivo_cancelamento_id = p_motivo_id,
         cancelado_em           = (v_data::timestamp AT TIME ZONE 'America/Sao_Paulo'),
         cancelado_por          = coalesce(auth.uid(), v_row.cancelado_por),
         updated_at             = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('cancelado', true, 'parcial', true,
                            'quantidade', v_cancel, 'restante', v_atual - v_cancel,
                            'data', v_data);
END;
$fn$;

ALTER FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) FROM anon;
-- Sem GRANT para authenticated: esta é a versão SEM portão. Quem vem do
-- navegador entra por fn_cancelar_modulo_cliente.
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) TO service_role;

-- A porta de quem clica: só o portão, e o miolo é o de cima.
CREATE OR REPLACE FUNCTION public.fn_cancelar_modulo_cliente(
  p_id         uuid,
  p_quantidade numeric DEFAULT NULL,
  p_motivo     text    DEFAULT NULL,
  p_motivo_id  bigint  DEFAULT NULL,
  p_data       date    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.cliente_produto_modulos WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- coalesce POR FORA da expressão inteira: com current_tenant_id() e
  -- is_super_admin() ambos NULL, `NOT NULL` é NULL, o IF não dispara e o portão
  -- liberaria justamente para quem não tem perfil.
  IF NOT coalesce(
    (v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  RETURN public.fn_cancelar_modulo_aplicar(p_id, p_quantidade, p_motivo, p_motivo_id, p_data);
END;
$fn$;

ALTER FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date)
  TO authenticated, service_role;

-- ============================================================================
-- 2. Enfileirar passa a aceitar o lado da ficha.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar(
  p_modulo_linha_id uuid,
  p_acao            text,
  p_quantidade      numeric DEFAULT NULL,
  p_payload         jsonb   DEFAULT NULL
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

  IF NOT coalesce(
    (v_mod.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = v_mod.cliente_produto_id;

  -- Módulo digitado à mão não tem licença no parceiro. Enfileirar seria criar
  -- uma linha que nasce condenada a falhar; quem chamou trata o NULL.
  IF v_mod.origem <> 'oem' OR v_cp.oem_codigo_filial IS NULL OR v_mod.oem_modulo_codigo IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_linha_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id
  )
  SELECT
    v_mod.tenant_id,
    (SELECT id FROM public.oem_integration
      WHERE tenant_id = v_mod.tenant_id AND ativo = true ORDER BY created_at LIMIT 1),
    v_cp.id, v_mod.id,
    p_acao, v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_mod.oem_modulo_codigo,
    -- No cancelamento, o número que vai ao parceiro é QUANTO SOBRA na licença,
    -- não quanto foi cancelado. Trocar os dois zera licença de quem cancelou 1
    -- de 8.
    CASE WHEN p_acao = 'cancelar'
         THEN greatest(coalesce(v_mod.quantidade, 1)
                       - least(greatest(coalesce(p_quantidade, coalesce(v_mod.quantidade, 1)), 1),
                               greatest(coalesce(v_mod.quantidade, 1), 1)), 0)
         ELSE coalesce(p_quantidade, v_mod.quantidade, 1) END,
    v_mod.vlr_custo,
    p_payload,
    auth.uid()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) TO authenticated, service_role;

-- A assinatura de 3 argumentos vira sobrecarga ambígua com a nova (o 4º tem
-- default). Sai — ninguém chamou ainda, a fila nasceu ontem.
DROP FUNCTION IF EXISTS public.fn_oem_enfileirar(uuid, text, numeric);

-- ============================================================================
-- 3. O processador termina o serviço na ficha depois do ok do parceiro.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_fila_aplicar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linha public.oem_sync_fila;
  v_res   jsonb;
BEGIN
  SELECT * INTO v_linha FROM public.oem_sync_fila WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha da fila não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_linha.acao <> 'cancelar' THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'ação sem efeito na ficha');
  END IF;

  IF v_linha.modulo_linha_id IS NULL THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha sem módulo');
  END IF;

  -- Já aplicado numa passada anterior (o parceiro respondeu ok e a gravação
  -- daqui falhou depois). Repetir levantaria "módulo já cancelado" e a linha
  -- ficaria presa em erro para sempre.
  IF EXISTS (SELECT 1 FROM public.cliente_produto_modulos
              WHERE id = v_linha.modulo_linha_id AND ativo = false) THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'módulo já estava cancelado');
  END IF;

  v_res := public.fn_cancelar_modulo_aplicar(
    v_linha.modulo_linha_id,
    nullif(v_linha.payload->>'quantidade_cancelar', '')::numeric,
    v_linha.payload->>'motivo',
    nullif(v_linha.payload->>'motivo_id', '')::bigint,
    nullif(v_linha.payload->>'data', '')::date
  );

  RETURN jsonb_build_object('aplicado', true, 'ficha', v_res);
END;
$$;

ALTER FUNCTION public.fn_oem_fila_aplicar(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_aplicar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_aplicar(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_fila_aplicar(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_aplicar(uuid) TO service_role;

-- ============================================================================
-- 4. Pegar UMA linha pelo id, para o clique não esperar os 2 minutos do cron.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_fila_claim(
  p_limite integer DEFAULT 20,
  p_id     uuid    DEFAULT NULL
) RETURNS SETOF public.oem_sync_fila
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH alvo AS (
    SELECT id
      FROM public.oem_sync_fila
     WHERE status IN ('pendente', 'erro')
       AND (p_id IS NOT NULL OR proxima_tentativa_em <= now())
       AND (p_id IS NULL OR id = p_id)
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

ALTER FUNCTION public.fn_oem_fila_claim(integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_claim(integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_claim(integer, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_fila_claim(integer, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_claim(integer, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.fn_oem_fila_claim(integer);
