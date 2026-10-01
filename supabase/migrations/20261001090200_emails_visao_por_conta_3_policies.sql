-- =============================================================================
-- E-mails — quem vê o quê passa a depender da CONTA (3/3: leitura)
--
-- As 3 policies de SELECT são as de produção de 30/09/2026 com UMA troca:
--   rbac_pode('email.ver_todos') OR dono = eu
-- vira a regra por conta (ver 1/3 e 2/3), na mesma expressão de
-- fn_email_pode_ver. Mudou uma, mude a outra.
--
-- As funções vão dentro de `(select ...)`: viram initplan e rodam UMA vez por
-- consulta, não uma por linha.
-- Uma transação por tabela, com lock_timeout: ALTER POLICY pega lock da tabela.
-- =============================================================================

-- ----------------------------------------------------------- enviados
begin;
set local lock_timeout = '5s';
alter policy email_envios_tenant_select on public.email_envios
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (
        account_id = any ((select public.fn_email_contas_visiveis('saida'))::uuid[])
        or (account_id is null and (select public.fn_email_pode('saida', 'todos')))
        or (
          enviado_por = (select auth.uid())
          and not coalesce(account_id = any ((select public.fn_email_contas_vinculadas())::uuid[]), false)
          and (select public.fn_email_pode('saida', 'proprios'))
        )
      )
    )
  );
commit;

-- ----------------------------------------------------------- recebidos
begin;
set local lock_timeout = '5s';
alter policy email_recebidos_tenant_select on public.email_recebidos
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (
        account_id = any ((select public.fn_email_contas_visiveis('entrada'))::uuid[])
        or (account_id is null and (select public.fn_email_pode('entrada', 'todos')))
        or (
          not coalesce(account_id = any ((select public.fn_email_contas_vinculadas())::uuid[]), false)
          and (select public.fn_email_pode('entrada', 'proprios'))
          and exists (
            select 1 from public.email_envios e
             where e.id = email_recebidos.envio_id
               and e.enviado_por = (select auth.uid())
          )
        )
      )
    )
  );
commit;

-- ----------------------------------------------------------- agendados
begin;
set local lock_timeout = '5s';
alter policy email_agendados_select on public.email_agendados
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (
        account_id = any ((select public.fn_email_contas_visiveis('saida'))::uuid[])
        or (account_id is null and (select public.fn_email_pode('saida', 'todos')))
        or (
          agendado_por = (select auth.uid())
          and not coalesce(account_id = any ((select public.fn_email_contas_vinculadas())::uuid[]), false)
          and (select public.fn_email_pode('saida', 'proprios'))
        )
      )
    )
  );
commit;
