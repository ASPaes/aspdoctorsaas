-- ============================================================================
-- DEM-0425 -- Cancelamento agendado de produto / contrato (29/09/2026)
--
-- O "Cancelar agora" continua igual. Agendar grava uma linha aqui e NADA muda
-- no produto, no contrato, no cliente ou no MRR até a data efetiva.
--
-- Por que NÃO existe status 'em_cancelamento' em contratos: dezenas de pontos
-- leem contratos.status = 'ativo' (MRR, cliente cancelado, Omie, relatórios).
-- Um status novo tiraria o contrato de tudo isso no dia do pedido, e a regra é
-- ele seguir ativo até a data. "Em cancelamento" é derivado desta tabela, só
-- na tela.
--
-- No dia, o cron chama as MESMAS RPCs do "Cancelar agora"
-- (cancel_cliente_produto / cancelar_contrato) com p_data = data efetiva, então
-- churn, cliente cancelado e módulos seguem a regra que já existe. Roda como
-- quem agendou (request.jwt.claims), para que os portões de permissão e a
-- autoria em contrato_eventos valham igual ao clique.
--
-- O downsell do produto que sai de contrato com outros itens era lançado pelo
-- frontend depois do clique. Às 00:05 não há frontend: o processador lança.
-- ============================================================================

begin;

create table if not exists public.cancelamentos_agendados (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  cliente_id         uuid not null,
  alvo               text not null check (alvo in ('produto','contrato')),
  cliente_produto_id uuid references public.cliente_produtos(id) on delete cascade,
  contrato_id        uuid references public.contratos(id) on delete cascade,
  data_efetiva       date not null,
  motivo_id          bigint,
  observacao         text,
  status             text not null default 'agendado'
                     check (status in ('agendado','executado','desfeito','ignorado','falhou')),
  erro               text,
  resultado          jsonb,
  criado_por         uuid,
  criado_em          timestamptz not null default now(),
  executado_em       timestamptz,
  desfeito_por       uuid,
  desfeito_em        timestamptz,
  check ((alvo = 'produto'  and cliente_produto_id is not null)
      or (alvo = 'contrato' and contrato_id is not null))
);

-- Um agendamento vivo por alvo.
create unique index if not exists cancel_agend_um_por_produto
  on public.cancelamentos_agendados (cliente_produto_id) where status = 'agendado' and alvo = 'produto';
create unique index if not exists cancel_agend_um_por_contrato
  on public.cancelamentos_agendados (contrato_id) where status = 'agendado' and alvo = 'contrato';
-- O que o cron varre.
create index if not exists cancel_agend_fila
  on public.cancelamentos_agendados (data_efetiva) where status = 'agendado';
create index if not exists cancel_agend_cliente
  on public.cancelamentos_agendados (tenant_id, cliente_id);

alter table public.cancelamentos_agendados enable row level security;

drop policy if exists cancel_agend_select on public.cancelamentos_agendados;
create policy cancel_agend_select on public.cancelamentos_agendados
  for select to authenticated
  using (
    tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid())
    or coalesce(public.is_super_admin(), false)
  );
-- Escrita só pelas RPCs abaixo.
revoke all on public.cancelamentos_agendados from public, anon, authenticated;
grant select on public.cancelamentos_agendados to authenticated;
grant all on public.cancelamentos_agendados to service_role;

