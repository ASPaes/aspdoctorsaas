-- =============================================================================
-- Financeiro — módulo e item de menu no catálogo de permissões.
--
-- Arquivo separado da migration das tabelas de propósito: `resources` é catálogo
-- quente (a tela de permissões lê dela) e misturar catálogo com DDL de tabela na
-- mesma transação já causou deadlock neste projeto.
--
-- ⚠️ CORRIGIDO EM 22/09/2026, DEPOIS DE FALHAR EM PRODUÇÃO. A primeira versão
-- deste arquivo foi escrita contra o banco LOCAL, que está atrás da produção, e
-- quebrou com `null value in column "module_id"`. O `resources` de produção tem
-- 6 colunas que o local não tem: `module_id` (NOT NULL, FK para
-- `permission_modules`), `nivel`, `acoes`, `secao`, `grupo`, `grupo_ordem`.
-- Antes de escrever migration para tabela de catálogo, leia o schema de
-- PRODUÇÃO, não o do container.
--
-- `hidden = true` enquanto o módulo está em desenvolvimento: a permissão existe
-- e o super admin enxerga a tela, mas o item não aparece na tela de Permissões
-- por Papel para os tenants. Virar `false` no dia da liberação.
-- =============================================================================

-- O módulo precisa existir antes do item: `resources.module_id` é FK.
-- Ordem 75: entre "Painel de Uso" (70) e "Configurações" (80).
insert into public.permission_modules (id, nome, descricao, ordem)
values ('financeiro', 'Financeiro', 'Títulos a receber, cobrança e régua de cobrança.', 75)
on conflict (id) do nothing;

insert into public.resources (
  key, module, module_id, label, description,
  display_order, hidden, is_navigation, where_it_appears,
  nivel, acoes, secao
)
values (
  'nav.financeiro',
  'Menu Principal',
  'financeiro',
  'Financeiro',
  'Títulos a receber, painel de cobrança e régua de cobrança.',
  1,
  true,
  true,
  'Menu lateral › Financeiro',
  1,
  '{view}',
  -- 'entrada' é o que as outras entradas de menu usam (nav.emails, nav.painel_uso).
  'entrada'
)
on conflict (key) do nothing;
