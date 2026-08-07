-- F2b (parte 1): o motor da Conferencia passa a trabalhar por CONTA Omie, nao por tenant.
--
-- Com 2 contas no mesmo tenant, o motor nao "mistura um pouco" -- ele quebra e, se destravado
-- ingenuamente, apaga trabalho. Os tres defeitos, em ordem de gravidade:
--
--   1. snapshot_reconciliacao_ds tinha
--        escopo as (select unidades_base_ids from omie_integration where tenant_id = p_tenant_id)
--        ... where (select ids from escopo) is null or ...
--      Sem LIMIT. Com 2 linhas isso e 'more than one row returned by a subquery used as an
--      expression': a deteccao aborta inteira, para as DUAS unidades.
--
--   2. rodar_deteccao_reconciliacao termina com
--        DELETE FROM reconciliacao_cadastro
--         WHERE tenant_id=p_tenant_id AND ds_contract_id NOT IN (SELECT ... snapshot(p_tenant_id));
--      Rodar a deteccao da Digi Up apagaria TODA a reconciliacao da Digi Office -- os contratos
--      dela nao estao no snapshot da Digi Up. Mesma familia do delete do recon-espelho-pull.
--      Junto vai a decisao humana: status_usuario, candidato_escolhido, resolvido_por.
--
--   3. O casamento DS x Omie conta CNPJ por tenant (dsn/omn). Um cliente que existe nas duas
--      contas Omie daria om_mult=2 -> estado_match='AMBIGUO' nos dois contratos, em unidades
--      diferentes, e a tela pediria "escolher candidato" para um vinculo que nunca foi ambiguo.
--      Agora as contagens acontecem dentro da conta.
--
-- As versoes de 1 argumento continuam existindo (o frontend e o recon-espelho-pull-cron chamam
-- assim) mas viram resolvedoras: com 1 conta no tenant, delegam; com 2+, levantam 22023 em vez de
-- escolher uma. Mesma regra do obter_chave_omie e do salvar_integracao_omie.

begin;

