-- F3b: os agregados da Conferencia passam a ser por CONTA Omie.
--
-- Estas 6 funcoes alimentam os baldes da Conferencia, o banner de saude e o painel da fila. Todas
-- somavam `where tenant_id = ...` -- com duas contas no mesmo tenant, Digi Office e Digi Up
-- apareceriam no MESMO numero, que e a mistura que esta feature existe para impedir.
--
-- A reconciliacao_visao_geral tinha, alem disso, o mesmo defeito do snapshot_reconciliacao_ds:
--   escopo AS (SELECT unidades_base_ids FROM omie_integration WHERE tenant_id = p_tenant_id)
-- sem LIMIT. Com 2 linhas isso e 'more than one row returned by a subquery used as an expression'
-- e a Visao Geral inteira quebra.
--
-- Padrao igual ao das outras fases: versao com a conta + a de 1 argumento virando resolvedora
-- (com 1 conta delega, com 2+ levanta 22023). As definicoes com conta foram GERADAS a partir do
-- `pg_get_functiondef` das que estao em producao, entao o corpo e byte a byte o mesmo fora os
-- filtros novos -- nao ha transcricao a mao aqui.

begin;

CREATE OR REPLACE FUNCTION public.reconciliacao_resumo(p_tenant_id uuid, p_conta_integration_id uuid, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(acao_sugerida text, qtd bigint, gerado_em timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.assert_tenant_scope(p_tenant_id);
  select r.acao_sugerida, count(*), max(r.gerado_em)
  from reconciliacao_cadastro r
  where r.tenant_id = p_tenant_id
    and r.conta_integration_id = p_conta_integration_id
    and (
      -- 17/07/2026 -- CONTA TUDO, ignora status_usuario. Dois motivos diferentes:
      --
      -- ALARME (vigencia_vencida_no_omie, contrato_suspenso, contrato_cancelado, resolver):
      --   derivado do espelho do Omie, nao tem "resolver na tela" -- some sozinho quando o Omie
      --   muda (cron recon-espelho-atualizar, */15). Vinculo nao tem relacao com contrato
      --   vencido/suspenso/cancelado no Omie nem com divergencia de valor.
      --
      -- INFORMATIVO (fora_do_escopo): modelo marcado sincroniza_omie=false. Nao ha acao, entao
      --   'resolvido' nao significa nada aqui. Filtrar escondia 15 dos 54 da DigiOffice
      --   (R$ 12.042,23) -- linhas que foram resolvidas como Ambiguo no lote de 14-15/07, antes
      --   de este balde existir, e que carregam status_usuario='resolvido' de la.
      r.acao_sugerida in ('vigencia_vencida_no_omie','contrato_suspenso','contrato_cancelado',
                          'resolver','fora_do_escopo')
      -- FILA: o operador age e a linha sai da lista.
      or coalesce(r.status_usuario,'') not in ('vinculado','resolvido')
    )
    and (
      p_fornecedor_ids is null
      or cardinality(p_fornecedor_ids) = 0
      or r.fornecedor_id = any(p_fornecedor_ids)
      or (-1 = any(p_fornecedor_ids) and r.fornecedor_id is null)
    )
  group by r.acao_sugerida;
$function$;

CREATE OR REPLACE FUNCTION public.reconciliacao_visao_geral(p_tenant_id uuid, p_conta_integration_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.assert_tenant_scope(p_tenant_id);
WITH escopo AS (
  SELECT unidades_base_ids AS ids FROM omie_integration WHERE id = p_conta_integration_id
),
rc AS (SELECT * FROM reconciliacao_cadastro WHERE tenant_id = p_tenant_id AND conta_integration_id = p_conta_integration_id),
om AS (SELECT * FROM omie_espelho_cadastro WHERE conta_integration_id = p_conta_integration_id)
SELECT jsonb_build_object(
  'gerado_em', (SELECT max(gerado_em) FROM rc),
  'ds', jsonb_build_object(
     -- clientes ativos DENTRO do escopo de unidades da integracao (NULL = todas)
     'clientes',          (SELECT count(*) FROM clientes cl
                           WHERE cl.tenant_id = p_tenant_id
                             AND COALESCE(cl.cancelado,false) = false
                             AND ( (SELECT ids FROM escopo) IS NULL
                                   OR cl.unidade_base_id IN (SELECT unnest(e.ids) FROM escopo e) )),
     'contratos_ativos',  (SELECT count(*) FROM rc),
     'mrr_total',         (SELECT COALESCE(sum(valor_mrr_ds),0) FROM rc),
     'mrr_conciliavel',   (SELECT COALESCE(sum(valor_mrr_ds),0) FROM rc WHERE estado_match='CASADO')
  ),
  'omie', jsonb_build_object(
     'clientes',          (SELECT count(*) FROM om),
     'contratos_ativos',  (SELECT count(*) FROM om WHERE codigo_contrato_omie IS NOT NULL),
     'mrr_total_ativos',  (SELECT COALESCE(sum(valor_omie),0) FROM om WHERE codigo_contrato_omie IS NOT NULL)
  ),
  'conciliado', jsonb_build_object(
     'contratos_casados', (SELECT count(*) FROM rc WHERE estado_match='CASADO'),
     'com_contrato_omie', (SELECT count(*) FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL),
     'mrr_casado_ds',     (SELECT COALESCE(sum(valor_mrr_ds),0) FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL),
     'mrr_casado_omie',   (SELECT COALESCE(sum(valor_omie),0)   FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL),
     'mrr_divergencia',   (SELECT COALESCE(sum(valor_mrr_ds),0)-COALESCE(sum(valor_omie),0) FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL),
     'divergencia_valor_qtd',      (SELECT count(*) FROM rc WHERE acao_sugerida='resolver'),
     'divergencia_valor_montante', (SELECT COALESCE(sum(valor_omie - valor_mrr_ds),0) FROM rc WHERE acao_sugerida='resolver'),
     'pendente_assuncao_mrr_omie', (SELECT COALESCE(sum(valor_omie),0) FROM rc WHERE acao_sugerida='pendente_assuncao' AND codigo_contrato_omie IS NOT NULL)
  ),
  'baldes', (SELECT COALESCE(jsonb_object_agg(acao_sugerida, qtd),'{}'::jsonb)
             FROM (SELECT acao_sugerida, count(*) qtd FROM rc GROUP BY acao_sugerida) b),
  'total_contratos', (SELECT count(*) FROM rc)
);
$function$;

CREATE OR REPLACE FUNCTION public.reconciliacao_fornecedores(p_tenant_id uuid, p_conta_integration_id uuid)
 RETURNS TABLE(fornecedor_id bigint, fornecedor_ds text, qtd bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.assert_tenant_scope(p_tenant_id);
  SELECT COALESCE(fornecedor_id, -1),
         COALESCE(fornecedor_ds, 'Sem fornecedor'),
         count(*)
  FROM reconciliacao_cadastro
  WHERE tenant_id = p_tenant_id
    AND conta_integration_id = p_conta_integration_id
  GROUP BY COALESCE(fornecedor_id, -1), COALESCE(fornecedor_ds, 'Sem fornecedor')
  ORDER BY count(*) DESC;
$function$;

CREATE OR REPLACE FUNCTION public.reconciliacao_fornecedores_count(p_tenant_id uuid, p_conta_integration_id uuid)
 RETURNS TABLE(fornecedor_id integer, fornecedor_ds text, qtd bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.assert_tenant_scope(p_tenant_id);
  SELECT fornecedor_id, fornecedor_ds, COUNT(*)::bigint AS qtd
  FROM public.reconciliacao_cadastro
  WHERE tenant_id = p_tenant_id
    AND conta_integration_id = p_conta_integration_id
  GROUP BY fornecedor_id, fornecedor_ds
  ORDER BY COUNT(*) DESC;
$function$;

CREATE OR REPLACE FUNCTION public.conferencia_saude(p_tenant_id uuid, p_conta_integration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_espelho    timestamptz;
  v_detec      timestamptz;
  v_job_ativo  boolean;
  v_exec       timestamptz;
  v_falhas     int;
  v_falha_msg  text;
  v_estado     text;
  v_motivo     text;
begin
  -- Tenant vem por parametro (e o seletor), mas o ACESSO e checado. Padrao do proprio banco.
  if p_tenant_id is null or not public.can_access_tenant_row(p_tenant_id) then
    raise exception 'sem acesso a este tenant';
  end if;

  -- Tenant sem integracao Omie nao tem espelho para estar parado. Sem esta branch, todo
  -- tenant sem Omie ganharia vermelho eterno -- metade do que acabou de acontecer.
  if not exists (select 1 from public.omie_integration oi where oi.id = p_conta_integration_id and oi.tenant_id = p_tenant_id) then
    return jsonb_build_object('estado','sem_integracao','motivo',null);
  end if;

  select max(atualizado_em) into v_espelho from public.omie_espelho_cadastro where conta_integration_id = p_conta_integration_id;
  select max(gerado_em)     into v_detec   from public.reconciliacao_cadastro  where tenant_id = p_tenant_id and conta_integration_id = p_conta_integration_id;

  select coalesce(j.active,false) into v_job_ativo
  from cron.job j where j.jobname = 'recon-espelho-atualizar';
  v_job_ativo := coalesce(v_job_ativo, false);

  select e.ultima_execucao, e.falhas_seguidas, e.ultima_falha_msg
    into v_exec, v_falhas, v_falha_msg
  from public.cron_estado e where e.jobname = 'recon-espelho-atualizar';

  -- Gatilho e a IDADE DO DADO, nao a contagem de falhas. Com cadencia de 15min uma falha
  -- isolada de DNS (51 em 6h, medido) nunca passa de ~29min. Corte em 35min pela borda.
  -- EXCECAO: snapshot_magro nao envelhece o dado (upsert roda, delete/deteccao param) --
  -- espelho fica FRESCO E INCOMPLETO. Idade nao pega; checagem explicita.
  if not v_job_ativo then
    v_estado := 'parado';
    v_motivo := 'O cron do espelho esta desligado. Nada esta sendo conferido contra o Omie.';
  elsif coalesce(v_falhas,0) > 0 and coalesce(v_falha_msg,'') ilike '%snapshot_magro%' then
    v_estado := 'parado';
    v_motivo := 'A guarda do espelho disparou: veio menos cliente do que o esperado e a limpeza foi abortada. A coluna Omie pode estar incompleta.';
  elsif v_espelho is null or v_espelho < now() - interval '2 hours' then
    v_estado := 'parado';
    v_motivo := 'O espelho do Omie esta parado.';
  elsif v_espelho < now() - interval '35 minutes' then
    v_estado := 'atrasado';
    v_motivo := 'O espelho do Omie esta atrasado.';
  elsif v_detec is null or v_detec < v_espelho - interval '5 minutes' then
    v_estado := 'atrasado';
    v_motivo := 'O espelho atualizou, mas a deteccao nao rodou em cima dele.';
  else
    v_estado := 'ok';
  end if;

  return jsonb_build_object(
    'estado',               v_estado,
    'motivo',               v_motivo,
    'espelho_em',           v_espelho,
    'espelho_idade_min',    case when v_espelho is null then null
                                 else round(extract(epoch from (now() - v_espelho))/60) end,
    'deteccao_em',          v_detec,
    'cron_ativo',           v_job_ativo,
    'cron_ultima_execucao', v_exec,
    'falhas_seguidas',      coalesce(v_falhas,0)
  );
end;
$function$;

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
    WHERE fl.tenant_id = p_tenant_id
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


-- ---------------------------------------------------------------------------
-- Versoes de 1 argumento: resolvem a conta unica ou recusam.
-- ---------------------------------------------------------------------------

create or replace function public.reconciliacao_resumo(p_tenant_id uuid, p_fornecedor_ids bigint[] default null)
returns TABLE(acao_sugerida text, qtd bigint, gerado_em timestamp with time zone)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_qtd integer; v_conta uuid;
begin
  select count(*) into v_qtd from public.omie_integration where tenant_id = p_tenant_id;
  if v_qtd > 1 then
    raise exception
      'Tenant % tem % contas Omie. Informe a conta (p_conta_integration_id).', p_tenant_id, v_qtd
      using errcode = '22023';
  end if;
  select id into v_conta from public.omie_integration where tenant_id = p_tenant_id;
  if v_conta is null then return; end if;
  return query select * from public.reconciliacao_resumo(p_tenant_id, v_conta, p_fornecedor_ids);
end;
$fn$;

create or replace function public.reconciliacao_visao_geral(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_qtd integer; v_conta uuid;
begin
  select count(*) into v_qtd from public.omie_integration where tenant_id = p_tenant_id;
  if v_qtd > 1 then
    raise exception
      'Tenant % tem % contas Omie. Informe a conta (p_conta_integration_id).', p_tenant_id, v_qtd
      using errcode = '22023';
  end if;
  select id into v_conta from public.omie_integration where tenant_id = p_tenant_id;
  if v_conta is null then return jsonb_build_object('ok', false, 'motivo', 'sem_conta_omie'); end if;
  return public.reconciliacao_visao_geral(p_tenant_id, v_conta);
end;
$fn$;

create or replace function public.reconciliacao_fornecedores(p_tenant_id uuid)
returns TABLE(fornecedor_id bigint, fornecedor_ds text, qtd bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_qtd integer; v_conta uuid;
begin
  select count(*) into v_qtd from public.omie_integration where tenant_id = p_tenant_id;
  if v_qtd > 1 then
    raise exception
      'Tenant % tem % contas Omie. Informe a conta (p_conta_integration_id).', p_tenant_id, v_qtd
      using errcode = '22023';
  end if;
  select id into v_conta from public.omie_integration where tenant_id = p_tenant_id;
  if v_conta is null then return; end if;
  return query select * from public.reconciliacao_fornecedores(p_tenant_id, v_conta);
end;
$fn$;

create or replace function public.reconciliacao_fornecedores_count(p_tenant_id uuid)
returns TABLE(fornecedor_id integer, fornecedor_ds text, qtd bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_qtd integer; v_conta uuid;
begin
  select count(*) into v_qtd from public.omie_integration where tenant_id = p_tenant_id;
  if v_qtd > 1 then
    raise exception
      'Tenant % tem % contas Omie. Informe a conta (p_conta_integration_id).', p_tenant_id, v_qtd
      using errcode = '22023';
  end if;
  select id into v_conta from public.omie_integration where tenant_id = p_tenant_id;
  if v_conta is null then return; end if;
  return query select * from public.reconciliacao_fornecedores_count(p_tenant_id, v_conta);
end;
$fn$;

create or replace function public.conferencia_saude(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_qtd integer; v_conta uuid;
begin
  select count(*) into v_qtd from public.omie_integration where tenant_id = p_tenant_id;
  if v_qtd > 1 then
    raise exception
      'Tenant % tem % contas Omie. Informe a conta (p_conta_integration_id).', p_tenant_id, v_qtd
      using errcode = '22023';
  end if;
  select id into v_conta from public.omie_integration where tenant_id = p_tenant_id;
  if v_conta is null then return jsonb_build_object('ok', false, 'motivo', 'sem_conta_omie'); end if;
  return public.conferencia_saude(p_tenant_id, v_conta);
end;
$fn$;

create or replace function public.omie_fila_status(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_qtd integer; v_conta uuid;
begin
  select count(*) into v_qtd from public.omie_integration where tenant_id = p_tenant_id;
  if v_qtd > 1 then
    raise exception
      'Tenant % tem % contas Omie. Informe a conta (p_conta_integration_id).', p_tenant_id, v_qtd
      using errcode = '22023';
  end if;
  select id into v_conta from public.omie_integration where tenant_id = p_tenant_id;
  if v_conta is null then return jsonb_build_object('ok', false, 'motivo', 'sem_conta_omie'); end if;
  return public.omie_fila_status(p_tenant_id, v_conta);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants das novas (as de 1 argumento mantem os seus).
-- ---------------------------------------------------------------------------
revoke all on function public.reconciliacao_resumo(uuid, uuid, bigint[]) from public;
grant execute on function public.reconciliacao_resumo(uuid, uuid, bigint[]) to authenticated, service_role;
revoke all on function public.reconciliacao_visao_geral(uuid, uuid) from public;
grant execute on function public.reconciliacao_visao_geral(uuid, uuid) to authenticated, service_role;
revoke all on function public.reconciliacao_fornecedores(uuid, uuid) from public;
grant execute on function public.reconciliacao_fornecedores(uuid, uuid) to authenticated, service_role;
revoke all on function public.reconciliacao_fornecedores_count(uuid, uuid) from public;
grant execute on function public.reconciliacao_fornecedores_count(uuid, uuid) to authenticated, service_role;
revoke all on function public.conferencia_saude(uuid, uuid) from public;
grant execute on function public.conferencia_saude(uuid, uuid) to authenticated, service_role;
revoke all on function public.omie_fila_status(uuid, uuid) from public;
grant execute on function public.omie_fila_status(uuid, uuid) to authenticated, service_role;

commit;
