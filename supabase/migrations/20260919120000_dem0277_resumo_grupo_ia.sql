-- DEM-0277: resumo de grupo por IA, com historico.
--
-- Cada geracao vira uma linha nova (nunca sobrescreve, ao contrario de
-- whatsapp_conversation_summaries, que a generate-conversation-summary apaga
-- a cada geracao). Quem grava e a edge function (service_role); a tela so le,
-- corrige o texto e apaga, sempre pelas RPCs abaixo.
--
-- Trava so UMA tabela quente (whatsapp_conversations, pela FK). attendance_id
-- fica sem FK de proposito: travar support_attendances na mesma transacao abre
-- ciclo de deadlock com os gatilhos que escrevem nas duas.

begin;

set local lock_timeout = '5s';

create table if not exists public.whatsapp_group_summaries (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  conversation_id   uuid not null references public.whatsapp_conversations(id) on delete cascade,
  filter_type       text not null check (filter_type in ('last_24h', 'period', 'attendance')),
  attendance_id     uuid,
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  status            text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  error_message     text,
  message_count     integer not null default 0,
  last_message_at   timestamptz,
  parts             integer not null default 1,
  sections          jsonb,
  original_sections jsonb,
  provider          text,
  model             text,
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz,
  edited_by         uuid,
  edited_at         timestamptz,
  check (period_end >= period_start),
  check (filter_type <> 'attendance' or attendance_id is not null)
);

comment on table public.whatsapp_group_summaries is
  'DEM-0277: historico de resumos por IA de grupos de WhatsApp. Uma linha por geracao.';
comment on column public.whatsapp_group_summaries.sections is
  'Versao atual (com correcoes). Chaves: interacoes, treinamentos, duvidas, pendencias_cliente, pendencias_internas, decisoes, proximos_passos. Cada uma: [{texto, msg_at}].';
comment on column public.whatsapp_group_summaries.original_sections is
  'O que a IA devolveu. Nunca e alterado pela edicao.';
comment on column public.whatsapp_group_summaries.last_message_at is
  'Hora da ultima mensagem lida. Se nao chegou mensagem depois disso no mesmo periodo, a tela oferece abrir este resumo em vez de gerar outro.';

create index if not exists idx_wa_group_summaries_conv_created
  on public.whatsapp_group_summaries (conversation_id, created_at desc);

alter table public.whatsapp_group_summaries enable row level security;

-- Leitura: o mesmo portao de tenant de whatsapp_conversation_summaries.
-- Grupo ja e visivel para o tenant inteiro (is_group = true na policy da conversa).
drop policy if exists wa_group_summaries_select on public.whatsapp_group_summaries;
create policy wa_group_summaries_select on public.whatsapp_group_summaries
  for select to authenticated
  using (
    (select public.is_super_admin())
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
  );

-- Sem policy de INSERT/UPDATE/DELETE: escrita so pela edge function e pelas RPCs.
-- O default privileges do banco da ALL para anon/authenticated em tabela nova; tira.
revoke all on public.whatsapp_group_summaries from anon, authenticated;
grant select on public.whatsapp_group_summaries to authenticated;
grant all on public.whatsapp_group_summaries to service_role;

-- Salvar correcoes: troca so sections e carimba quem editou.
create or replace function public.wa_group_summary_save_edit(p_id uuid, p_sections jsonb)
returns public.whatsapp_group_summaries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.whatsapp_group_summaries;
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'Resumo invalido';
  end if;

  select * into v_row from public.whatsapp_group_summaries where id = p_id for update;
  if not found then
    raise exception 'Resumo nao encontrado';
  end if;

  if not (coalesce(public.is_super_admin(), false)
          or (coalesce(public.is_tenant_active_member(), false)
              and v_row.tenant_id = public.current_tenant_id())) then
    raise exception 'Sem permissao para editar este resumo';
  end if;

  if v_row.status <> 'ready' then
    raise exception 'O resumo ainda nao esta pronto';
  end if;

  update public.whatsapp_group_summaries
     set sections = p_sections,
         edited_by = auth.uid(),
         edited_at = now()
   where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

-- Apagar: quem gerou, ou admin/head do tenant.
create or replace function public.wa_group_summary_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.whatsapp_group_summaries;
begin
  select * into v_row from public.whatsapp_group_summaries where id = p_id;
  if not found then
    raise exception 'Resumo nao encontrado';
  end if;

  if not (coalesce(public.is_super_admin(), false)
          or (coalesce(public.is_tenant_active_member(), false)
              and v_row.tenant_id = public.current_tenant_id()
              and (v_row.created_by = auth.uid() or coalesce(public.is_admin_or_head(), false)))) then
    raise exception 'Sem permissao para apagar este resumo';
  end if;

  delete from public.whatsapp_group_summaries where id = p_id;
end;
$$;

revoke all on function public.wa_group_summary_save_edit(uuid, jsonb) from public, anon;
revoke all on function public.wa_group_summary_delete(uuid) from public, anon;
grant execute on function public.wa_group_summary_save_edit(uuid, jsonb) to authenticated, service_role;
grant execute on function public.wa_group_summary_delete(uuid) to authenticated, service_role;

commit;
