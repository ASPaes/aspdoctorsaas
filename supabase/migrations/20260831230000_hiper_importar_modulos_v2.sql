-- Importar módulos passa a cobrir três coisas, não uma: inserir o que falta,
-- ajustar a QUANTIDADE (1 caixa no portal contra 2 aqui) e ajustar o CUSTO.
-- E passa a enxergar os módulos que o PLANO implica, não só os addons.
--
-- Ganha p_recon_id para rodar num cliente só — é o botão "Atualizar" da aba
-- Divergências chamando a mesma lógica do lote, em vez de uma cópia dela.
drop function if exists public.hiper_importar_modulos(uuid, boolean);

create or replace function public.hiper_importar_modulos(
  p_tenant_id uuid,
  p_previa    boolean default true,
  p_recon_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_forn      bigint;
  v_inserir   integer := 0;
  v_qtd       integer := 0;
  v_custo     integer := 0;
  v_sem_prod  integer := 0;
  v_ja_ok     integer := 0;
  v_amostra   jsonb;
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  select fornecedor_id into v_forn from public.hiper_integration where tenant_id = p_tenant_id;
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Escolha o fornecedor Hiper na aba Conexão.');
  end if;

  -- ON COMMIT DROP só solta no commit: duas chamadas na MESMA transação
  -- colidem, e é isso que o lote faz ao percorrer os clientes.
  drop table if exists _imp;
  create temp table _imp on commit drop as
  with alvo as (
    select r.id as recon_id, r.id_portal, r.ds_cliente_id, r.razao_social_ds
    from public.reconciliacao_hiper r
    where r.tenant_id = p_tenant_id and r.estado_match = 'vinculado'
      and r.ds_cliente_id is not null
      and (p_recon_id is null or r.id = p_recon_id)
  ),
  -- addon: o portal diz o nome e o custo, sempre quantidade 1
  addons as (
    select a.recon_id, a.ds_cliente_id, a.razao_social_ds,
           m.app_nome, coalesce(m.custo, 0) as custo, v.modulo_id, v.produto_id, 1 as quantidade
    from alvo a
    join public.hiper_espelho_modulo m
      on m.tenant_id = p_tenant_id and m.id_portal = a.id_portal and m.ativo
    join public.hiper_catalogo_vinculo v
      on v.tenant_id = p_tenant_id and v.tipo = 'modulo' and v.chave = m.app_nome
  ),
  -- do plano: o portal não lista, mas o contador da conta implica
  do_plano as (
    select a.recon_id, a.ds_cliente_id, a.razao_social_ds,
           pm.nome as app_nome, 0::numeric as custo, pmod.modulo_id, pmod.produto_id,
           (case pmod.quantidade_de
              when 'qt_caixas'   then coalesce(e.plano_qt_caixas, 0)
              when 'qt_usuarios' then coalesce(e.plano_qt_usuarios, 0)
              when 'qt_filiais'  then coalesce(e.plano_qt_filiais, 0)
              else pmod.quantidade_fixa
            end)::integer as quantidade
    from alvo a
    join public.hiper_espelho_cadastro e
      on e.tenant_id = p_tenant_id and e.id_portal = a.id_portal
    join public.hiper_plano_modulo pmod
      on pmod.tenant_id = p_tenant_id and pmod.plano = e.plano
    join public.produto_modulos pm on pm.id = pmod.modulo_id
  ),
  esperado as (
    select * from addons
    union all
    select * from do_plano where quantidade > 0
  )
  -- Uma linha por (cliente, APP). O mesmo app tem um módulo em cada produto, e
  -- só um deles é o que o cliente contratou — deduplicar por módulo deixava a
  -- variante do outro produto sobrar e ser contada como "sem produto no
  -- contrato". O `order by` põe a que CASOU na frente.
  select distinct on (x.ds_cliente_id, x.app_nome)
    x.recon_id, x.ds_cliente_id, x.razao_social_ds as cliente, x.app_nome,
    x.custo, x.quantidade, x.modulo_id, x.produto_id,
    cp.id as cliente_produto_id,
    cpm.id as cpm_id,
    cpm.quantidade as qtd_atual,
    coalesce(cpm.vlr_custo, 0) as custo_atual
  from esperado x
  left join public.cliente_produtos cp
    on cp.cliente_id = x.ds_cliente_id and cp.fornecedor_id = v_forn
   and cp.produto_id = x.produto_id and cp.ativo
  left join public.cliente_produto_modulos cpm
    on cpm.cliente_produto_id = cp.id and cpm.modulo_id = x.modulo_id and cpm.ativo
  order by x.ds_cliente_id, x.app_nome, (cp.id is null), x.custo desc, x.quantidade desc;

  select
    count(*) filter (where cliente_produto_id is null),
    count(*) filter (where cliente_produto_id is not null and cpm_id is null),
    count(*) filter (where cpm_id is not null and coalesce(qtd_atual,1) <> quantidade),
    count(*) filter (where cpm_id is not null and abs(custo_atual - custo) > 0.01),
    count(*) filter (where cpm_id is not null and coalesce(qtd_atual,1) = quantidade
                       and abs(custo_atual - custo) <= 0.01)
  into v_sem_prod, v_inserir, v_qtd, v_custo, v_ja_ok
  from _imp;

  select jsonb_agg(x) into v_amostra from (
    select cliente, app_nome, custo, quantidade,
           case when cpm_id is null then 'inserir' else 'ajustar' end as o_que
    from _imp
    where cliente_produto_id is not null
      and (cpm_id is null or coalesce(qtd_atual,1) <> quantidade or abs(custo_atual - custo) > 0.01)
    order by cliente limit 20
  ) x;

  if p_previa then
    return jsonb_build_object('ok', true, 'previa', true,
      'a_inserir', v_inserir, 'ajustar_quantidade', v_qtd, 'ajustar_custo', v_custo,
      'ja_conferem', v_ja_ok, 'sem_produto_no_contrato', v_sem_prod,
      'amostra', coalesce(v_amostra, '[]'::jsonb));
  end if;

  -- vlr_mensal = 0: módulo do Hiper NÃO tem preço de venda. O trigger
  -- fn_sync_produto_valores já protege — como nem todos os módulos têm valor,
  -- v_todos_pagos é falso e a receita do contrato não vira zero.
  insert into public.cliente_produto_modulos
    (tenant_id, cliente_produto_id, modulo_id, vlr_mensal, vlr_custo, quantidade,
     ativo, data_ativacao, origem)
  select p_tenant_id, i.cliente_produto_id, i.modulo_id, 0, i.custo, i.quantidade,
         true, current_date, 'hiper'
  from _imp i
  where i.cliente_produto_id is not null and i.cpm_id is null;
  get diagnostics v_inserir = row_count;

  update public.cliente_produto_modulos cpm
     set quantidade = i.quantidade, vlr_custo = i.custo, updated_at = now()
  from _imp i
  where cpm.id = i.cpm_id
    and (coalesce(cpm.quantidade, 1) <> i.quantidade or abs(coalesce(cpm.vlr_custo, 0) - i.custo) > 0.01);
  get diagnostics v_qtd = row_count;

  return jsonb_build_object('ok', true, 'previa', false,
    'inseridos', v_inserir, 'ajustados', v_qtd,
    'ja_conferiam', v_ja_ok, 'sem_produto_no_contrato', v_sem_prod);
end;
$$;

revoke all on function public.hiper_importar_modulos(uuid, boolean, uuid) from public;
grant execute on function public.hiper_importar_modulos(uuid, boolean, uuid) to authenticated, service_role;
