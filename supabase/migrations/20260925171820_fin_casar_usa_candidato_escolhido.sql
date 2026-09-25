-- =============================================================================
-- O de/para de contrato tem a resposta em DUAS colunas, e o casamento só olhava
-- uma.
--
-- ACHADO DE 25/09/2026, investigando por que a corrente pelo contrato destravava
-- ZERO títulos: dos 2.536 presos, 1.320 tinham contrato, e NENHUM batia com os
-- 791 contratos de `codigo_contrato_omie`. Os 791 vinculados eram justamente os
-- que já casavam por CNPJ — o de/para só cobria o que já estava resolvido.
--
-- A resposta estava em `candidato_escolhido`. Há **211 linhas** marcadas como
-- `AMBIGUO / resolvido` com `codigo_contrato_omie` VAZIO e
-- `candidato_escolhido` PREENCHIDO: alguém abriu a tela, escolheu o contrato
-- certo, e a escolha não foi copiada para a coluna que todo mundo lê.
--
-- Provado antes de confiar: das 225 escolhas distintas, **208 batem com o
-- `origem_contrato_id` de algum título** e **nenhuma** bate com código de
-- cliente. O campo guarda contrato.
--
-- ⚠️ SÓ VALE COM DECISÃO HUMANA. `candidato_escolhido` preenchido sem
-- `status_usuario in ('resolvido','vinculado')` é sugestão do sistema, não
-- escolha de ninguém — e sugestão não pode mover título de cliente.
--
-- Medido: destrava 547 títulos, 37 deles em aberto, com ZERO contratos
-- apontando para dois clientes.
--
-- O conserto de raiz continua na tela de reconciliação, que deveria gravar
-- `codigo_contrato_omie` ao resolver. Esta migration lê as duas colunas para
-- não deixar 547 títulos invisíveis enquanto isso não acontece.
-- =============================================================================

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
  with vinculo_contrato as (
    select coalesce(r.codigo_contrato_omie, r.candidato_escolhido)::text as cod,
           (array_agg(distinct ct.cliente_id))[1] as cliente_id,
           count(distinct ct.cliente_id) as quantos
      from public.reconciliacao_cadastro r
      join public.contratos ct on ct.id = r.ds_contract_id
     where r.tenant_id = p_tenant_id
       and coalesce(r.codigo_contrato_omie, r.candidato_escolhido) is not null
       -- A escolha só vale se foi de gente. Sugestão do sistema não move
       -- título de cliente.
       and r.status_usuario in ('resolvido', 'vinculado')
       and ct.cliente_id is not null
     group by coalesce(r.codigo_contrato_omie, r.candidato_escolhido)
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

  -- ── 2. PELO VÍNCULO DE CLIENTE, para o título sem contrato ─────────────
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

  -- ── 3. PELO CNPJ, último recurso ───────────────────────────────────────
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
