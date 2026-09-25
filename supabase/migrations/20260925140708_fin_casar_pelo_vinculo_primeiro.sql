-- =============================================================================
-- Casamento de título com cliente: o VÍNCULO primeiro, o CNPJ só depois.
--
-- Correção pedida pelo Alexandre em 25/09/2026, e ele está certo: o DoctorSaaS
-- já guarda o de/para entre cliente e Omie (`reconciliacao_cadastro`). Casar
-- por CNPJ ignorando esse vínculo é adivinhar tendo a resposta na mão.
--
-- O CASO QUE LEVANTOU ISSO: JT BARES LTDA, CNPJ 29.802.678/0001-70. Está
-- cadastrado DUAS VEZES no DoctorSaaS, com contrato ativo nos dois e
-- mensalidades diferentes (R$ 796,01 e R$ 1.000). A regra antiga exige CNPJ
-- único, então os 28 títulos dele — 10 em aberto — ficaram sem cliente e
-- invisíveis para a tela, para a 2ª via e para a régua.
--
-- ⚠️ A DUPLICIDADE É NOSSA, NÃO DO OMIE: lá o JT BARES tem um único código
-- (7248328066). Metade dos 66 CNPJs duplicados com título preso está assim.
--
-- O QUE ESTA MIGRATION RESOLVE, E O QUE NÃO: o vínculo cobre 799 pares hoje e
-- destrava 149 títulos (9 em aberto). O JT BARES NÃO está entre eles — o de/para
-- dele está vazio, com `estado_match = AMBIGUO`. Preencher o vínculo de quem
-- está ambíguo é decisão de negócio, cliente a cliente, e a tela de
-- reconciliação existe para isso. O conector não escolhe cadastro: escolher
-- mexe em contrato e MRR.
--
-- O ganho maior é o futuro: todo cliente que for vinculado pela tela passa a
-- ter seus títulos casados automaticamente, sem depender de CNPJ único.
-- =============================================================================

create or replace function public.fn_fin_casar_titulos_por_cnpj(p_tenant_id uuid)
returns table(casados integer, ambiguos integer, sem_cliente integer)
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $function$
declare
  v_por_vinculo integer := 0;
  v_por_cnpj    integer := 0;
  v_ambiguos    integer := 0;
  v_sem         integer := 0;
begin
  if p_tenant_id is null then
    raise exception 'fn_fin_casar_titulos_por_cnpj: p_tenant_id é obrigatório';
  end if;

  -- ── 1. PELO VÍNCULO ────────────────────────────────────────────────────
  --
  -- Exato: o código do cliente no Omie viaja no título (`origem_cliente_id`) e
  -- o de/para diz a quem ele pertence. Não há desempate, não há CNPJ.
  --
  -- `distinct` porque a reconciliação é por CONTRATO: o mesmo cliente aparece
  -- em várias linhas quando tem mais de um contrato. Sem ele, o update tentaria
  -- casar a mesma linha várias vezes.
  --
  -- A guarda `count(distinct ds_customer_id) = 1` existe para o caso raro de um
  -- código do Omie apontar para dois clientes nossos. Aí voltamos a não saber, e
  -- não saber é melhor que escolher errado.
  with vinculo as (
    select r.codigo_cliente_omie::text as cod,
           (array_agg(distinct r.ds_customer_id))[1] as cliente_id,
           count(distinct r.ds_customer_id) as quantos
      from public.reconciliacao_cadastro r
     where r.tenant_id = p_tenant_id
       and r.codigo_cliente_omie is not null
       and r.ds_customer_id is not null
     group by r.codigo_cliente_omie
  ),
  atualizados as (
    update public.fin_titulos t
       set cliente_id = v.cliente_id,
           atualizado_em = now()
      from vinculo v
     where t.tenant_id = p_tenant_id
       and t.cliente_id is null
       and t.origem_cliente_id = v.cod
       and v.quantos = 1
    returning 1
  )
  select count(*) into v_por_vinculo from atualizados;

  -- ── 2. PELO CNPJ, só para quem sobrou ──────────────────────────────────
  --
  -- Continua exigindo CNPJ único. Dois cadastros com o mesmo CNPJ significam
  -- que alguém precisa decidir qual vale, e essa decisão mexe em contrato e
  -- MRR — não é do conector.
  with cnpjs as (
    select c.cnpj_digits,
           count(*) as qtd,
           (array_agg(c.id))[1] as cliente_id
      from public.clientes c
     where c.tenant_id = p_tenant_id
       and coalesce(c.cnpj_digits, '') <> ''
     group by c.cnpj_digits
  ),
  atualizados as (
    update public.fin_titulos t
       set cliente_id = k.cliente_id,
           atualizado_em = now()
      from cnpjs k
     where t.tenant_id = p_tenant_id
       and t.cliente_id is null
       and t.cnpj_cpf_digits = k.cnpj_digits
       and k.qtd = 1
    returning 1
  )
  select count(*) into v_por_cnpj from atualizados;

  select count(*) into v_ambiguos
    from public.fin_titulos t
    join (
      select c.cnpj_digits, count(*) as qtd
        from public.clientes c
       where c.tenant_id = p_tenant_id
         and coalesce(c.cnpj_digits, '') <> ''
       group by c.cnpj_digits
    ) k on k.cnpj_digits = t.cnpj_cpf_digits and k.qtd > 1
   where t.tenant_id = p_tenant_id
     and t.cliente_id is null;

  select count(*) into v_sem
    from public.fin_titulos t
   where t.tenant_id = p_tenant_id
     and t.cliente_id is null;

  return query select (v_por_vinculo + v_por_cnpj), v_ambiguos, v_sem;
end;
$function$;
