-- Visão 360° do cliente: a equipe da empresa passa a LER os títulos dela.
--
-- Decisão do Alexandre em 25/09/2026: na Visão 360° o financeiro do cliente
-- (boletos, vencimentos, notas) aparece para qualquer pessoa da empresa, não só
-- para o super admin.
--
-- O que muda e o que NÃO muda:
--   * Só LEITURA. Escrita continua só com service_role (não existe policy de
--     insert/update/delete em nenhuma das duas tabelas).
--   * Só a empresa da própria pessoa (current_tenant_id()) e só se ela tiver o
--     módulo ligado em tenants.financeiro_enabled. Empresa sem o módulo segue
--     lendo zero.
--   * As policies antigas (super admin + flag) ficam: policy de SELECT soma com
--     OR, então quem já via continua vendo.
--   * A tela Financeiro (menu) continua só para super admin: quem barra é o
--     FinanceiroGuard, não o banco.
--   * fin_sync_estado entra junto porque vw_fin_titulos_abertos é
--     security_invoker e faz JOIN nela: sem a leitura dela, a view devolve vazio.
--   * As funções fin-titulo-boleto e fin-titulo-documentos leem o título com o
--     token do usuário, então os botões "Boleto" e "Nota / OS" passam a
--     funcionar para a equipe sem mexer nelas.

create policy fin_titulos_select_equipe on public.fin_titulos
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.tenants t
       where t.id = fin_titulos.tenant_id and t.financeiro_enabled is true
    )
  );

create policy fin_sync_estado_select_equipe on public.fin_sync_estado
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.tenants t
       where t.id = fin_sync_estado.tenant_id and t.financeiro_enabled is true
    )
  );
