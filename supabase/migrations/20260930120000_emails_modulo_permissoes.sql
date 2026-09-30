-- =============================================================================
-- E-mails — volta para a tela de Permissões, como módulo próprio.
--
-- Pedido de cliente (DELVALE, 30/09/2026): "como libero o acesso aos e-mails para
-- os operadores? Não achei em Permissões e perfis."
--
-- Causa: `nav.emails` foi escondida em 14/09 (`20260914170000`, "feature em
-- construção: some da tela até a rota existir"). A tela foi publicada e ninguém
-- desfez o `hidden`. Antes disso, em 15/09, o admin da DELVALE desligou E-mails
-- para Gestor e Operador na tela antiga — e desde então não tinha como religar.
--
-- O que muda: só o CATÁLOGO. Nenhum valor de permissão é tocado — o "não" da
-- DELVALE foi decisão do admin deles (permission_audit 224 e 226) e continua
-- valendo até ele mesmo religar na tela.
--
-- Módulo próprio porque a regra da tela é "módulo = item do menu lateral", e
-- E-mails é item do menu. Ordem 65: entre Certificados A1 (60) e Painel de Uso
-- (70), a mesma posição do menu.
-- =============================================================================

insert into public.permission_modules (id, nome, descricao, ordem)
values ('emails', 'E-mails', 'E-mails enviados e recebidos dos clientes.', 65)
on conflict (id) do nothing;

insert into public.tenant_module_levels (tenant_id, module_id, nivel)
select t.id, 'emails', 1 from public.tenants t
on conflict do nothing;

update public.resources
   set module_id        = 'emails',
       hidden           = false,
       label            = 'Abrir E-mails',
       where_it_appears = 'Menu › E-mails',
       grupo            = null,
       secao            = 'entrada',
       parent_key       = null
 where key = 'nav.emails';
