-- Fila do Omie: poder tirar da tela a tentativa que um envio POSTERIOR já resolveu.
--
-- O CASO (13/08/2026, DigiOffice / unidade Digi Up, CNPJ 48.269.249/0001-23)
--   O contrato foi cadastrado sem modelo de contrato. Dois cliques em "Enviar para Omie"
--   morreram em `invalido` com `validacao:[Contrato sem modelo de contrato definido...]`.
--   O modelo foi preenchido, o terceiro clique foi `ok` e o contrato ESTA correto no Omie.
--   As duas linhas antigas ficaram na tela para sempre:
--     - `omie_fila_descartar` recusa (o contrato existe e o status nao e 'ignorado');
--     - "Reprocessar" nao serve: reenviaria de novo o que ja esta la.
--   Isso nao e detalhe cosmetico -- e o mesmo defeito nº 3 da DEM-0237: a fila fica parecendo
--   pior do que esta e o problema de verdade some no meio do lixo.
--
-- POR QUE ACONTECE SEMPRE
--   Cada clique em "Enviar para Omie" (solicitar_sync_omie) nasce como uma LINHA NOVA: a
--   coalescencia do enfileirar_sync_omie so alcanca linha `pendente`, e a que falhou ja e
--   terminal. Ou seja: toda correcao feita na mao deixa para tras o rastro da tentativa que
--   falhou, e nao existia caminho para limpar.
--
-- A REGRA NOVA (3º caso de descarte; o gate continua morando aqui, nao no frontend)
--   Linha terminal cujo MESMO contrato, na MESMA conta Omie, tem outra linha `ok` processada
--   DEPOIS dela. Nesse caso o estado ja convergiu por outro caminho -- descartar nao esconde
--   divergencia nenhuma, so remove o rastro. Se nao houver esse `ok` posterior, a RPC continua
--   recusando exatamente como antes.
--
--   O carimbo comparado e COALESCE(processado_em, enfileirado_em) da linha velha: linha que
--   nunca chegou a ser processada so tem o enfileirado_em.

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
  v_superada boolean;
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

  -- Um envio posterior do mesmo contrato já chegou ao Omie: esta linha é rastro, não pendência.
  SELECT EXISTS (
    SELECT 1
    FROM omie_sync_fila o
    WHERE o.contrato_id = v_linha.contrato_id
      AND o.tenant_id   = v_linha.tenant_id
      AND o.conta_integration_id IS NOT DISTINCT FROM v_linha.conta_integration_id
      AND o.id <> v_linha.id
      AND o.status = 'ok'
      AND o.processado_em > COALESCE(v_linha.processado_em, v_linha.enfileirado_em)
  ) INTO v_superada;

  IF NOT (v_removido OR v_superada OR v_linha.status = 'ignorado') THEN
    RETURN jsonb_build_object('ok', false,
      'erro', 'Esta linha está bloqueada por uma causa que ainda existe. Resolva a causa e use Reprocessar — descartar só esconderia a divergência.');
  END IF;

  DELETE FROM omie_sync_fila WHERE id = p_fila_id;

  RETURN jsonb_build_object('ok', true, 'acao', 'descartada',
    'motivo', CASE
                WHEN v_removido THEN 'contrato_removido'
                WHEN v_superada THEN 'superada_por_envio_posterior'
                ELSE 'ignorado'
              END);
END;
$function$;

REVOKE ALL ON FUNCTION public.omie_fila_descartar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omie_fila_descartar(uuid) TO authenticated, service_role;


-- A tela precisa SABER que a linha está superada, senão continua oferecendo "Reprocessar"
-- (que reenviaria ao Omie o que já está lá) e escondendo o Descartar.
--
-- O EXISTS fica atrás das condições baratas de propósito: o AND curto-circuita, então ele só é
-- avaliado nas linhas terminais -- não em toda a fila da conta.
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
