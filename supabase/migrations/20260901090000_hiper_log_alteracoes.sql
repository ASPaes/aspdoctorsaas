-- Trilha do que a integração mudou no cadastro, com desfazer.
--
-- Este módulo escreve em dado de cliente a partir do que um portal externo diz.
-- Sem trilha, um erro de análise do operador vira um valor trocado que ninguém
-- sabe de onde veio nem qual era antes. Guardar o VALOR ANTIGO é o que permite
-- voltar; guardar quem e quando é o que permite entender.
--
-- Uma linha por campo alterado. `lote_id` agrupa o que saiu de um clique só,
-- para desfazer o lote inteiro do jeito que ele foi feito.

create table if not exists public.hiper_alteracao_log (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  lote_id               uuid not null,
  recon_id              uuid,
  cliente_id            uuid,
  cliente_produto_id    uuid,
  codigo_sequencial     integer,
  cliente_nome          text,
  acao                  text not null,   -- tipo_contrato | custo | mrr | razao_social | modulos
  tabela                text not null,   -- onde a linha vive
  registro_id           uuid,            -- a linha alterada
  campo                 text,
  valor_antes           jsonb,           -- null em INSERT
  valor_depois          jsonb,
  feito_por             uuid,
  feito_em              timestamptz not null default now(),
  revertido_em          timestamptz,
  revertido_por         uuid
);

create index if not exists hiper_log_tenant_data on public.hiper_alteracao_log (tenant_id, feito_em desc);
create index if not exists hiper_log_lote        on public.hiper_alteracao_log (lote_id);
create index if not exists hiper_log_cliente     on public.hiper_alteracao_log (tenant_id, cliente_id);

comment on table public.hiper_alteracao_log is
  'O que a integração Hiper mudou no cadastro: quem, quando, qual campo, valor antes e depois. Append-only para quem usa a tela — reverter GRAVA a volta e marca a linha, nunca apaga o histórico.';

alter table public.hiper_alteracao_log enable row level security;

create policy hiper_log_select on public.hiper_alteracao_log for select to authenticated
using ((select public.is_super_admin())
    or (tenant_id = (select public.current_tenant_id()) and (select public.is_tenant_admin_or_head())));

-- Sem INSERT/UPDATE/DELETE para `authenticated`: quem escreve aqui são as RPCs
-- (SECURITY DEFINER). Trilha que o próprio operador pode reescrever não é trilha.

-- ─────────────────────────────────────────────────────────────────────────────
-- Desfazer. Volta os valores do lote e MARCA as linhas — o histórico fica.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.hiper_reverter_lote(p_tenant_id uuid, p_lote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l         record;
  v_voltou  integer := 0;
  v_falhou  jsonb := '[]'::jsonb;
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  if not exists (select 1 from public.hiper_alteracao_log
                 where tenant_id = p_tenant_id and lote_id = p_lote_id and revertido_em is null) then
    return jsonb_build_object('ok', false, 'erro', 'Este lote já foi revertido ou não existe.');
  end if;

  -- Ordem inversa: o que foi feito por último volta primeiro.
  for l in
    select * from public.hiper_alteracao_log
    where tenant_id = p_tenant_id and lote_id = p_lote_id and revertido_em is null
    order by feito_em desc, id desc
  loop
    begin
      if l.tabela = 'cliente_produtos' then
        execute format('update public.cliente_produtos set %I = $1, updated_at = now() where id = $2', l.campo)
          using (case when l.valor_antes = 'null'::jsonb then null
                      when l.campo in ('vlr_mensal','vlr_custo') then (l.valor_antes #>> '{}')::numeric
                      when l.campo = 'modelo_contrato_id' then (l.valor_antes #>> '{}')::bigint
                      else null end),
                l.registro_id;

      elsif l.tabela = 'clientes' then
        execute format('update public.clientes set %I = $1, updated_at = now() where id = $2', l.campo)
          using (l.valor_antes #>> '{}'), l.registro_id;

      elsif l.tabela = 'cliente_produto_modulos' then
        if l.valor_antes is null or l.valor_antes = 'null'::jsonb then
          -- era INSERT: some com a linha
          delete from public.cliente_produto_modulos where id = l.registro_id;
        else
          update public.cliente_produto_modulos
             set vlr_custo  = (l.valor_antes->>'vlr_custo')::numeric,
                 quantidade = (l.valor_antes->>'quantidade')::integer,
                 updated_at = now()
           where id = l.registro_id;
        end if;
      end if;

      update public.hiper_alteracao_log
         set revertido_em = now(), revertido_por = auth.uid()
       where id = l.id;
      v_voltou := v_voltou + 1;

    exception when others then
      v_falhou := v_falhou || jsonb_build_object(
        'campo', coalesce(l.campo, l.acao), 'cliente', l.cliente_nome, 'motivo', sqlerrm);
    end;
  end loop;

  -- O contrato acompanha de volta.
  perform public.sync_cliente_produto_to_contract(cp_id)
  from (select distinct cliente_produto_id as cp_id
        from public.hiper_alteracao_log
        where lote_id = p_lote_id and cliente_produto_id is not null) t;

  perform public.hiper_reconciliar(p_tenant_id);

  return jsonb_build_object('ok', true, 'revertidos', v_voltou, 'falhas', v_falhou);
end;
$$;

revoke all on function public.hiper_reverter_lote(uuid, uuid) from public;
grant execute on function public.hiper_reverter_lote(uuid, uuid) to authenticated, service_role;