-- ---------------------------------------------------------------------------
-- snapshot_reconciliacao_ds — 2 argumentos (escopo vem da CONTA)
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_reconciliacao_ds(
  p_tenant_id uuid,
  p_conta_integration_id uuid
)
returns table(
  ds_contract_id uuid, ds_customer_id uuid, numero text, cnpj_norm text, razao_social text,
  valor_mrr numeric, vigencia_inicial date, vigencia_final date, dia_vencimento integer,
  modelo text, qtd_itens integer, qtd_contratos_ativos_cliente integer, tem_modelo boolean,
  tem_datas boolean, multi_contrato boolean, passa_validacao boolean, sincroniza_omie boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_tenant_scope(p_tenant_id);
  with escopo as (
    -- unica diferenca real para a versao de 1 argumento: a conta e dada, nao adivinhada.
    select unidades_base_ids as ids
    from omie_integration
    where id = p_conta_integration_id
      and tenant_id = p_tenant_id
  ),
  cli_escopo as (
    select cl.id
    from clientes cl
    where cl.tenant_id = p_tenant_id
      and ( (select ids from escopo) is null
            or cl.unidade_base_id in (select unnest(e.ids) from escopo e) )
  ),
  mrr as (
    select distinct c.cliente_id,
           public.calcular_mrr_cliente(c.cliente_id, p_tenant_id) as valor_mrr
    from contratos c
    where c.tenant_id = p_tenant_id and c.status='ativo'
      and c.cliente_id in (select id from cli_escopo)
  ),
  cnt as (
    select cliente_id, count(*)::int as qtd
    from contratos
    where tenant_id=p_tenant_id and status='ativo'
      and cliente_id in (select id from cli_escopo)
    group by cliente_id
  )
  select
    c.id, c.cliente_id, c.numero,
    regexp_replace(coalesce(cl.cnpj,''),'\D','','g'),
    cl.razao_social, mrr.valor_mrr,
    c.data_venda, c.data_proximo_reajuste, c.dia_vencimento,
    m.nome,
    (select count(*)::int from contrato_itens ci where ci.contrato_id=c.id),
    cnt.qtd,
    (c.modelo_contrato_id is not null),
    (c.data_venda is not null and c.data_proximo_reajuste is not null),
    (cnt.qtd > 1),
    (c.modelo_contrato_id is not null
     and c.data_venda is not null and c.data_proximo_reajuste is not null
     and cnt.qtd = 1
     and (select count(*) from contrato_itens ci where ci.contrato_id=c.id) = 1
     and btrim(coalesce(cl.cnpj,'')) <> ''
     and btrim(coalesce(cl.razao_social,'')) <> ''),
    -- 17/07/2026. COALESCE true: contrato sem modelo sincroniza (a validacao "sem modelo" ja o
    -- barra depois). NULL aqui viraria "fora do escopo" por acidente.
    coalesce(m.sincroniza_omie, true)
  from contratos c
  join clientes cl on cl.id = c.cliente_id
  left join modelos_contrato m on m.id = c.modelo_contrato_id
  join mrr on mrr.cliente_id = c.cliente_id
  join cnt on cnt.cliente_id = c.cliente_id
  where c.tenant_id = p_tenant_id and c.status='ativo'
    and c.cliente_id in (select id from cli_escopo);
$function$;

-- ---------------------------------------------------------------------------
-- snapshot_reconciliacao_ds — 1 argumento vira RESOLVEDORA
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_reconciliacao_ds(p_tenant_id uuid)
returns table(
  ds_contract_id uuid, ds_customer_id uuid, numero text, cnpj_norm text, razao_social text,
  valor_mrr numeric, vigencia_inicial date, vigencia_final date, dia_vencimento integer,
  modelo text, qtd_itens integer, qtd_contratos_ativos_cliente integer, tem_modelo boolean,
  tem_datas boolean, multi_contrato boolean, passa_validacao boolean, sincroniza_omie boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_qtd   integer;
  v_conta uuid;
begin
  select count(*) into v_qtd from public.omie_integration where tenant_id = p_tenant_id;
  if v_qtd > 1 then
    raise exception
      'Tenant % tem % contas Omie. Informe a conta (p_conta_integration_id).', p_tenant_id, v_qtd
      using errcode = '22023';
  end if;
  select id into v_conta from public.omie_integration where tenant_id = p_tenant_id;
  return query select * from public.snapshot_reconciliacao_ds(p_tenant_id, v_conta);
end;
$function$;

-- ---------------------------------------------------------------------------
-- rodar_deteccao_reconciliacao — 2 argumentos
-- Corpo identico ao original, com 4 mudancas, todas marcadas com "F2b":
--   (a) o snapshot DS vem da conta
--   (b) o espelho e filtrado por conta_integration_id (isso tambem corrige dsn/omn: as
--       contagens de CNPJ passam a ser dentro da conta)
--   (c) o INSERT grava conta_integration_id
--   (d) o DELETE de orfaos e escopado na conta
-- ---------------------------------------------------------------------------
create or replace function public.rodar_deteccao_reconciliacao(
  p_tenant_id uuid,
  p_conta_integration_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE v_afetados integer;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  -- F2b: a conta tem de ser deste tenant. Sem isso, um id de outro tenant faria a deteccao rodar
  -- com escopo vazio e o DELETE do fim limparia a reconciliacao inteira.
  IF NOT EXISTS (SELECT 1 FROM omie_integration
                  WHERE id = p_conta_integration_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Conta Omie % nao pertence ao tenant %', p_conta_integration_id, p_tenant_id;
  END IF;

  WITH ds  AS (SELECT * FROM snapshot_reconciliacao_ds(p_tenant_id, p_conta_integration_id)), -- F2b (a)
       om  AS (SELECT * FROM omie_espelho_cadastro
                WHERE conta_integration_id = p_conta_integration_id                           -- F2b (b)
                  AND length(cnpj_norm) IN (11,14)),
       dsn AS (SELECT cnpj_norm, count(*) c FROM ds WHERE length(cnpj_norm) IN (11,14) GROUP BY cnpj_norm),
       omn AS (SELECT cnpj_norm, count(*) c FROM om GROUP BY cnpj_norm),
       m AS (
         SELECT ds.*, COALESCE(dsn.c,0) ds_mult, COALESCE(omn.c,0) om_mult,
                clf.fornecedor_id AS fornecedor_id, frn.nome AS fornecedor_ds,
                o.codigo_cliente_omie, o.codigo_contrato_omie, o.valor_omie, o.razao_social_omie, o.situacao_contrato, o.tem_cancelado_omie,
                o.vigencia_inicial_omie, o.vigencia_final_omie, o.dia_venc_omie,
                o.origem_codigo, o.omie_inativo
         FROM ds
         LEFT JOIN clientes clf ON clf.id = ds.ds_customer_id
         LEFT JOIN fornecedores frn ON frn.id = clf.fornecedor_id
         LEFT JOIN dsn ON dsn.cnpj_norm=ds.cnpj_norm
         LEFT JOIN omn ON omn.cnpj_norm=ds.cnpj_norm
         LEFT JOIN LATERAL (
           SELECT * FROM om o2
           WHERE o2.cnpj_norm=ds.cnpj_norm AND COALESCE(dsn.c,0)=1 AND COALESCE(omn.c,0)=1
           LIMIT 1
         ) o ON true
       ),
       f AS (
         SELECT m.*,
           -- 23/07/2026: CASADO_INATIVO. Contraparte CANCELADA ('99') no Omie nao e vinculo vivo.
           -- SO '99', DE PROPOSITO. '90' (suspenso) fica como CASADO: suspenso pode ser reativado,
           -- e trata-lo como nao-vinculado faria criar um SEGUNDO contrato para quem ja tem um vivo
           -- no Omie -- cobranca em duplicidade.
           CASE WHEN om_mult=0 THEN 'SO_NO_DS'
                WHEN om_mult=1 AND ds_mult=1 AND COALESCE(situacao_contrato,'10')='99' THEN 'CASADO_INATIVO'
                WHEN om_mult=1 AND ds_mult=1 THEN 'CASADO'
                ELSE 'AMBIGUO' END AS estado_match,
           (om_mult=1 AND ds_mult=1) AS eh_casado,
           (COALESCE(origem_codigo,'vazio') NOT IN ('vazio','DS')) AS eh_alheio,
           (COALESCE(situacao_contrato,'10')='10') AS contrato_ativo10
         FROM m
       )
  INSERT INTO reconciliacao_cadastro AS r (
    tenant_id, conta_integration_id, ds_contract_id, ds_customer_id, gerado_em,                 -- F2b (c)
    cnpj_norm, razao_ds, razao_omie, fornecedor_id, fornecedor_ds, valor_mrr_ds, vigencia_inicial_ds, vigencia_final_ds, dia_venc_ds, modelo_ds, passa_validacao, multi_contrato,
    codigo_cliente_omie, codigo_contrato_omie, valor_omie, vigencia_inicial_omie, vigencia_final_omie, dia_venc_omie, origem_codigo, omie_inativo, situacao_contrato, tem_cancelado_omie, qtd_candidatos_omie,
    estado_match, estado_valor, diffs, acao_sugerida)
  SELECT p_tenant_id, p_conta_integration_id, ds_contract_id, ds_customer_id, now(),            -- F2b (c)
    cnpj_norm, razao_social, razao_social_omie, fornecedor_id, fornecedor_ds, valor_mrr, vigencia_inicial, vigencia_final, dia_vencimento, modelo, passa_validacao, multi_contrato,
    codigo_cliente_omie, codigo_contrato_omie, valor_omie, vigencia_inicial_omie, vigencia_final_omie, dia_venc_omie, origem_codigo, omie_inativo, situacao_contrato, tem_cancelado_omie, om_mult,
    estado_match,
    CASE WHEN NOT eh_casado THEN NULL
         WHEN multi_contrato OR codigo_contrato_omie IS NULL OR NOT contrato_ativo10 THEN 'NAO_COMPARAVEL'
         WHEN abs(COALESCE(valor_mrr,0)-COALESCE(valor_omie,0))>0.01
           OR (origem_codigo='DS' AND vigencia_inicial IS DISTINCT FROM vigencia_inicial_omie)
           OR (origem_codigo='DS' AND vigencia_final   IS DISTINCT FROM vigencia_final_omie)
           OR (origem_codigo='DS' AND dia_venc_omie IS NOT NULL AND dia_vencimento IS NOT NULL AND dia_vencimento<>dia_venc_omie)
         THEN 'DIVERGENTE' ELSE 'OK' END,
    CASE WHEN eh_casado AND NOT multi_contrato AND codigo_contrato_omie IS NOT NULL AND contrato_ativo10 THEN jsonb_strip_nulls(jsonb_build_object(
      'valor', CASE WHEN abs(COALESCE(valor_mrr,0)-COALESCE(valor_omie,0))>0.01 THEN jsonb_build_object('ds',valor_mrr,'omie',valor_omie) END,
      'vigencia_inicial', CASE WHEN origem_codigo='DS' AND vigencia_inicial IS DISTINCT FROM vigencia_inicial_omie THEN jsonb_build_object('ds',vigencia_inicial,'omie',vigencia_inicial_omie) END,
      'vigencia_final', CASE WHEN origem_codigo='DS' AND vigencia_final IS DISTINCT FROM vigencia_final_omie THEN jsonb_build_object('ds',vigencia_final,'omie',vigencia_final_omie) END,
      'dia_venc', CASE WHEN origem_codigo='DS' AND dia_venc_omie IS NOT NULL AND dia_vencimento IS NOT NULL AND dia_vencimento<>dia_venc_omie THEN jsonb_build_object('ds',dia_vencimento,'omie',dia_venc_omie) END
    )) END,
    CASE
      -- 17/07/2026: PRIMEIRO de tudo, de proposito. Regra do Ale: Cobranca Fornecedor nao vai
      -- para o Omie. Alarme por desenho treina a ignorar o painel.
      WHEN NOT sincroniza_omie                   THEN 'fora_do_escopo'
      WHEN estado_match='SO_NO_DS' THEN CASE WHEN NOT tem_modelo THEN 'atribuir_modelo' WHEN passa_validacao THEN 'criar' ELSE 'corrigir_ds' END
      WHEN estado_match='AMBIGUO' THEN 'escolher_candidato'
      ELSE CASE
        WHEN codigo_contrato_omie IS NULL          THEN 'criar_contrato'
        WHEN COALESCE(situacao_contrato,'10')='90' THEN 'contrato_suspenso'
        WHEN COALESCE(situacao_contrato,'10')='99' THEN 'contrato_cancelado'
        WHEN COALESCE(situacao_contrato,'10')='10'
             AND vigencia_final_omie IS NOT NULL
             AND vigencia_final_omie < CURRENT_DATE
                                                   THEN 'vigencia_vencida_no_omie'
        WHEN multi_contrato                        THEN 'revisar_multi'
        WHEN abs(COALESCE(valor_mrr,0)-COALESCE(valor_omie,0))<=0.01
             AND (origem_codigo<>'DS' OR vigencia_inicial IS NOT DISTINCT FROM vigencia_inicial_omie)
             AND (origem_codigo<>'DS' OR vigencia_final   IS NOT DISTINCT FROM vigencia_final_omie)
             AND (origem_codigo<>'DS' OR dia_venc_omie IS NULL OR dia_vencimento IS NULL OR dia_vencimento=dia_venc_omie)
                                                   THEN 'vinculo_auto_ok'
        ELSE 'resolver' END
    END
  FROM f
  ON CONFLICT (tenant_id, ds_contract_id) DO UPDATE SET
    conta_integration_id=EXCLUDED.conta_integration_id,                                          -- F2b (c)
    gerado_em=EXCLUDED.gerado_em, ds_customer_id=EXCLUDED.ds_customer_id,
    cnpj_norm=EXCLUDED.cnpj_norm, razao_ds=EXCLUDED.razao_ds, razao_omie=EXCLUDED.razao_omie,
    fornecedor_id=EXCLUDED.fornecedor_id, fornecedor_ds=EXCLUDED.fornecedor_ds,
    valor_mrr_ds=EXCLUDED.valor_mrr_ds,
    vigencia_inicial_ds=EXCLUDED.vigencia_inicial_ds, vigencia_final_ds=EXCLUDED.vigencia_final_ds, dia_venc_ds=EXCLUDED.dia_venc_ds,
    modelo_ds=EXCLUDED.modelo_ds, passa_validacao=EXCLUDED.passa_validacao, multi_contrato=EXCLUDED.multi_contrato,
    codigo_cliente_omie=EXCLUDED.codigo_cliente_omie, codigo_contrato_omie=EXCLUDED.codigo_contrato_omie, valor_omie=EXCLUDED.valor_omie,
    vigencia_inicial_omie=EXCLUDED.vigencia_inicial_omie, vigencia_final_omie=EXCLUDED.vigencia_final_omie, dia_venc_omie=EXCLUDED.dia_venc_omie,
    origem_codigo=EXCLUDED.origem_codigo, omie_inativo=EXCLUDED.omie_inativo, situacao_contrato=EXCLUDED.situacao_contrato, tem_cancelado_omie=EXCLUDED.tem_cancelado_omie, qtd_candidatos_omie=EXCLUDED.qtd_candidatos_omie,
    estado_match=EXCLUDED.estado_match, estado_valor=EXCLUDED.estado_valor, diffs=EXCLUDED.diffs, acao_sugerida=EXCLUDED.acao_sugerida;

  GET DIAGNOSTICS v_afetados = ROW_COUNT;

  -- F2b (d): orfaos DESTA conta. Sem o filtro, rodar a deteccao de uma unidade apagaria a
  -- reconciliacao inteira da outra -- inclusive a decisao humana (status_usuario,
  -- candidato_escolhido, resolvido_por), que nao volta.
  DELETE FROM reconciliacao_cadastro
  WHERE tenant_id=p_tenant_id
    AND conta_integration_id = p_conta_integration_id
    AND ds_contract_id NOT IN (
      SELECT ds_contract_id FROM snapshot_reconciliacao_ds(p_tenant_id, p_conta_integration_id)
    );

  RETURN v_afetados;
END;
$function$;

-- ---------------------------------------------------------------------------
-- rodar_deteccao_reconciliacao — 1 argumento vira RESOLVEDORA
-- ---------------------------------------------------------------------------
create or replace function public.rodar_deteccao_reconciliacao(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_qtd   integer;
  v_conta uuid;
begin
  select count(*) into v_qtd from public.omie_integration where tenant_id = p_tenant_id;
  if v_qtd > 1 then
    raise exception
      'Tenant % tem % contas Omie. Informe a conta (p_conta_integration_id).', p_tenant_id, v_qtd
      using errcode = '22023';
  end if;
  select id into v_conta from public.omie_integration where tenant_id = p_tenant_id;
  if v_conta is null then
    return 0;
  end if;
  return public.rodar_deteccao_reconciliacao(p_tenant_id, v_conta);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Grants: as de 1 argumento ja tinham os seus; as novas precisam dos mesmos.
-- ---------------------------------------------------------------------------
revoke all on function public.snapshot_reconciliacao_ds(uuid, uuid) from public;
revoke all on function public.rodar_deteccao_reconciliacao(uuid, uuid) from public;
grant execute on function public.snapshot_reconciliacao_ds(uuid, uuid)    to authenticated, service_role;
grant execute on function public.rodar_deteccao_reconciliacao(uuid, uuid) to authenticated, service_role;

commit;
