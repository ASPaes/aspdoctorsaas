-- DEM-0461 — aviso de e-mail novo (23/09/2026)
--
-- Até aqui `email_recebidos` não tinha nenhum conceito de "lido": a caixa de
-- Recebidos mostrava tudo igual e não havia como contar o que chegou e ninguém
-- olhou. O badge da barra lateral e o do card do chamado precisam desse estado.
--
-- Decisão do Alexandre (23/09/2026): a leitura é da EQUIPE, não de cada pessoa.
-- Quem abrir primeiro tira o e-mail da contagem de todo mundo. É fila
-- compartilhada: o que um colega já viu não deve continuar cobrando os outros.

alter table public.email_recebidos
  add column if not exists lido_em  timestamptz,
  add column if not exists lido_por uuid;

comment on column public.email_recebidos.lido_em is
  'Quando alguém abriu este e-mail. Leitura é da equipe: o primeiro que abre limpa a contagem para todos.';
comment on column public.email_recebidos.lido_por is
  'Quem abriu primeiro (profiles.user_id). Só registro, não muda permissão.';

-- "Não lido" tem UMA definição, repetida no índice e nas duas consultas da tela:
--   lido_em is null and deleted_at is null and arquivado_em is null and acao <> 'ignorado'
-- Arquivar conta como lido de propósito: arquivar já é "tratei disso", e sem
-- isso o badge do arquivado nunca mais sairia da conta.
create index if not exists idx_email_recebidos_nao_lidos
  on public.email_recebidos (tenant_id, ticket_id)
  where lido_em is null and deleted_at is null and arquivado_em is null and acao <> 'ignorado';

-- Não existe policy de UPDATE em email_recebidos (só SELECT), então marcar lido
-- passa por RPC, como já fazem a lixeira e o arquivar.
create or replace function public.fn_email_recebidos_marcar_lido(
  p_ids       uuid[] default null,
  p_ticket_id uuid   default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := public.fn_acting_user();
  v_super  boolean := coalesce(public.is_super_admin(), false);
  v_role   text;
  v_tenant uuid;
  v_ativo  boolean;
  v_tudo   boolean;
  v_n      integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  -- sem esta saída, o update rodaria com lista vazia E ticket nulo, marcando
  -- lido o tenant inteiro
  if (p_ids is null or cardinality(p_ids) = 0) and p_ticket_id is null then
    return 0;
  end if;

  select p.role, p.tenant_id,
         coalesce(p.access_status, '') in ('active', 'ativo') and coalesce(p.status, 'ativo') in ('ativo', 'active')
    into v_role, v_tenant, v_ativo
    from public.profiles p where p.user_id = v_uid limit 1;

  -- SECURITY DEFINER passa por cima do RLS: a checagem de membro ativo mora aqui
  if not v_super and not coalesce(v_ativo, false) then
    raise exception 'Seu acesso ainda não está liberado neste tenant.' using errcode = '42501';
  end if;

  -- mesma regra do RLS de 13/09: head e admin enxergam a caixa toda; user, só o
  -- recebido que responde a um envio dele
  v_tudo := v_super or coalesce(v_role, '') in ('admin', 'head');

  if not v_tudo and v_tenant is null then
    raise exception 'Perfil sem tenant.' using errcode = '42501';
  end if;

  with alvo as (
    update public.email_recebidos r
       set lido_em = now(), lido_por = v_uid
     where (p_ids is null or r.id = any(p_ids))
       and (p_ticket_id is null or r.ticket_id = p_ticket_id)
       and r.lido_em is null
       and (v_super or r.tenant_id = v_tenant)
       and (
         v_tudo
         or exists (
           select 1 from public.email_envios e
            where e.id = r.envio_id and e.enviado_por = v_uid
         )
       )
    returning 1
  )
  select count(*) into v_n from alvo;

  return v_n;
end;
$function$;

revoke all on function public.fn_email_recebidos_marcar_lido(uuid[], uuid) from public;
revoke all on function public.fn_email_recebidos_marcar_lido(uuid[], uuid) from anon;
grant execute on function public.fn_email_recebidos_marcar_lido(uuid[], uuid) to authenticated, service_role;
