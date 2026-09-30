-- =============================================================================
-- E-mails — as ações de dentro da tela viram permissão (1/3: catálogo)
--
-- Pedido do Alexandre, 30/09/2026: o módulo E-mails em Permissões e perfis só
-- tinha "Abrir E-mails". Tudo o que a tela faz de diferente por papel estava
-- embutido como "admin" ou "admin ou gestor", na tela e no banco. Cada um vira
-- uma permissão com o nome do que acontece na tela:
--
--   chave                     nível  hoje (semeadura)   trava no banco
--   email.ver_todos             2    admin, gestor      RLS de envios/recebidos/agendados
--                                                       + arquivar, mover p/ pasta, marcar lido
--   email.lixeira               2    admin              fn_email_envios_lixeira / _recebidos_
--   email.triagem               2    admin, gestor      fn_email_triagem_resolver
--   email.ler_agora             3    admin              edge function ler-emails-recebidos
--   email.macros                3    admin, gestor      RLS de email_macros, anexos e bucket
--   email.agendados_outros      3    admin, gestor      fn_email_agendado_acao
--
-- SEMEADURA = O ACESSO DE HOJE. Simulado em produção antes de escrever, por
-- (pessoa, chave): papel de hoje × grupo → 0 pessoas mudam. As duas tabelas
-- recebem linha ([[aba-nova-de-config-precisa-de-role-permissions]]): sem a de
-- papel, usuário sem grupo e grupo criado depois cairiam em `false`.
--
-- parent_key fica NULO de propósito: com "Abrir E-mails" como pai, desligar o
-- menu desligaria em cascata "Ver e-mails de todas as pessoas", e o gestor
-- deixaria de ver os e-mails dos outros também no ticket e no chat — efeito que
-- ninguém pediria ao esconder um item de menu.
--
-- Fica de fora, no papel: pastas de setor (quem cria pasta em qualquer setor)
-- e a tela de estado da leitura das caixas.
-- =============================================================================

-- ------------------------------------------------ a regra, num lugar só
-- Mesmo desenho de `pode_ver_todos_setores()`, só que genérico:
--   · super admin                        -> pode
--   · empresa SEM sistema de permissões  -> papel de hoje (has_perm devolveria
--     TRUE para tudo ali e daria acesso que ninguém pediu)
--   · chamada em nome de alguém (doctorsaas.acting_user, sem JWT) -> papel de
--     hoje: has_perm só enxerga auth.uid()
--   · senão                              -> has_perm
begin;

create or replace function public.rbac_pode(
  p_chave text,
  p_papeis_de_hoje text[],
  p_acao text default 'view'
)
returns boolean
language plpgsql
stable parallel safe security definer
set search_path = 'public', 'pg_catalog'
as $$
declare
  v_uid    uuid := coalesce(auth.uid(), nullif(current_setting('doctorsaas.acting_user', true), '')::uuid);
  v_role   text;
  v_super  boolean;
  v_tenant uuid;
  v_rbac   boolean;
begin
  if v_uid is null then return false; end if;

  select p.role, p.is_super_admin, p.tenant_id into v_role, v_super, v_tenant
    from public.profiles p where p.user_id = v_uid limit 1;
  if coalesce(v_super, false) then return true; end if;
  if v_role is null or v_tenant is null then return false; end if;

  select t.rbac_enabled into v_rbac from public.tenants t where t.id = v_tenant limit 1;
  if not coalesce(v_rbac, false) or auth.uid() is null then
    return v_role = any(p_papeis_de_hoje);
  end if;

  return public.has_perm(p_chave, p_acao);
end $$;

revoke all on function public.rbac_pode(text, text[], text) from public, anon;
grant execute on function public.rbac_pode(text, text[], text) to authenticated, service_role;

commit;

-- ------------------------------------------------------------- os itens
-- `resources` é catálogo quente: transação própria, sem DDL de tabela junto.
begin;

insert into public.resources
  (key, module, module_id, label, description, where_it_appears, parent_key,
   display_order, is_navigation, hidden, nivel, acoes, secao, grupo, grupo_ordem)
values
  ('email.ver_todos', 'E-mails', 'emails', 'Ver e-mails de todas as pessoas',
   'Sem isto, a pessoa só vê os e-mails que ela enviou e as respostas a eles. Vale na tela de E-mails, no ticket e no chat.',
   'E-mails › Enviados e Recebidos', null, 2, false, false, 2, '{view}', 'aba', 'Caixa de e-mails', 10),
  ('email.lixeira', 'E-mails', 'emails', 'Lixeira de e-mails',
   'Mandar para a lixeira, restaurar e excluir de vez. E-mail ligado a atendimento ou ticket nunca sai.',
   'E-mails › Lixeira', null, 3, false, false, 2, '{view}', 'acao', 'Caixa de e-mails', 10),
  ('email.triagem', 'E-mails', 'emails', 'Resolver a triagem',
   'Nos Recebidos que caíram na triagem: abrir o ticket escolhendo o cliente, ou ignorar.',
   'E-mails › Recebidos › Triagem', null, 4, false, false, 2, '{view}', 'acao', 'Caixa de e-mails', 10),
  ('email.ler_agora', 'E-mails', 'emails', 'Ler a caixa agora',
   'Botão Ler agora: busca os e-mails novos sem esperar a próxima leitura automática.',
   'E-mails › Recebidos › Ler agora', null, 5, false, false, 3, '{view}', 'acao', 'Caixa de e-mails', 10),
  ('email.macros', 'E-mails', 'emails', 'Cadastrar macros de e-mail',
   'Criar, editar e apagar macros, no botão Macros e em Configurações › E-mail › Macros. Quem tem também vê as macros de todos os setores.',
   'Enviar e-mail › Macros', null, 6, false, false, 3, '{view}', 'acao', 'Escrever e-mail', 20),
  ('email.agendados_outros', 'E-mails', 'emails', 'Mexer no agendamento de outra pessoa',
   'Reagendar, enviar agora ou cancelar um e-mail que outra pessoa agendou. No próprio agendamento, cada um sempre mexe.',
   'E-mails › Agendados', null, 7, false, false, 3, '{view}', 'acao', 'Escrever e-mail', 20)
on conflict (key) do nothing;

-- motor por papel (e fim da cascata para quem não tem grupo)
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select r.role, k.chave, r.role = any(k.papeis), false, false, false
  from (values ('admin'), ('head'), ('user')) r(role)
 cross join (values
   ('email.ver_todos',        array['admin','head']),
   ('email.lixeira',          array['admin']),
   ('email.triagem',          array['admin','head']),
   ('email.ler_agora',        array['admin']),
   ('email.macros',           array['admin','head']),
   ('email.agendados_outros', array['admin','head'])
 ) k(chave, papeis)
on conflict (role, resource_key) do nothing;

-- motor v2: o grupo carrega o nível base, que é o papel de ontem
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, k.chave, g.nivel_base = any(k.papeis), false, false, false
  from public.permission_groups g
 cross join (values
   ('email.ver_todos',        array['admin','head']),
   ('email.lixeira',          array['admin']),
   ('email.triagem',          array['admin','head']),
   ('email.ler_agora',        array['admin']),
   ('email.macros',           array['admin','head']),
   ('email.agendados_outros', array['admin','head'])
 ) k(chave, papeis)
on conflict (group_id, resource_key) do nothing;

commit;