-- ---------------------------------------------------------------------------
-- Agendar
-- ---------------------------------------------------------------------------
create or replace function public.agendar_cancelamento(
  p_alvo text, p_id uuid, p_data date,
  p_motivo_id bigint default null, p_observacao text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tenant uuid; v_cliente uuid; v_ativo boolean;
  v_itens integer := 0;
  v_user_tenant uuid;
  v_id uuid;
begin
  if p_alvo not in ('produto','contrato') then raise exception 'alvo inválido'; end if;
  if p_data is null or p_data <= v_hoje then
    raise exception 'A data do cancelamento agendado precisa ser a partir de amanhã. Para hoje, use Cancelar agora.';
  end if;

  if p_alvo = 'produto' then
    select cp.tenant_id, cp.cliente_id, cp.ativo into v_tenant, v_cliente, v_ativo
      from cliente_produtos cp where cp.id = p_id;
    if v_tenant is null then raise exception 'Produto não encontrado'; end if;
    if not v_ativo then raise exception 'Este produto já está cancelado'; end if;
    -- Único item do contrato = no dia vira cancelar_contrato, que exige admin/head.
    -- Barrar agora é melhor que falhar sozinho às 00:05.
    select count(*) into v_itens from contrato_itens ci
     where ci.contrato_id = (select ci2.contrato_id from contrato_itens ci2 where ci2.cliente_produto_id = p_id limit 1);
  else
    select c.tenant_id, c.cliente_id, c.status = 'ativo' into v_tenant, v_cliente, v_ativo
      from contratos c where c.id = p_id;
    if v_tenant is null then raise exception 'Contrato não encontrado'; end if;
    if not v_ativo then raise exception 'Este contrato já está cancelado'; end if;
  end if;

  select tenant_id into v_user_tenant from profiles where user_id = auth.uid();
  if not coalesce(public.is_super_admin(), false) and v_user_tenant is distinct from v_tenant then
    raise exception 'Sem permissão no tenant do cliente';
  end if;
  if (p_alvo = 'contrato' or v_itens = 1) and not coalesce(public.is_admin_or_head(), false) then
    raise exception 'forbidden: apenas admin/head cancelam contrato';
  end if;

  begin
    insert into cancelamentos_agendados (tenant_id, cliente_id, alvo, cliente_produto_id, contrato_id,
                                         data_efetiva, motivo_id, observacao, criado_por)
    values (v_tenant, v_cliente, p_alvo,
            case when p_alvo = 'produto' then p_id end,
            case when p_alvo = 'contrato' then p_id end,
            p_data, p_motivo_id, nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe um cancelamento agendado para este %. Desfaça o atual para marcar outra data.', p_alvo;
  end;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Desfazer
-- ---------------------------------------------------------------------------
create or replace function public.desfazer_cancelamento_agendado(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_row cancelamentos_agendados; v_user_tenant uuid;
begin
  select * into v_row from cancelamentos_agendados where id = p_id for update;
  if v_row.id is null then raise exception 'Agendamento não encontrado'; end if;
  select tenant_id into v_user_tenant from profiles where user_id = auth.uid();
  if not coalesce(public.is_super_admin(), false) and v_user_tenant is distinct from v_row.tenant_id then
    raise exception 'Sem permissão no tenant do cliente';
  end if;
  if v_row.status <> 'agendado' then
    raise exception 'Este agendamento não está mais pendente (status: %)', v_row.status;
  end if;
  update cancelamentos_agendados
     set status = 'desfeito', desfeito_por = auth.uid(), desfeito_em = now()
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Processar (cron diário). Cada linha em subtransação: uma falha não trava as outras.
-- ---------------------------------------------------------------------------
create or replace function public.fn_processar_cancelamentos_agendados()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r cancelamentos_agendados;
  v_cp record; v_res jsonb;
  v_ok int := 0; v_ign int := 0; v_err int := 0;
  v_claims text := current_setting('request.jwt.claims', true);
begin
  for r in
    select * from cancelamentos_agendados
     where status = 'agendado' and data_efetiva <= v_hoje
     order by data_efetiva, criado_em
     for update skip locked
  loop
    begin
      -- Roda como quem agendou: portões e autoria iguais ao clique.
      perform set_config('request.jwt.claims',
        json_build_object('sub', r.criado_por, 'role', 'authenticated')::text, true);

      if r.alvo = 'produto' then
        select cp.id, cp.ativo, cp.vlr_mensal, cp.vlr_custo, p.nome
          into v_cp
          from cliente_produtos cp left join produtos p on p.id = cp.produto_id
         where cp.id = r.cliente_produto_id;
        if v_cp.id is null or not v_cp.ativo then
          update cancelamentos_agendados set status = 'ignorado', executado_em = now(),
                 erro = 'Produto já estava cancelado na data' where id = r.id;
          v_ign := v_ign + 1; continue;
        end if;

        v_res := public.cancel_cliente_produto(r.cliente_produto_id, r.motivo_id, r.observacao, r.data_efetiva);

        -- Mesmo downsell que o frontend lança depois do "Cancelar agora".
        if not coalesce((v_res->>'contrato_cancelado')::boolean, false)
           and coalesce(v_cp.vlr_mensal, 0) > 0
           and not public.fn_receita_vem_dos_modulos(r.cliente_produto_id) then
          insert into movimentos_mrr (tenant_id, cliente_id, tipo, data_movimento,
                                      valor_delta, custo_delta, descricao, status)
          values (r.tenant_id, r.cliente_id, 'downsell', r.data_efetiva,
                  -v_cp.vlr_mensal, -coalesce(v_cp.vlr_custo, 0),
                  'Produto ' || coalesce(v_cp.nome, '') || ' cancelado (agendado)', 'ativo');
          v_res := v_res || jsonb_build_object('downsell', v_cp.vlr_mensal);
        end if;
      else
        if not exists (select 1 from contratos where id = r.contrato_id and status = 'ativo') then
          update cancelamentos_agendados set status = 'ignorado', executado_em = now(),
                 erro = 'Contrato já estava cancelado na data' where id = r.id;
          v_ign := v_ign + 1; continue;
        end if;
        v_res := public.cancelar_contrato(r.contrato_id, r.motivo_id, r.observacao, r.data_efetiva);
      end if;

      update cancelamentos_agendados set status = 'executado', executado_em = now(), resultado = v_res
       where id = r.id;
      v_ok := v_ok + 1;
    exception when others then
      update cancelamentos_agendados set status = 'falhou', executado_em = now(), erro = sqlerrm
       where id = r.id;
      v_err := v_err + 1;
    end;
  end loop;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return jsonb_build_object('executados', v_ok, 'ignorados', v_ign, 'falhas', v_err);
end;
$$;

revoke all on function public.agendar_cancelamento(text, uuid, date, bigint, text) from public, anon;
revoke all on function public.desfazer_cancelamento_agendado(uuid) from public, anon;
revoke all on function public.fn_processar_cancelamentos_agendados() from public, anon, authenticated;
grant execute on function public.agendar_cancelamento(text, uuid, date, bigint, text) to authenticated, service_role;
grant execute on function public.desfazer_cancelamento_agendado(uuid) to authenticated, service_role;
grant execute on function public.fn_processar_cancelamentos_agendados() to service_role;

commit;

-- 00:05 em São Paulo = 03:05 UTC. Reaplicar substitui o job.
SELECT cron.schedule('processar-cancelamentos-agendados', '5 3 * * *',
  $$SELECT public.fn_processar_cancelamentos_agendados()$$);
