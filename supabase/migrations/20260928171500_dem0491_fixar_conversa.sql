-- DEM-0491 — Fixar conversa no topo da lista do chat.
--
-- Fixação é POR USUÁRIO: cada um tem a própria lista. Por isso mora numa tabela
-- própria e não em whatsapp_conversations — ela está na publication do Realtime,
-- e uma coluna ali geraria WAL + fanout para o tenant inteiro a cada clique.
--
-- A lista (whatsapp_list_conversations) NÃO muda. As fixadas vêm por uma RPC à
-- parte, por PK: são no máximo 5 linhas, e mexer na consulta mais quente do chat
-- para trazê-las já custou caro antes (o .or() que derrubou o índice).

create table if not exists public.whatsapp_conversation_pins (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  conversation_id uuid        not null references public.whatsapp_conversations(id) on delete cascade,
  tenant_id       uuid        not null,
  pinned_at       timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.whatsapp_conversation_pins enable row level security;

drop policy if exists "pins_select_own" on public.whatsapp_conversation_pins;
create policy "pins_select_own" on public.whatsapp_conversation_pins
  for select to authenticated
  using (user_id = auth.uid());

-- Só fixa conversa que o usuário ENXERGA: o EXISTS roda sob o RLS de
-- whatsapp_conversations de quem está inserindo. E o tenant gravado tem de ser
-- o da conversa, não um qualquer.
drop policy if exists "pins_insert_own" on public.whatsapp_conversation_pins;
create policy "pins_insert_own" on public.whatsapp_conversation_pins
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.whatsapp_conversations c
      where c.id = conversation_id and c.tenant_id = whatsapp_conversation_pins.tenant_id
    )
  );

drop policy if exists "pins_delete_own" on public.whatsapp_conversation_pins;
create policy "pins_delete_own" on public.whatsapp_conversation_pins
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.whatsapp_conversation_pins from anon;
grant select, insert, delete on public.whatsapp_conversation_pins to authenticated;
grant all on public.whatsapp_conversation_pins to service_role;

-- Limite de 5 por usuário. A tela já desabilita a opção no 6º; isto é a trava
-- de verdade (duas abas abertas, clique duplo).
create or replace function public.fn_wa_pins_limite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.whatsapp_conversation_pins where user_id = new.user_id) >= 5 then
    raise exception 'LIMITE_FIXADAS: no máximo 5 conversas fixadas por usuário'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wa_pins_limite on public.whatsapp_conversation_pins;
create trigger trg_wa_pins_limite
  before insert on public.whatsapp_conversation_pins
  for each row execute function public.fn_wa_pins_limite();

-- As fixadas do usuário logado, no mesmo formato de whatsapp_list_conversations
-- (conversation, contact, bucket) + pinned_at. SECURITY INVOKER de propósito:
-- o RLS de whatsapp_conversations continua valendo — conversa que o usuário
-- deixou de enxergar some da lista dele sem precisar desafixar.
create or replace function public.whatsapp_list_pinned_conversations(p_tenant_id uuid)
returns table(conversation jsonb, contact jsonb, bucket text, pinned_at timestamptz)
language sql
stable
set search_path = public
as $$
  select
    to_jsonb(c)  as conversation,
    to_jsonb(ct) as contact,
    public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) as bucket,
    p.pinned_at
  from public.whatsapp_conversation_pins p
  join public.whatsapp_conversations c on c.id = p.conversation_id
  join public.whatsapp_contacts ct     on ct.id = c.contact_id
  left join lateral (
    select s.status
    from public.support_attendances s
    where s.conversation_id = c.id
      and s.tenant_id       = c.tenant_id
      and s.status in ('waiting', 'in_progress')
    order by s.opened_at desc nulls last, s.created_at desc
    limit 1
  ) sa on true
  where p.user_id = auth.uid()
    and c.tenant_id = p_tenant_id
  order by p.pinned_at desc;
$$;

revoke all on function public.whatsapp_list_pinned_conversations(uuid) from public, anon;
grant execute on function public.whatsapp_list_pinned_conversations(uuid) to authenticated, service_role;
