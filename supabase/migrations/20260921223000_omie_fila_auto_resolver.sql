-- omie_fila_auto_resolver — a fila fecha sozinha o que não precisa de gente.
--
-- Por que existe (21/09/2026): das 7 linhas paradas em toda a base, 3 classes não tinham decisão
-- humana nenhuma para tomar e mesmo assim ficavam vermelhas no painel esperando clique:
--
--   1. contrato apagado no DoctorSaaS depois de entrar na fila — nada foi escrito no Omie;
--   2. linha superada por um envio posterior do MESMO contrato que chegou ao Omie — é rastro;
--   3. cancelamento de contrato que nunca chegou ao Omie — não existe o que cancelar lá.
--
-- As duas primeiras a tela JÁ sabia diagnosticar (o omie_fila_status devolve `contrato_removido`
-- e `superada`) e ainda assim pedia clique. A terceira aparecia como "Contrato ainda não vinculado
-- ao OMIE", com dois caminhos oferecidos, quando o certo era nenhum.
--
-- A terceira é a única com risco de verdade: descartar um cancelamento que DEVERIA ter ido ao Omie
-- deixaria contrato faturando lá com o cliente cancelado aqui. Por isso ela não fecha por dedução
-- ("é churn sem vínculo"), e sim por EVIDÊNCIA, com quatro condições ao mesmo tempo: sem de/para
-- conhecido, a Conferência não marcou como vinculado, o espelho do Omie dessa conta mostra o
-- cliente com ZERO contratos ativos, e esse espelho foi atualizado nos últimos 7 dias. Espelho
-- velho ou ausente = não fecha, fica para a pessoa.
--
-- Fecha = DELETE, igual ao que o botão Descartar já fazia. A diferença é que aqui fica rastro:
-- cada linha fechada sozinha vira um `omie_fila_auto_resolvida` em audit_events, senão ninguém
-- conseguiria responder depois por que a linha sumiu.
--
-- O quarto caso não é fechamento e sim retomada: linha parada em `validacao:` cuja causa já foi
-- corrigida no DoctorSaaS volta para a fila sozinha. Quem decide é o omie_fila_reprocessar, que
-- revalida com montar_payload_contrato_omie — checagem 100% do lado DS, sem consumir chamada do
-- Omie (importante: o Omie recusa leitura repetida, ver a v18 da omie-integration-call).

