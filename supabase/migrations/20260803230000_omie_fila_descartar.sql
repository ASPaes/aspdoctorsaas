-- DEM-0237 — parte D: poder tirar da fila o que não tem o que corrigir.
--
-- POR QUE
--   A tela da fila mostrava 3 linhas cujo próprio texto dizia "pode descartar" — e o único botão
--   disponível era "Reprocessar", que nesses casos não pode funcionar (o contrato foi apagado do
--   DoctorSaaS; o montar_payload_contrato_omie devolve "Contrato nao encontrado"). Ficavam para
--   sempre na tela, empurrando para baixo os problemas de verdade e fazendo a fila parecer pior
--   do que está.
--
-- O QUE PODE SER DESCARTADO (o gate mora aqui, não no frontend)
--   1. contrato apagado do DoctorSaaS depois de entrar na fila;
--   2. linha 'ignorado' — por definição, NADA foi escrito no Omie.
--   Qualquer outra linha continua exigindo que a causa seja resolvida. Descartar um bloqueio real
--   seria varrer para debaixo do tapete: o contrato seguiria divergente e sem rastro na tela.
--
-- POR QUE DELETE E NÃO status='descartado'
--   `chk_omie_sync_status` não aceita valor novo, e mudar o CHECK obrigaria a revisar todo
--   consumidor de status (processador, alertas, omie_fila_status). A linha é de FILA, não de
--   histórico: o que aconteceu de fato com o contrato está no integrations_log do DoctorOMIE.

BEGIN;

CREATE OR REPLACE FUNCTION public.omie_fila_descartar(p_fila_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_linha    omie_sync_fila%ROWTYPE;
  v_removido boolean;
BEGIN
  SELECT * INTO v_linha FROM omie_sync_fila WHERE id = p_fila_id;
  IF NOT FOUND THEN
    -- Já saiu (outra aba, outro usuário). Do ponto de vista de quem clicou, deu certo.
    RETURN jsonb_build_object('ok', true, 'acao', 'ja_removida');
  END IF;

  -- Mesma regra de permissão do omie_fila_status e do omie_fila_reprocessar.
  IF NOT (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.tenant_id = v_linha.tenant_id
        AND p.role IN ('admin','head')
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissao para descartar linha da fila deste tenant.';
  END IF;

  -- Nunca arrancar linha em voo nem linha que ainda vai ser tentada.
  IF v_linha.status IN ('pendente','processando') THEN
    RETURN jsonb_build_object('ok', false,
      'erro', 'Esta linha ainda está na fila para ser enviada. Espere terminar antes de descartar.');
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM contratos c WHERE c.id = v_linha.contrato_id) INTO v_removido;

  IF NOT (v_removido OR v_linha.status = 'ignorado') THEN
    RETURN jsonb_build_object('ok', false,
      'erro', 'Esta linha está bloqueada por uma causa que ainda existe. Resolva a causa e use Reprocessar — descartar só esconderia a divergência.');
  END IF;

  DELETE FROM omie_sync_fila WHERE id = p_fila_id;

  RETURN jsonb_build_object('ok', true, 'acao', 'descartada',
    'motivo', CASE WHEN v_removido THEN 'contrato_removido' ELSE 'ignorado' END);
END;
$function$;

REVOKE ALL ON FUNCTION public.omie_fila_descartar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omie_fila_descartar(uuid) TO authenticated, service_role;

COMMIT;
