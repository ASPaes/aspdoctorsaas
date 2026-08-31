-- Traz para os contratos do DoctorSaaS os módulos que o portal diz que cada
-- cliente tem. É a ÚNICA escrita em dado de negócio deste módulo, e é sempre
-- ação humana: nasce em prévia e só grava quando p_previa = false.
--
-- Por que existe: o portal tem 1.411 módulos ativos e o DoctorSaaS tem 2.
-- Sem esta carga, vincular um app na aba Módulos faria a reconciliação acusar
-- "módulo a mais no Hiper" em centenas de clientes no mesmo instante. Isso é
-- migração, não pendência.
create or replace function public.hiper_importar_modulos(
  p_tenant_id uuid,
  p_previa    boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_forn      bigint;
  v_inserir   integer := 0;
  v_sem_prod  integer := 0;
  v_ja_tem    integer := 0;
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

  create temp table _imp on commit drop as
  select
    r.ds_cliente_id                                  as cliente_id,
    r.razao_social_ds                                as cliente,
    m.app_nome,
    coalesce(m.custo, 0)                             as custo,
    v.modulo_id,
    pm.produto_id,
    cp.id                                            as cliente_produto_id,
    exists (
      select 1 from public.cliente_produto_modulos x
      where x.cliente_produto_id = cp.id and x.modulo_id = v.modulo_id and x.ativo
    )                                                as ja_tem
  from public.reconciliacao_hiper r
  join public.hiper_espelho_modulo m
    on m.tenant_id = p_tenant_id and m.id_portal = r.id_portal and m.ativo
  join public.hiper_catalogo_vinculo v
    on v.tenant_id = p_tenant_id and v.tipo = 'modulo' and v.chave = m.app_nome
  join public.produto_modulos pm on pm.id = v.modulo_id
  left join public.cliente_produtos cp
    on cp.cliente_id = r.ds_cliente_id and cp.fornecedor_id = v_forn
   and cp.produto_id = pm.produto_id and cp.ativo
  where r.tenant_id = p_tenant_id
    and r.estado_match = 'vinculado'
    and r.ds_cliente_id is not null;

  select count(*) filter (where cliente_produto_id is null),
         count(*) filter (where cliente_produto_id is not null and ja_tem),
         count(*) filter (where cliente_produto_id is not null and not ja_tem)
    into v_sem_prod, v_ja_tem, v_inserir
  from _imp;

  select jsonb_agg(x) into v_amostra from (
    select cliente, app_nome, custo
    from _imp where cliente_produto_id is not null and not ja_tem
    order by cliente limit 20
  ) x;

  if p_previa then
    return jsonb_build_object('ok', true, 'previa', true, 'a_inserir', v_inserir,
      'ja_tem', v_ja_tem, 'sem_produto_no_contrato', v_sem_prod, 'amostra', coalesce(v_amostra, '[]'::jsonb));
  end if;

  -- vlr_mensal = 0 porque módulo do Hiper NÃO tem preço de venda. O trigger
  -- fn_sync_produto_valores já protege: como nem todos os módulos têm valor,
  -- `v_todos_pagos` é falso e a receita do contrato não é substituída por zero.
  -- O custo do contrato também não vem daqui (o trigger só o recalcula para
  -- origem='oem'): ele continua sendo o custo da conta inteira, do portal.
  insert into public.cliente_produto_modulos
    (tenant_id, cliente_produto_id, modulo_id, vlr_mensal, vlr_custo, quantidade,
     ativo, data_ativacao, origem)
  select p_tenant_id, i.cliente_produto_id, i.modulo_id, 0, i.custo, 1,
         true, current_date, 'hiper'
  from _imp i
  where i.cliente_produto_id is not null and not i.ja_tem;

  get diagnostics v_inserir = row_count;

  return jsonb_build_object('ok', true, 'previa', false, 'inseridos', v_inserir,
    'ja_tinham', v_ja_tem, 'sem_produto_no_contrato', v_sem_prod);
end;
$$;

revoke all on function public.hiper_importar_modulos(uuid, boolean) from public;
grant execute on function public.hiper_importar_modulos(uuid, boolean) to authenticated, service_role;
