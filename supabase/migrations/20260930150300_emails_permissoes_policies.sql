-- =============================================================================
-- E-mails — as ações de dentro da tela viram permissão (3/3: RLS)
--
-- Cada policy é a de produção de 30/09/2026 com UMA troca:
--   `(select is_tenant_admin_or_head())`  ->  `(select rbac_pode(<chave>, array['admin','head']))`
--
-- `is_tenant_admin_or_head()` também exigia perfil ativo. Nas 3 de leitura isso
-- já vem do `is_tenant_active_member()` ao lado; nas de macro, que não o tinham,
-- ele entra junto para não abrir nada a perfil pendente.
--
-- `rbac_pode` vai dentro de `(select ...)`: vira initplan, roda UMA vez por
-- consulta, não uma por linha.
--
-- ⚠️ UMA POLICY POR TRANSAÇÃO: em 15/09, três ALTER POLICY juntos em tabelas
-- que se referenciam deram deadlock em produção (email_recebidos lê email_envios).
-- =============================================================================

-- ------------------------------------------ Ver e-mails de todas as pessoas
begin;
set local lock_timeout = '3s';  -- trava ocupada = falha rápida, não fila atrás de nós
alter policy email_envios_tenant_select on public.email_envios
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (
        (select public.rbac_pode('email.ver_todos', array['admin', 'head']))
        or enviado_por = (select auth.uid())
      )
    )
  );
commit;

begin;
set local lock_timeout = '3s';  -- trava ocupada = falha rápida, não fila atrás de nós
alter policy email_recebidos_tenant_select on public.email_recebidos
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (
        (select public.rbac_pode('email.ver_todos', array['admin', 'head']))
        or exists (
          select 1 from public.email_envios e
           where e.id = email_recebidos.envio_id
             and e.enviado_por = (select auth.uid())
        )
      )
    )
  );
commit;

begin;
set local lock_timeout = '3s';  -- trava ocupada = falha rápida, não fila atrás de nós
alter policy email_agendados_select on public.email_agendados
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (
        (select public.rbac_pode('email.ver_todos', array['admin', 'head']))
        or agendado_por = (select auth.uid())
      )
    )
  );
commit;

-- ------------------------------------------------ Cadastrar macros de e-mail
begin;
set local lock_timeout = '3s';  -- trava ocupada = falha rápida, não fila atrás de nós
alter policy email_macros_escrita on public.email_macros
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and (select public.rbac_pode('email.macros', array['admin', 'head']))
      and tenant_id = (select public.current_tenant_id())
    )
  )
  with check (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and (select public.rbac_pode('email.macros', array['admin', 'head']))
      and tenant_id = (select public.current_tenant_id())
    )
  );
commit;

begin;
set local lock_timeout = '3s';  -- trava ocupada = falha rápida, não fila atrás de nós
alter policy email_macro_anexos_escrita on public.email_macro_anexos
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and (select public.rbac_pode('email.macros', array['admin', 'head']))
      and tenant_id = (select public.current_tenant_id())
    )
  )
  with check (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and (select public.rbac_pode('email.macros', array['admin', 'head']))
      and tenant_id = (select public.current_tenant_id())
    )
  );
commit;

begin;
set local lock_timeout = '3s';  -- trava ocupada = falha rápida, não fila atrás de nós
alter policy email_macro_anexos_subir on storage.objects
  with check (
    bucket_id = 'email-macro-anexos'
    and (
      (select coalesce(public.is_super_admin(), false))
      or (
        (select public.is_tenant_active_member())
        and (select public.rbac_pode('email.macros', array['admin', 'head']))
        and (storage.foldername(name))[1] = ((select public.current_tenant_id()))::text
      )
    )
  );
commit;

begin;
set local lock_timeout = '3s';  -- trava ocupada = falha rápida, não fila atrás de nós
alter policy email_macro_anexos_apagar on storage.objects
  using (
    bucket_id = 'email-macro-anexos'
    and (
      (select coalesce(public.is_super_admin(), false))
      or (
        (select public.is_tenant_active_member())
        and (select public.rbac_pode('email.macros', array['admin', 'head']))
        and (storage.foldername(name))[1] = ((select public.current_tenant_id()))::text
      )
    )
  );
commit;
