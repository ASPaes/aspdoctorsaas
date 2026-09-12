-- ============================================================================
-- Assinatura por conta de e-mail
--
-- Texto, imagem ou os dois, e vai no fim de todo e-mail que sai pela conta
-- (quem aplica é a send-email, a porta única de saída).
--
-- Tabela à parte, e não colunas em email_accounts, por causa da imagem: a lista
-- de contas lê `select *` e passaria a carregar a imagem de todas as contas a
-- cada abertura da tela.
--
-- A imagem fica em base64 no banco, não no Storage: é pequena (até 500 KB), a
-- send-email precisa dos bytes para embutir no e-mail, e upload do navegador
-- para o Storage não funciona neste projeto.
--
-- Leitura: membro ativo do tenant. Escrita: admin ou head, as mesmas regras de
-- email_accounts (20260910130000).
--
-- Aplicar pelo SQL Editor. Idempotente.
-- ============================================================================

begin;

create table if not exists public.email_account_assinaturas (
  account_id     uuid primary key references public.email_accounts(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  texto          text,
  imagem_base64  text,
  imagem_mime    text,
  imagem_largura integer,
  imagem_altura  integer,
  updated_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid(),

  -- linha sem conteúdo não existe: assinatura vazia é linha apagada
  constraint email_account_assinaturas_tem_conteudo
    check (nullif(btrim(texto), '') is not null or imagem_base64 is not null),
  constraint email_account_assinaturas_imagem_completa
    check (imagem_base64 is null
           or (imagem_mime in ('image/png', 'image/jpeg', 'image/gif')
               and imagem_largura between 1 and 600
               and imagem_altura > 0)),
  -- 500 KB de arquivo viram ~667 KB em base64
  constraint email_account_assinaturas_imagem_tamanho
    check (imagem_base64 is null or octet_length(imagem_base64) <= 700000),
  constraint email_account_assinaturas_texto_tamanho
    check (texto is null or length(texto) <= 2000)
);

comment on table public.email_account_assinaturas is
  'Assinatura (texto e/ou imagem) que a send-email acrescenta no fim de todo e-mail da conta.';

alter table public.email_account_assinaturas enable row level security;

drop policy if exists email_account_assinaturas_select on public.email_account_assinaturas;
create policy email_account_assinaturas_select on public.email_account_assinaturas
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id()))
  );

-- escrita: admin ou head do próprio tenant, e só em conta do próprio tenant
drop policy if exists email_account_assinaturas_insert on public.email_account_assinaturas;
create policy email_account_assinaturas_insert on public.email_account_assinaturas
  for insert to authenticated
  with check (
    exists (select 1 from public.email_accounts a where a.id = account_id and a.tenant_id = email_account_assinaturas.tenant_id)
    and (
      (select coalesce(public.is_super_admin(), false))
      or ((select public.is_tenant_admin_or_head())
          and tenant_id = (select public.current_tenant_id()))
    )
  );

drop policy if exists email_account_assinaturas_update on public.email_account_assinaturas;
create policy email_account_assinaturas_update on public.email_account_assinaturas
  for update to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head())
        and tenant_id = (select public.current_tenant_id()))
  )
  with check (
    exists (select 1 from public.email_accounts a where a.id = account_id and a.tenant_id = email_account_assinaturas.tenant_id)
    and (
      (select coalesce(public.is_super_admin(), false))
      or ((select public.is_tenant_admin_or_head())
          and tenant_id = (select public.current_tenant_id()))
    )
  );

drop policy if exists email_account_assinaturas_delete on public.email_account_assinaturas;
create policy email_account_assinaturas_delete on public.email_account_assinaturas
  for delete to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head())
        and tenant_id = (select public.current_tenant_id()))
  );

-- o padrão do banco dá também TRUNCATE, TRIGGER e REFERENCES a authenticated;
-- TRUNCATE passa por cima do RLS, então sai tudo e volta só o que a tela usa
revoke all on public.email_account_assinaturas from anon, authenticated;
grant select, insert, update, delete on public.email_account_assinaturas to authenticated;
grant all on public.email_account_assinaturas to service_role;

commit;
