-- ============================================================================
-- Cancelamento de módulo: data escolhida na tela + motivo do catálogo.
--
-- Até aqui a tela só tinha um campo de texto livre e a data era sempre a de
-- hoje, decidida pelo banco. Quem lança um cancelamento dias depois não tinha
-- como dizer quando ele aconteceu, e "motivo" não somava com nada — cada pessoa
-- escrevia à sua maneira, então não dava para agrupar churn por causa.
--
-- O texto livre continua, agora como observação; o motivo passa a sair de
-- motivos_cancelamento, a mesma lista que o cancelamento de produto usa.
-- ============================================================================

ALTER TABLE public.cliente_produto_modulos
  ADD COLUMN IF NOT EXISTS motivo_cancelamento_id bigint;

ALTER TABLE public.cliente_produto_modulos
  DROP CONSTRAINT IF EXISTS cliente_produto_modulos_motivo_cancelamento_id_fkey;
ALTER TABLE public.cliente_produto_modulos
  ADD CONSTRAINT cliente_produto_modulos_motivo_cancelamento_id_fkey
  FOREIGN KEY (motivo_cancelamento_id) REFERENCES public.motivos_cancelamento(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cliente_produto_modulos.motivo_cancelamento_id IS
  'Motivo do catálogo (motivos_cancelamento) escolhido ao cancelar. O texto livre continua em cancelamento_motivo, como observação.';

-- A assinatura ganha 2 parâmetros, então é DROP + CREATE: CREATE OR REPLACE
-- criaria uma SOBRECARGA, e a chamada com 3 argumentos passaria a ser ambígua
-- ("function name is not unique").
DROP FUNCTION IF EXISTS public.fn_cancelar_modulo_cliente(uuid, numeric, text);

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
  v_row    public.cliente_produto_modulos;
  v_atual  numeric;
  v_cancel numeric;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  -- Sem data informada vale hoje. O horário é meia-noite em São Paulo, não em
  -- UTC: `v_data::timestamptz` num banco em UTC cairia às 21h do dia anterior.
  v_data   date := coalesce(p_data, current_date);
BEGIN
  SELECT * INTO v_row FROM public.cliente_produto_modulos WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Mesmo portão das policies da tabela: dono do tenant (ou super admin) e
  -- admin/head. coalesce porque helper que devolve NULL faria o IF nunca
  -- disparar — o portão passaria a liberar.
  IF NOT (
    (v_row.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  IF v_row.ativo = false THEN
    RAISE EXCEPTION 'Este módulo já está cancelado.' USING ERRCODE = '22023';
  END IF;

  -- Motivo tem que existir e ser do tenant do cliente (ou global). Sem isto, um
  -- id de outro tenant entraria pela FK sem reclamar.
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
           cancelado_por          = auth.uid(),
           updated_at             = now()
     WHERE id = p_id;

    RETURN jsonb_build_object('cancelado', true, 'parcial', false,
                              'quantidade', v_cancel, 'data', v_data);
  END IF;

  -- Parcial: sobra o que não foi cancelado, e a quantidade passa a ser decidida
  -- aqui — senão a próxima carga do OEM devolveria a quantidade antiga.
  UPDATE public.cliente_produto_modulos
     SET quantidade             = v_atual - v_cancel,
         quantidade_manual      = v_atual - v_cancel,
         cancelamento_motivo    = v_motivo,
         motivo_cancelamento_id = p_motivo_id,
         cancelado_em           = (v_data::timestamp AT TIME ZONE 'America/Sao_Paulo'),
         cancelado_por          = auth.uid(),
         updated_at             = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('cancelado', true, 'parcial', true,
                            'quantidade', v_cancel, 'restante', v_atual - v_cancel,
                            'data', v_data);
END;
$fn$;

ALTER FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date)
  TO authenticated, service_role;
