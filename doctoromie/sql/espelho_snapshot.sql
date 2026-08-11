-- DoctorOMIE (vqrytdntynxuqozehals) — RPC espelho_snapshot
--
-- Aplicada em producao em 10/08/2026 via SQL Editor. Este arquivo existe porque as RPCs do
-- DoctorOMIE nunca tiveram registro nenhum em repo -- ver doctoromie/README.md. NAO ha CI aqui:
-- o banco continua sendo a fonte de verdade. Antes de reescrever, confira o que esta no ar com
--   select pg_get_functiondef(oid) from pg_proc where proname='espelho_snapshot';
--
-- v2 (10/08/2026): passa a devolver valor_servicos_omie -- o "Total dos Servicos" do Omie
-- (bruto, sem desconto), ao lado do valor_omie, que e o "Total do Contrato" (liquido).
--
-- O Omie nao manda bloco de totais no contrato; a caixa da tela dele e calculada. O desconto so
-- existe no item. Medido em 4 contratos da Digi Office com desconto real:
--   cabecalho.nValTotMes = Sum(itens.valorTotal)         = Total do Contrato  (= valor_total_mes)
--   Sum(itens.quant x itens.valorUnit)                   = Total dos Servicos
--
-- E DROP + CREATE, nao REPLACE: acrescentar coluna ao RETURNS TABLE muda o tipo de retorno e o
-- Postgres recusa o replace. Por isso os grants sao reconcedidos no fim.

BEGIN;

DROP FUNCTION IF EXISTS public.espelho_snapshot(uuid, integer, integer);

CREATE FUNCTION public.espelho_snapshot(p_tenant_id uuid, p_limit integer, p_offset integer)
RETURNS TABLE(
  codigo_cliente_omie bigint, cnpj_norm text, razao_social_omie text,
  codigo_cliente_integracao text, origem_codigo text, omie_inativo boolean,
  codigo_contrato_omie bigint, valor_omie numeric, vigencia_inicial_omie date,
  vigencia_final_omie date, dia_venc_omie integer, situacao_contrato text,
  qtd_contratos_ativos_omie integer, tem_cancelado boolean, contratos_omie jsonb,
  valor_servicos_omie numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with ctr as (
    select k.*,
      row_number() over (partition by k.codigo_cliente_omie
        order by case k.situacao when '10' then 1 when '90' then 2 when '99' then 3 else 4 end,
                 k.synced_at desc nulls last) as rn,
      count(*) filter (where k.situacao='10') over (partition by k.codigo_cliente_omie) as qtd_ativos_10,
      (count(*) filter (where k.situacao='99') over (partition by k.codigo_cliente_omie)) > 0 as tem_99
    from omie_contratos k
    where k.tenant_id = p_tenant_id
  ),
  -- Total dos Servicos (bruto) e Total do Contrato (liquido) reconstruidos do raw.
  itens as (
    select c.codigo_contrato_omie,
           round(sum(v.quant * v.unit), 2) as bruto,
           round(sum(v.total), 2)          as liquido
    from ctr c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.raw->'itensContrato') = 'array'
           then c.raw->'itensContrato' else '[]'::jsonb end
    ) i
    cross join lateral (
      select case when i->'itemCabecalho'->>'quant'      ~ '^-?[0-9]+(\.[0-9]+)?$' then (i->'itemCabecalho'->>'quant')::numeric      else 0 end,
             case when i->'itemCabecalho'->>'valorUnit'  ~ '^-?[0-9]+(\.[0-9]+)?$' then (i->'itemCabecalho'->>'valorUnit')::numeric  else 0 end,
             case when i->'itemCabecalho'->>'valorTotal' ~ '^-?[0-9]+(\.[0-9]+)?$' then (i->'itemCabecalho'->>'valorTotal')::numeric else 0 end
    ) v(quant, unit, total)
    group by c.codigo_contrato_omie
  ),
  -- O ds-omie-contrato-alterar atualiza valor_total_mes e DE PROPOSITO nao toca no raw (o raw e
  -- do incremental). Entao o raw pode estar ate ~10min atras. Somar desconto velho a valor novo
  -- inventaria um numero que nunca existiu: quando o raw nao bate, devolve o valor_total_mes.
  serv as (
    select c.codigo_contrato_omie,
           coalesce(
             case when it.liquido is not null
                   and c.valor_total_mes is not null
                   and abs(it.liquido - c.valor_total_mes) <= 0.01
                  then it.bruto end,
             c.valor_total_mes
           ) as valor_servicos
    from ctr c
    left join itens it on it.codigo_contrato_omie = c.codigo_contrato_omie
  ),
  best as (select * from ctr where rn = 1),
  todos as (   -- todos os contratos do cliente, nao so o melhor
    select c.codigo_cliente_omie,
           jsonb_agg(
             jsonb_build_object(
               'codigo_contrato_omie', c.codigo_contrato_omie,
               'valor_omie',           c.valor_total_mes,
               'valor_servicos_omie',  s.valor_servicos,
               'situacao_contrato',    c.situacao,
               'vigencia_inicial',     c.vigencia_inicial,
               'vigencia_final',       c.vigencia_final,
               'dia_venc',             case when c.raw->'vencTextos'->>'nDiaFixo' ~ '^\d+$'
                                            then (c.raw->'vencTextos'->>'nDiaFixo')::int else null end
             )
             order by case c.situacao when '10' then 1 when '90' then 2 when '99' then 3 else 4 end,
                      c.valor_total_mes desc nulls last
           ) as contratos
    from ctr c
    left join serv s on s.codigo_contrato_omie = c.codigo_contrato_omie
    group by c.codigo_cliente_omie
  )
  select
    cl.codigo_cliente_omie,
    regexp_replace(coalesce(cl.cnpj_cpf,''),'\D','','g'),
    cl.razao_social,
    cl.codigo_cliente_integracao,
    case when cl.codigo_cliente_integracao is null then 'vazio'
         when cl.codigo_cliente_integracao ~ '^[0-9a-f]{8}-[0-9a-f]{4}-' then 'DS'
         else split_part(cl.codigo_cliente_integracao,'-',1) end,
    cl.inativo,
    b.codigo_contrato_omie, b.valor_total_mes,
    b.vigencia_inicial, b.vigencia_final,
    case when b.raw->'vencTextos'->>'nDiaFixo' ~ '^\d+$'
         then (b.raw->'vencTextos'->>'nDiaFixo')::int else null end,
    b.situacao,
    coalesce(b.qtd_ativos_10,0)::int,
    coalesce(b.tem_99,false),
    coalesce(t.contratos, '[]'::jsonb),
    bs.valor_servicos
  from omie_clientes cl
  left join best  b  on b.codigo_cliente_omie = cl.codigo_cliente_omie
  left join todos t  on t.codigo_cliente_omie = cl.codigo_cliente_omie
  left join serv  bs on bs.codigo_contrato_omie = b.codigo_contrato_omie
  where cl.tenant_id = p_tenant_id
  order by cl.codigo_cliente_omie
  limit p_limit offset p_offset;
$function$;

REVOKE ALL ON FUNCTION public.espelho_snapshot(uuid, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.espelho_snapshot(uuid, integer, integer) TO authenticated, service_role;

COMMIT;
