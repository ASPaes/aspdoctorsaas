-- Editar nota do agente na timeline (onboarding/implantação e suporte).
-- Regra: só o autor da nota edita, só o tipo 'nota_agente', e a nota fica marcada como editada.
-- A tabela continua SEM policy de UPDATE: toda escrita passa por esta RPC.

alter table public.support_ticket_events
  add column if not exists edited_at timestamptz;

create or replace function public.editar_nota_agente(p_event_id uuid, p_content text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_content text := btrim(coalesce(p_content, ''));
  v_user_id uuid;
  v_type    text;
  v_edited  timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'sem_sessao');
  end if;

  if v_content = '' then
    return jsonb_build_object('ok', false, 'reason', 'conteudo_vazio');
  end if;

  select user_id, event_type
    into v_user_id, v_type
    from public.support_ticket_events
   where id = p_event_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'nao_encontrado');
  end if;

  -- Movimentação/log não é editável: só o que alguém digitou.
  if v_type is distinct from 'nota_agente' then
    return jsonb_build_object('ok', false, 'reason', 'nao_e_nota');
  end if;

  -- user_id nulo = evento de sistema; ninguém é autor dele.
  if v_user_id is null or v_user_id <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'nao_autor');
  end if;

  update public.support_ticket_events
     set content   = v_content,
         edited_at = now()
   where id = p_event_id
  returning edited_at into v_edited;

  return jsonb_build_object('ok', true, 'edited_at', v_edited);
end;
$$;

revoke all on function public.editar_nota_agente(uuid, text) from public;
revoke all on function public.editar_nota_agente(uuid, text) from anon;
grant execute on function public.editar_nota_agente(uuid, text) to authenticated, service_role;
