-- ============================================================================
-- E-mails: abrir o e-mail e arquivar (entrega 1 de 3)
--
-- Pedido do Alexandre (15/09/2026): nas abas Enviados e Recebidos hoje o e-mail
-- só aparece como uma linha; não dá para ler. Esta migration prepara o banco
-- para a leitura e para o arquivamento. Pastas e mover (entrega 2) e responder
-- e encaminhar (entrega 3) vêm depois, em migrations próprias.
--
-- 1) CORPO DO ENVIADO. A `send-email` não guarda o corpo (está escrito no
--    cabeçalho dela: "O corpo da mensagem não é guardado em lugar nenhum").
--    Sem isso, abrir um enviado mostraria só o cabeçalho. Decisão dele em
--    15/09: guardar, e apagar o corpo sozinho depois de 12 meses. Os envios
--    ANTERIORES a esta mudança continuam sem texto — não existe de onde tirar.
--
-- 2) ARQUIVAR ≠ LIXEIRA. Arquivado sai da lista principal e fica em
--    "Arquivadas", sem prazo; a lixeira continua como está (admin, restaurar,
--    excluir de vez). Por isso coluna separada, e não reuso de deleted_at.
--
-- 3) QUEM PODE ARQUIVAR segue a mesma regra de quem ENXERGA, de 13/09
--    (20260913200000_emails_visibilidade_por_papel.sql):
--      user  -> só os e-mails que ele enviou e as respostas a esses envios;
--      head/admin -> tudo do tenant; super admin -> tudo.
--    A checagem fica na função, não só na tela.
--
-- Aplicar pelo SQL Editor. Blocos independentes e idempotentes. A agenda fica
-- fora da transação porque cron.schedule não pertence ao schema public e o
-- banco local não tem pg_cron.
-- ============================================================================


-- ── Bloco 1: colunas novas ──────────────────────────────────────────────────
begin;

-- corpo do e-mail enviado (a send-email passa a gravar; ver ordem no fim)
alter table public.email_envios
  add column if not exists corpo_texto text,
  add column if not exists corpo_html  text,
  add column if not exists arquivado_em timestamptz;

alter table public.email_recebidos
  add column if not exists arquivado_em timestamptz;

comment on column public.email_envios.corpo_texto is
  'Texto puro do e-mail enviado. Gravado pela send-email desde 15/09/2026; apagado por fn_email_limpar_corpo_antigo depois de 12 meses. Nulo em envio anterior a essa data.';
comment on column public.email_envios.corpo_html is
  'HTML do e-mail enviado, já com a assinatura da conta. Mesma limpeza de 12 meses do corpo_texto.';
comment on column public.email_envios.arquivado_em is
  'Arquivado pela tela: sai da lista principal e fica em Arquivadas. Diferente de deleted_at (lixeira).';
comment on column public.email_recebidos.arquivado_em is
  'Arquivado pela tela: sai da lista principal e fica em Arquivadas. Diferente de deleted_at (lixeira).';

commit;


-- ── Bloco 2: índice da aba Arquivadas ───────────────────────────────────────
-- Só os dois de arquivados. A lista principal continua no índice que já existe
-- (ix_email_envios_tenant_ativo / ix_email_recebidos_tenant_ativo, ambos
-- `tenant_id, data` com deleted_at is null): acrescentar `arquivado_em is null`
-- criaria um índice quase igual, e cada índice a mais pesa nas duas tabelas,
-- que recebem linha a cada envio e a cada leitura de caixa.
-- Estes aqui indexam SÓ as linhas arquivadas, que são poucas, e atendem uma
-- consulta que hoje não existe (arquivado_em is not null, mais recentes antes).
begin;

create index if not exists ix_email_envios_tenant_arquivados
  on public.email_envios (tenant_id, arquivado_em desc)
  where arquivado_em is not null;

create index if not exists ix_email_recebidos_tenant_arquivados
  on public.email_recebidos (tenant_id, arquivado_em desc)
  where arquivado_em is not null;

commit;


-- ── Bloco 3: arquivar e desarquivar ─────────────────────────────────────────
begin;

