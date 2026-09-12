-- DEM-0342 (11/09/2026) - "so sincroniza na segunda alteracao" (Fabianne / Digi Office).
--
-- Par do omie-sync-processar v18. La, a linha de cadastro que esbarra em 'sem_depara' deixa de
-- morrer em 'ignorado' e passa a ESPERAR o vinculo, de 30 em 30 min, ate 48h. Aqui, a tela ganha
-- a frase que explica essa espera -- unica mudanca nesta funcao.
--
-- Por que era preciso: o painel monta o texto a partir deste CASE, nao do ultimo_erro cru. Sem o
-- ramo novo, toda linha esperando vinculo apareceria como "Aguardando nova tentativa (tentativa
-- 0)" -- numero que nem sobe, porque a v18 nao incrementa tentativas ao esperar.
--
-- Corpo copiado da definicao DE PRODUCAO (conferida em 11/09/2026, identica a migration
-- 20260813210000); so o ramo novo foi acrescentado. CREATE OR REPLACE preserva os grants.

BEGIN;

CREATE OR REPLACE FUNCTION public.omie_fila_status(p_tenant_id uuid, p_conta_integration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.tenant_id = p_tenant_id
        AND p.role IN ('admin','head')
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissao para ver a fila deste tenant.';
  END IF;

  WITH f AS (
    SELECT fl.id, fl.contrato_id, fl.status, fl.tentativas, fl.ultimo_erro,
           fl.proxima_tentativa_em, fl.origem, fl.enfileirado_em, fl.processado_em,
           cl.razao_social, cl.cnpj, cl.id AS cliente_id,
           (c.id IS NULL) AS contrato_removido,
           (
             fl.status IN ('invalido','erro','ignorado')
             AND EXISTS (
               SELECT 1 FROM omie_sync_fila o
               WHERE o.contrato_id = fl.contrato_id
                 AND o.tenant_id   = fl.tenant_id
                 AND o.conta_integration_id IS NOT DISTINCT FROM fl.conta_integration_id
                 AND o.id <> fl.id
                 AND o.status = 'ok'
                 AND o.processado_em > COALESCE(fl.processado_em, fl.enfileirado_em)
             )
           ) AS superada,
           r.acao_sugerida, r.status_usuario
    FROM omie_sync_fila fl
    LEFT JOIN contratos c  ON c.id  = fl.contrato_id
    LEFT JOIN clientes  cl ON cl.id = c.cliente_id
    LEFT JOIN reconciliacao_cadastro r
           ON r.tenant_id = fl.tenant_id AND r.ds_contract_id = fl.contrato_id
          AND r.conta_integration_id = p_conta_integration_id
    WHERE fl.tenant_id = p_tenant_id
      AND fl.conta_integration_id = p_conta_integration_id
  ),
  cfg AS (
    SELECT sync_automatica_ativa, integracao_pausada, sync_contratos_teste, omie_bloqueado_ate
    FROM omie_integration WHERE id = p_conta_integration_id
  ),
  cr AS (
    SELECT max(start_time) AS ultima
    FROM cron.job_run_details WHERE jobid = 59 AND status = 'succeeded'
  )
  SELECT jsonb_build_object(
    'gerado_em', now(),
    'saude', jsonb_build_object(
      'sync_ativo',    (SELECT sync_automatica_ativa FROM cfg),
      'pausado',       (SELECT integracao_pausada FROM cfg),
      'modo_teste',    (SELECT sync_contratos_teste IS NOT NULL FROM cfg),
      'bloqueado_ate', (SELECT omie_bloqueado_ate FROM cfg),
      'cron_ultima',   (SELECT ultima FROM cr),
      'cron_saudavel', (SELECT ultima > now() - interval '6 minutes' FROM cr)
    ),
    'resumo', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb)
               FROM (SELECT status, count(*) AS n FROM f GROUP BY status) s),
    'itens', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x->>'prio', x->>'enfileirado_em' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          -- 03/08/2026: 'invalido' acionavel (precisa de acao humana) vai pro TOPO.
          -- 'ignorado' e 'invalido de contrato removido' (descartaveis) vao pro fim.
          -- 13/08/2026: linha superada tambem e descartavel -- nao disputa o topo com o
          -- problema de verdade, senao volta o efeito de "fila pior do que esta".
          'prio', CASE
                    WHEN f.superada                                          THEN '5'
                    WHEN f.status = 'invalido' AND NOT f.contrato_removido THEN '1'
                    WHEN f.status = 'erro'        THEN '2'
                    WHEN f.status = 'processando' THEN '3'
                    WHEN f.status = 'pendente'    THEN '4'
                    WHEN f.status = 'invalido'    THEN '5'  -- contrato removido, descartavel
                    WHEN f.status = 'ignorado'    THEN '6'
                    ELSE '5' END,
          'fila_id',              f.id,
          'cliente_id',           f.cliente_id,
          'contrato_id',          f.contrato_id,
          'cliente',              COALESCE(f.razao_social, '(contrato removido do DoctorSaaS)'),
          'cnpj',                 f.cnpj,
          'contrato_removido',    f.contrato_removido,
          'superada',             f.superada,
          'origem',               f.origem,
          'status',               f.status,
          'tentativas',           f.tentativas,
          'enfileirado_em',       f.enfileirado_em,
          'processado_em',        f.processado_em,
          'proxima_tentativa_em', f.proxima_tentativa_em,
          'motivo', CASE
            WHEN f.superada THEN
              'Um envio posterior deste contrato chegou ao Omie. Esta linha e o rastro da tentativa antiga.'
            WHEN f.status = 'ignorado' AND f.ultimo_erro LIKE 'sem_vinculo%' THEN
              CASE
                WHEN f.status_usuario IN ('vinculado','resolvido')
                  THEN 'O contrato JA foi vinculado depois deste envio. Esta alteracao nao chegou ao Omie e nao sera reenviada sozinha: edite o campo de novo para reenfileirar.'
                WHEN f.acao_sugerida = 'escolher_candidato'
                  THEN 'Contrato nao vinculado ao Omie. Resolva na aba Escolher Candidato - nada foi escrito no Omie.'
                WHEN f.acao_sugerida = 'pendente_assuncao'
                  THEN 'Contrato existe no Omie mas foi criado por outra integracao. Precisa de assuncao na Conferencia - nada foi escrito no Omie. NAO aparece na aba Escolher Candidato.'
                WHEN f.acao_sugerida IS NOT NULL
                  THEN 'Pendente na Conferencia (' || f.acao_sugerida || ') - nada foi escrito no Omie.'
                ELSE 'Contrato nao vinculado ao Omie - nada foi escrito no Omie.'
              END
            WHEN f.status = 'ignorado' THEN COALESCE(f.ultimo_erro, 'Ignorado.')
            WHEN f.status = 'invalido' AND f.contrato_removido
              THEN 'O contrato foi removido do DoctorSaaS depois de entrar na fila. Nada foi escrito no Omie; pode descartar.'
            WHEN f.status = 'invalido' THEN COALESCE(f.ultimo_erro, 'Invalido.')
            WHEN f.status = 'erro'     THEN f.ultimo_erro
            -- DEM-0342 (11/09/2026): a espera pelo vinculo NAO e retentativa de falha. Sem este
            -- ramo a tela dizia "Aguardando nova tentativa (tentativa 0)", que nao explica nada
            -- a quem acabou de salvar o cadastro e quer saber se aquilo chegou no Omie.
            -- O carimbo vem do omie-sync-processar v18 (PREFIXO_AGUARDANDO_VINCULO).
            WHEN f.status = 'pendente' AND f.ultimo_erro LIKE 'aguardando_vinculo%'
              THEN 'Alteracao guardada: o contrato ainda nao esta vinculado ao Omie. A fila reenvia sozinha assim que o vinculo aparecer (ate 48h depois da edicao). Nada foi escrito no Omie.'
            WHEN f.status = 'pendente' AND f.proxima_tentativa_em > now()
              THEN 'Aguardando nova tentativa (tentativa ' || COALESCE(f.tentativas, 0) || ').'
            WHEN f.status = 'pendente'    THEN 'Na fila, aguardando o processador (roda a cada 2 min).'
            WHEN f.status = 'processando' THEN 'Sendo enviado ao Omie agora.'
            ELSE NULL END
        ) AS x
        FROM f WHERE f.status <> 'ok'
        LIMIT 200
      ) t
    ),
    'ok_recentes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'cliente', razao_social, 'origem', origem, 'processado_em', processado_em
             ) ORDER BY processado_em DESC), '[]'::jsonb)
      FROM (SELECT COALESCE(razao_social, '(contrato removido do DoctorSaaS)') AS razao_social,
                   origem, processado_em
            FROM f WHERE status = 'ok'
            ORDER BY processado_em DESC NULLS LAST LIMIT 20) r
    )
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

COMMIT;
