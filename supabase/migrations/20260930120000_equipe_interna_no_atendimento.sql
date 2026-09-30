-- =============================================================================
-- Equipe DS vira "Equipe interna" e passa para dentro de Atendimento, abaixo de
-- Tickets (pedido do Alexandre em 30/09/2026).
--
-- Só catálogo: a chave `nav.equipe` não muda, então role_permissions e
-- group_permissions continuam valendo sem tocar em nada. Muda onde o item
-- aparece na tela de Permissões, igual ao Chat e aos Tickets (módulo
-- 'atendimento', nível 2).
--
-- O módulo 'equipe' fica vazio e sai, a não ser que alguma empresa já tenha
-- nível configurado para ele (tenant_module_levels tem FK para ele).
-- =============================================================================
begin;

update public.resources
   set module           = 'Equipe interna',
       module_id        = 'atendimento',
       label            = 'Abrir a Equipe interna',
       description      = 'Chat interno da equipe: canais, conversas diretas e grupos.',
       where_it_appears = 'Menu › Atendimento › Equipe interna',
       nivel            = 2
 where key = 'nav.equipe';

delete from public.permission_modules m
 where m.id = 'equipe'
   and not exists (select 1 from public.resources r where r.module_id = m.id)
   and not exists (select 1 from public.tenant_module_levels t where t.module_id = m.id);

commit;
