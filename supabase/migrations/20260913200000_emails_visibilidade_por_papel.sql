-- ============================================================================
-- E-mails: cada papel vê o que é seu
--
-- Regra do Alexandre (13/09/2026):
--   user  -> só os e-mails que ELE enviou e as respostas a esses e-mails;
--   head  -> todos os setores;
--   admin -> tudo.
-- É o desenho de support_attendances, onde admin e head veem todos os setores;
-- por isso head e admin enxergam o mesmo conjunto aqui, e o que separa o admin
-- continua sendo a lixeira e o "Ler agora".
--
-- Fica no RLS, e não só na tela: filtro só no frontend deixaria o operador ler
-- os e-mails dos outros direto pela API.
--
-- "Enviado por ele" é email_envios.enviado_por. O resumo automático do chat não
-- tem pessoa clicando: a send-attendance-summary passa a gravar o dono do
-- atendimento, e o bloco 3 acerta o que já tiver sido enviado sem autor.
--
-- Resposta avulsa (e-mail novo de cliente, sem envio de origem) não tem autor:
-- só head e admin veem.
--
-- Aplicar pelo SQL Editor. Blocos independentes e idempotentes. A permissão do
-- menu fica sozinha no último bloco, porque role_permissions é tabela quente.
-- ============================================================================


-- ── Bloco 1: enviados ────────────────────────────────────────────────────────
begin;

create index if not exists ix_email_envios_enviado_por
  on public.email_envios (enviado_por) where enviado_por is not null;

drop policy if exists email_envios_tenant_select on public.email_envios;
create policy email_envios_tenant_select on public.email_envios
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (
        (select public.is_tenant_admin_or_head())
        or enviado_por = (select auth.uid())
      )
    )
  );

commit;


-- ── Bloco 2: recebidos e estado da leitura das caixas ───────────────────────
begin;

drop policy if exists email_recebidos_tenant_select on public.email_recebidos;
create policy email_recebidos_tenant_select on public.email_recebidos
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (
        (select public.is_tenant_admin_or_head())
        or exists (
          select 1
            from public.email_envios e
           where e.id = email_recebidos.envio_id
             and e.enviado_por = (select auth.uid())
        )
      )
    )
  );

-- A linha "Lendo N caixas" da tela lia esta tabela sem permissão e engolia o
-- erro, então o último erro de leitura nunca aparecia. Leitura só para quem
-- configura caixa.
grant select on public.email_ingestao_estado to authenticated;

drop policy if exists email_ingestao_estado_select on public.email_ingestao_estado;
create policy email_ingestao_estado_select on public.email_ingestao_estado
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head())
        and tenant_id = (select public.current_tenant_id()))
  );

commit;


-- ── Bloco 3: autor dos resumos automáticos já enviados ──────────────────────
begin;

update public.email_envios e
   set enviado_por = coalesce(a.assigned_to, a.closed_by)
  from public.support_attendances a
 where a.id = e.referencia_id
   and e.enviado_por is null
   and coalesce(a.assigned_to, a.closed_by) is not null;

commit;


-- ── Bloco 4: operador passa a ver o menu E-mails ────────────────────────────
begin;

update public.role_permissions
   set can_view = true,
       updated_at = now()
 where resource_key = 'nav.emails'
   and role = 'user'
   and can_view = false;

commit;
