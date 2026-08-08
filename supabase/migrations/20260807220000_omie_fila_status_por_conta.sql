-- Corrige a omie_fila_status: a CONTAGEM da fila continuava por tenant.
--
-- A geracao da F3b (migration 20260807050000) trocou o FROM omie_integration pela conta, mas
-- nao tocou no WHERE da propria fila. Efeito medido em producao: com a Digi Up selecionada, o
-- card "Fila de sincronizacao" mostrava OK 181 -- que e o numero da DIGI OFFICE. O banner de
-- "integracao pausada" vinha certo (esse le a conta); a contagem, nao. Numero de uma unidade
-- sob o nome da outra e exatamente o que esta feature existe para impedir.
--
-- Vai junto o join da reconciliacao dentro do CTE: sem a conta ali, um contrato presente nas
-- duas contas traria a linha da conta errada.

begin;
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
          'prio', CASE
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
          'origem',               f.origem,
          'status',               f.status,
          'tentativas',           f.tentativas,
          'enfileirado_em',       f.enfileirado_em,
          'processado_em',        f.processado_em,
          'proxima_tentativa_em', f.proxima_tentativa_em,
          'motivo', CASE
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

commit;
