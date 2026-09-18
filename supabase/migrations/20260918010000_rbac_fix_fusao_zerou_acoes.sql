-- ============================================================================
-- CORREÇÃO — a fusão de duplicatas zerou INSERIR / EDITAR / EXCLUIR
--
-- SINTOMA REAL, em produção, no piloto da ASP (18/09/2026): o administrador
-- abriu a ficha de um cliente, trocou o telefone, clicou em Salvar e recebeu
-- "Você não tem acesso a esta ação. Entre em contato com o administrador."
--
-- CAUSA: a migration da taxonomia (20260914140000) funde as duplicatas
-- `nav.clientes` → `clientes` e `nav.tickets` → `tickets` aplicando E-LÓGICO
-- nas QUATRO ações:
--     can_update = gp.can_update and coalesce(m.can_update, false)
-- Só que chave de MENU não tem ação: `nav.clientes` nasce com inserir, editar
-- e excluir em `false`, porque menu só se abre. O E zerou as três ações na
-- chave sobrevivente, para TODOS os grupos.
--
-- Medido antes de corrigir: 20 grupos em 10 empresas com `editar` em `false`
-- enquanto a realidade (ajuste da empresa, senão padrão global) dizia `true`.
-- O botão Salvar da ficha é protegido por `clientes` na ação `update`
-- (src/pages/ClienteForm.tsx:1104) — daí o aviso.
--
-- A REGRA DA FUSÃO ESTAVA CERTA NO ENUNCIADO E ERRADA NA APLICAÇÃO: "chave que
-- morre COM portão → vale o E" só faz sentido para a AÇÃO que a chave morta de
-- fato controlava. `nav.clientes` nunca controlou edição de cadastro; o valor
-- dela nessas três ações nunca teve efeito, e valor sem efeito se DESCARTA.
--
-- Esta correção só SOBE de false para true, e só onde a realidade diz true.
-- Grupo com edição manual registrada em `permission_audit` fica intacto.
-- ============================================================================
begin;

update public.group_permissions gp
   set can_view   = case when gp.can_view   then true else coalesce(
                      (select trp.can_view from public.tenant_role_permissions trp
                        where trp.tenant_id=g.tenant_id and trp.role=g.nivel_base and trp.resource_key=gp.resource_key),
                      (select rp.can_view from public.role_permissions rp
                        where rp.role=g.nivel_base and rp.resource_key=gp.resource_key), false) end,
       can_insert = case when gp.can_insert then true else coalesce(
                      (select trp.can_insert from public.tenant_role_permissions trp
                        where trp.tenant_id=g.tenant_id and trp.role=g.nivel_base and trp.resource_key=gp.resource_key),
                      (select rp.can_insert from public.role_permissions rp
                        where rp.role=g.nivel_base and rp.resource_key=gp.resource_key), false) end,
       can_update = case when gp.can_update then true else coalesce(
                      (select trp.can_update from public.tenant_role_permissions trp
                        where trp.tenant_id=g.tenant_id and trp.role=g.nivel_base and trp.resource_key=gp.resource_key),
                      (select rp.can_update from public.role_permissions rp
                        where rp.role=g.nivel_base and rp.resource_key=gp.resource_key), false) end,
       can_delete = case when gp.can_delete then true else coalesce(
                      (select trp.can_delete from public.tenant_role_permissions trp
                        where trp.tenant_id=g.tenant_id and trp.role=g.nivel_base and trp.resource_key=gp.resource_key),
                      (select rp.can_delete from public.role_permissions rp
                        where rp.role=g.nivel_base and rp.resource_key=gp.resource_key), false) end,
       updated_at = now()
  from public.permission_groups g
 where g.id = gp.group_id
   and gp.resource_key in ('clientes','tickets')
   and not exists (select 1 from public.permission_audit pa
                    where pa.group_id = gp.group_id and pa.resource_key = gp.resource_key
                      and pa.changed_by is not null);

commit;