CREATE OR REPLACE FUNCTION public.omie_fila_auto_resolver(
  p_tenant_id             uuid,
  p_conta_integration_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor     uuid := auth.uid();
  v_linha     record;
  v_motivo    text;
  v_res       jsonb;
  v_fechadas  integer := 0;
  v_reenfil   integer := 0;
  v_detalhes  jsonb   := '[]'::jsonb;
BEGIN
  -- Mesma regra de permissão do omie_fila_status / _reprocessar / _descartar.
  -- COALESCE de proposito: is_super_admin() devolve NULL para quem nao tem perfil, e
  -- `IF NOT (NULL OR false)` nao dispara -- o portao ficaria aberto em silencio.
  IF NOT (
    COALESCE(public.is_super_admin(), false)
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.tenant_id = p_tenant_id
        AND p.role IN ('admin','head')
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissao para resolver a fila deste tenant.';
  END IF;

  -- ========================================================================
  -- 1) O que não precisa de gente: fecha.
  -- ========================================================================
  FOR v_linha IN
    SELECT fl.id, fl.contrato_id, fl.origem, fl.status, fl.ultimo_erro,
           cl.razao_social,
           (c.id IS NULL) AS contrato_removido,
           EXISTS (
             SELECT 1 FROM omie_sync_fila o
             WHERE o.contrato_id = fl.contrato_id
               AND o.tenant_id   = fl.tenant_id
               AND o.conta_integration_id IS NOT DISTINCT FROM fl.conta_integration_id
               AND o.id <> fl.id
               AND o.status = 'ok'
               AND o.processado_em > COALESCE(fl.processado_em, fl.enfileirado_em)
           ) AS superada,
           rec.status_usuario,
           rec.codigo_contrato_omie,
           esp.qtd_ativos,
           esp.atualizado_em
      FROM omie_sync_fila fl
      LEFT JOIN contratos c  ON c.id  = fl.contrato_id
      LEFT JOIN clientes  cl ON cl.id = c.cliente_id
      LEFT JOIN reconciliacao_cadastro rec
             ON rec.tenant_id = fl.tenant_id
            AND rec.ds_contract_id = fl.contrato_id
            AND rec.conta_integration_id = fl.conta_integration_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(MAX(e.qtd_contratos_ativos_omie), 0) AS qtd_ativos,
               MAX(e.atualizado_em)                          AS atualizado_em
          FROM omie_espelho_cadastro e
         WHERE e.conta_integration_id = fl.conta_integration_id
           AND e.cnpj_norm = regexp_replace(COALESCE(cl.cnpj, ''), '[^0-9]', '', 'g')
           AND COALESCE(cl.cnpj, '') <> ''
      ) esp ON TRUE
     WHERE fl.tenant_id = p_tenant_id
       AND fl.conta_integration_id = p_conta_integration_id
       AND fl.status IN ('erro','invalido','ignorado')
  LOOP
    v_motivo := NULL;

    IF v_linha.contrato_removido THEN
      v_motivo := 'contrato_removido';
    ELSIF v_linha.superada THEN
      v_motivo := 'superada_por_envio_posterior';
    ELSIF v_linha.origem = 'churn'
      AND v_linha.status = 'ignorado'
      AND COALESCE(v_linha.ultimo_erro, '') LIKE 'sem_vinculo%'
      AND COALESCE(v_linha.status_usuario, '') NOT IN ('vinculado','resolvido')
      AND v_linha.codigo_contrato_omie IS NULL
      AND v_linha.atualizado_em IS NOT NULL
      AND v_linha.atualizado_em > now() - interval '7 days'
      AND COALESCE(v_linha.qtd_ativos, 0) = 0
    THEN
      v_motivo := 'cancelamento_sem_contrato_no_omie';
    END IF;

    IF v_motivo IS NOT NULL THEN
      DELETE FROM omie_sync_fila WHERE id = v_linha.id;

      INSERT INTO audit_events (tenant_id, actor_user_id, event_type, metadata)
      VALUES (
        p_tenant_id, v_actor, 'omie_fila_auto_resolvida',
        jsonb_build_object(
          'fila_id',     v_linha.id,
          'contrato_id', v_linha.contrato_id,
          'cliente',     v_linha.razao_social,
          'origem',      v_linha.origem,
          'status',      v_linha.status,
          'ultimo_erro', v_linha.ultimo_erro,
          'motivo',      v_motivo,
          'conta_integration_id', p_conta_integration_id
        )
      );

      v_fechadas := v_fechadas + 1;
      v_detalhes := v_detalhes || jsonb_build_object(
        'cliente', COALESCE(v_linha.razao_social, '(contrato removido do DoctorSaaS)'),
        'acao',    'fechada',
        'motivo',  v_motivo
      );
    END IF;
  END LOOP;

  -- ========================================================================
  -- 2) Causa já corrigida no DoctorSaaS: volta para a fila.
  -- ========================================================================
  FOR v_linha IN
    SELECT fl.id, cl.razao_social
      FROM omie_sync_fila fl
      JOIN contratos c  ON c.id  = fl.contrato_id
      LEFT JOIN clientes cl ON cl.id = c.cliente_id
     WHERE fl.tenant_id = p_tenant_id
       AND fl.conta_integration_id = p_conta_integration_id
       AND fl.status = 'invalido'
       AND COALESCE(fl.ultimo_erro, '') LIKE 'validacao:%'
  LOOP
    v_res := public.omie_fila_reprocessar(v_linha.id);
    IF COALESCE((v_res->>'ok')::boolean, false) THEN
      v_reenfil := v_reenfil + 1;
      v_detalhes := v_detalhes || jsonb_build_object(
        'cliente', COALESCE(v_linha.razao_social, '(sem cliente)'),
        'acao',    'reenfileirada',
        'motivo',  'validacao_ja_corrigida'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',             true,
    'fechadas',       v_fechadas,
    'reenfileiradas', v_reenfil,
    'detalhes',       v_detalhes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.omie_fila_auto_resolver(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omie_fila_auto_resolver(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.omie_fila_auto_resolver(uuid, uuid) TO authenticated, service_role;
