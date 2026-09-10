-- audit_events tinha UMA policy, FOR ALL, valendo para qualquer membro ativo do
-- tenant. Na pratica: o proprio auditado podia apagar ou reescrever a linha que
-- registrava o que ele fez. Historico que o auditado edita nao serve de
-- historico -- e o DEM-0381 pede justamente que essa tela vire prova.
--
-- O que muda:
--   SELECT  -> so admin/head do tenant, ou super admin (era: qualquer membro)
--   INSERT  -> continua liberado ao membro ativo, mas preso ao proprio tenant e
--              ao proprio uid como autor (era: qualquer tenant, qualquer autor)
--   UPDATE  -> ninguem
--   DELETE  -> ninguem
--
-- INSERT continua existindo porque duas telas gravam auditoria direto do
-- cliente, como authenticated: AISettingsTab.tsx:184 e useTenantUsers.ts:195.
-- Tirar a policy quebraria as duas em silencio. As edge functions usam
-- service_role e nao passam por RLS.
--
-- Triggers e RPCs de auditoria sao SECURITY DEFINER, rodam como dono da tabela
-- e por isso continuam gravando sem depender de policy.

drop policy if exists audit_events_tenant_rw on public.audit_events;

create policy audit_events_leitura_admin
  on public.audit_events
  for select
  to authenticated
  using (
    coalesce((select public.is_super_admin()), false)
    or (
      coalesce((select public.is_tenant_admin_or_head()), false)
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy audit_events_insercao_propria
  on public.audit_events
  for insert
  to authenticated
  with check (
    coalesce((select public.is_tenant_active_member()), false)
    and tenant_id = (select public.current_tenant_id())
    and actor_user_id = (select auth.uid())
  );

-- Sem policy de UPDATE e sem policy de DELETE: RLS nega por omissao.