create or replace function public.fn_email_arquivar(
  p_tabela   text,
  p_ids      uuid[],
  p_arquivar boolean default true
)
returns table(afetados integer, bloqueados integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.fn_acting_user();
  v_super    boolean := coalesce(public.is_super_admin(), false);
  v_role     text;
  v_tenant   uuid;
  v_ativo    boolean;
  v_tudo     boolean;
  v_quando   timestamptz := case when p_arquivar then now() else null end;
  v_afetados integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  if p_tabela not in ('enviados', 'recebidos') then
    raise exception 'Tabela inválida: %', p_tabela;
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return query select 0, 0;
    return; -- sem isto a execução seguiria e o update rodaria com lista vazia
  end if;

  select p.role, p.tenant_id,
         coalesce(p.access_status, '') in ('active', 'ativo') and coalesce(p.status, 'ativo') in ('ativo', 'active')
    into v_role, v_tenant, v_ativo
    from public.profiles p where p.user_id = v_uid limit 1;

  -- SECURITY DEFINER passa por cima do RLS, então a checagem de membro ATIVO
  -- precisa estar aqui: sem ela, perfil pendente arquivava e-mail que nem vê.
  if not v_super and not coalesce(v_ativo, false) then
    raise exception 'Seu acesso ainda não está liberado neste tenant.' using errcode = '42501';
  end if;

  -- head e admin mexem em tudo do tenant; user, só no que é dele. É a mesma
  -- regra do RLS de 13/09, repetida aqui porque SECURITY DEFINER passa por cima.
  v_tudo := v_super or coalesce(v_role, '') in ('admin', 'head');

  if not v_tudo and v_tenant is null then
    raise exception 'Perfil sem tenant.' using errcode = '42501';
  end if;

  if p_tabela = 'enviados' then
    with alvo as (
      update public.email_envios e
         set arquivado_em = v_quando
       where e.id = any(p_ids)
         and (v_super or e.tenant_id = v_tenant)
         and (v_tudo or e.enviado_por = v_uid)
         and e.deleted_at is null
         and (e.arquivado_em is null) = p_arquivar
      returning 1
    )
    select count(*) into v_afetados from alvo;
  else
    with alvo as (
      update public.email_recebidos r
         set arquivado_em = v_quando
       where r.id = any(p_ids)
         and (v_super or r.tenant_id = v_tenant)
         and (
           v_tudo
           or exists (
             select 1 from public.email_envios e
              where e.id = r.envio_id and e.enviado_por = v_uid
           )
         )
         and r.deleted_at is null
         and (r.arquivado_em is null) = p_arquivar
      returning 1
    )
    select count(*) into v_afetados from alvo;
  end if;

  -- bloqueados = o que a pessoa pediu e não podia (de outro, na lixeira, ou já
  -- no estado pedido). A tela usa esse número para avisar em vez de mentir.
  return query select v_afetados, cardinality(p_ids) - v_afetados;
end;
$$;

revoke all on function public.fn_email_arquivar(text, uuid[], boolean) from public, anon;
grant execute on function public.fn_email_arquivar(text, uuid[], boolean) to authenticated, service_role;

commit;


-- ── Bloco 4: limpeza do corpo depois de 12 meses ────────────────────────────
-- O corpo é o único conteúdo de cliente que passa a morar aqui. Guardar para
-- sempre engorda o banco e amplia o que vaza num acesso indevido; 12 meses
-- cobre a consulta real ("o que eu mandei para esse cliente?") e some depois.
-- A linha do envio continua: some só o texto.
begin;

create or replace function public.fn_email_limpar_corpo_antigo(p_meses integer default 12)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apagados integer := 0;
begin
  with alvo as (
    update public.email_envios
       set corpo_texto = null, corpo_html = null
     where created_at < now() - make_interval(months => greatest(p_meses, 1))
       and (corpo_texto is not null or corpo_html is not null)
    returning 1
  )
  select count(*) into v_apagados from alvo;

  return v_apagados;
end;
$$;

revoke all on function public.fn_email_limpar_corpo_antigo(integer) from public, anon, authenticated;
grant execute on function public.fn_email_limpar_corpo_antigo(integer) to service_role;

commit;

-- a agenda fica fora da transação: cron.schedule não pertence ao schema public
-- e o banco local não tem pg_cron, então o bloco só roda onde a extensão existe
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'limpar-corpo-emails-antigos',
      '20 6 * * *',  -- 03:20 em São Paulo, fora do pico
      $cron$select public.fn_email_limpar_corpo_antigo(12);$cron$
    );
    raise notice 'agenda limpar-corpo-emails-antigos criada/substituida';
  else
    raise notice 'pg_cron ausente (banco local): agenda nao criada';
  end if;
end $$;


-- ============================================================================
-- ORDEM OBRIGATÓRIA: este SQL vai ANTES do push.
--   1. aplicar esta migration;
--   2. publicar a send-email (passa a gravar corpo_texto/corpo_html);
--   3. push da tela (olho para abrir o e-mail, botão Arquivadas, arquivar).
-- Invertendo 1 e 2, a send-email tentaria gravar coluna que não existe e o
-- insert do envio falharia — o e-mail sairia e o registro não.
-- ============================================================================
