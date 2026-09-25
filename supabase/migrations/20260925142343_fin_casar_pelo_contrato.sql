-- =============================================================================
-- Casar o título pelo CONTRATO. É o elo exato, e é o que o negócio usa.
--
-- Correção do Alexandre em 25/09/2026, e ela desmonta a premissa anterior:
-- validar por CLIENTE não basta. **Um cliente no Omie pode ter três contratos**,
-- e no DoctorSaaS cada contrato pode ser um cadastro diferente. O que eu havia
-- chamado de "71 CNPJs duplicados" é, em boa parte, relação comercial distinta
-- da mesma empresa — não duplicata.
--
-- O JT BARES LTDA prova isso. No Omie: um cliente (7248328066), uma OS do
-- contrato 2025/00880 (R$ 878,95) e outra avulsa (R$ 1.000). No DoctorSaaS: dois
-- cadastros, com mensalidade R$ 878,95 e R$ 1.000. Os valores batem um a um.
-- Casar por CNPJ jogaria os títulos dos dois contratos no mesmo cadastro.
--
-- A ORDEM AGORA É: contrato → cliente vinculado → CNPJ único.
--
-- Cada degrau é menos exato que o anterior, e o primeiro é o único que sabe
-- separar dois contratos da mesma empresa. `reconciliacao_cadastro` tem 791
-- pares de contrato, 1 para 1 entre DS e Omie.
-- =============================================================================

alter table public.fin_titulos
  add column if not exists origem_contrato_id text null;

comment on column public.fin_titulos.origem_contrato_id is
  'Código do contrato na origem (Omie), achado pela ordem de serviço do título. É o elo que separa dois contratos da mesma empresa — casar por cliente ou CNPJ não separa.';

create index if not exists idx_fin_titulos_contrato
  on public.fin_titulos (tenant_id, origem_contrato_id)
  where origem_contrato_id is not null;

create or replace function public.fn_fin_casar_titulos_por_cnpj(p_tenant_id uuid)
returns table(casados integer, ambiguos integer, sem_cliente integer)
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $function$
declare
  v_por_contrato integer := 0;
  v_por_vinculo  integer := 0;
  v_por_cnpj     integer := 0;
  v_ambiguos     integer := 0;
  v_sem          integer := 0;
begin
  if p_tenant_id is null then
    raise exception 'fn_fin_casar_titulos_por_cnpj: p_tenant_id é obrigatório';
  end if;

  -- ── 1. PELO CONTRATO ───────────────────────────────────────────────────
  --
  -- O degrau mais exato: o título veio de uma OS, a OS tem número de contrato,
  -- e o de/para diz qual contrato nosso é aquele. Daí sai o cliente, sem
  -- desempate nenhum.
  --
  -- ⚠️ O cliente sai de `contratos`, não da reconciliação: é o contrato que
  -- aponta o dono, e é ele que o negócio considera verdade.
  with vinculo_contrato as (
    select r.codigo_contrato_omie::text as cod,
           (array_agg(distinct ct.cliente_id))[1] as cliente_id,
           count(distinct ct.cliente_id) as quantos
      from public.reconciliacao_cadastro r
      join public.contratos ct on ct.id = r.ds_contract_id
     where r.tenant_id = p_tenant_id
       and r.codigo_contrato_omie is not null
       and ct.cliente_id is not null
     group by r.codigo_contrato_omie
  ),
  atualizados as (
    update public.fin_titulos t
       set cliente_id = v.cliente_id,
           atualizado_em = now()
      from vinculo_contrato v
     where t.tenant_id = p_tenant_id
       and t.cliente_id is null
       and t.origem_contrato_id = v.cod
       and v.quantos = 1
    returning 1
  )
  select count(*) into v_por_contrato from atualizados;

  -- ── 2. PELO VÍNCULO DE CLIENTE ─────────────────────────────────────────
  --
  -- Para o título sem contrato (OS avulsa: 63 das 15.624 no Omie). Menos exato
  -- que o contrato, porque não separa dois contratos da mesma empresa, mas
  -- ainda é vínculo declarado e não adivinhação.
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

  -- ── 3. PELO CNPJ, o último recurso ─────────────────────────────────────
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

  return query select (v_por_contrato + v_por_vinculo + v_por_cnpj), v_ambiguos, v_sem;
end;
$function$;
