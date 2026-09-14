-- ============================================================================
-- RBAC v2 — SEMEADURA DO CATÁLOGO NOVO
--
-- Sem isto, os 81 recursos novos nasceriam NEGADOS para todo mundo: eles não
-- têm linha em lugar nenhum e a cadeia termina em `false`. É a armadilha R12
-- do plano — "recurso novo cai no padrão global, que libera 9 de 66 ao user".
--
-- A regra da governança: recurso novo espelha o acesso que a pessoa TEM HOJE.
-- Como nenhum deles tem portão no código, o acesso de hoje é o do item que dá
-- acesso à tela onde ele mora (a âncora).
-- ============================================================================
begin;

create temp table ancora(key text primary key, ancora_key text) on commit drop;

insert into ancora(key, ancora_key)
select r.key,
  coalesce(
    r.parent_key,
    case r.module_id
      when 'dashboard'        then 'nav.dashboard'
      when 'atendimento_dash' then 'nav.atendimento_dashboard'
      when 'clientes'         then 'nav.clientes'
      when 'financeiro'       then 'nav.dashboard'
      when 'atendimento'      then 'nav.chat'
      when 'tickets'          then 'nav.tickets'
      when 'onboarding'       then 'nav.dashboard'
      when 'equipe'           then 'cfg.acessos'
      when 'super'            then null            -- super admin e bypass; ninguem recebe
      when 'menu'             then case r.key
                                     when 'nav.whatsapp_contatos' then 'nav.chat'
                                     when 'nav.meu_painel'        then 'nav.dashboard'
                                     when 'nav.cadastros'         then 'nav.configuracoes'
                                     when 'nav.onboarding'        then 'nav.dashboard'
                                     else null end
      else case r.key
             when 'cs.painel'    then 'nav.customer_success'
             when 'certificados' then 'nav.certificados_a1'
             when 'painel_uso'   then 'nav.painel_uso'
             when 'meu_painel'   then 'nav.dashboard'
             else 'nav.configuracoes' end
    end)
from public.resources r
-- ⚠️ O filtro correto e "o sistema ainda NAO fala deste recurso em lugar nenhum".
-- A primeira versao filtrava por "nao tem regra de grupo", e isso vazou: recursos
-- que ja existiam e eram respondidos pelo padrao global (clientes.modulos,
-- clientes.oem_aprovacao, cfg.email, cfg.integracoes_hiper) foram semeados a
-- partir da ancora e passaram de negado para liberado em 42 usuarios.
-- Se `role_permissions` ja tem linha, a cadeia ja responde: nao semear.
where not exists (select 1 from public.role_permissions rp where rp.resource_key = r.key)
  and r.key <> 'nav.super';

-- Valor efetivo da âncora para cada grupo, pela mesma cadeia do motor.
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, a.key,
       coalesce(gp.can_view, trp.can_view, rp.can_view, false),
       false, false, false
from public.permission_groups g
join ancora a on a.ancora_key is not null
left join public.group_permissions gp
  on gp.group_id = g.id and gp.resource_key = a.ancora_key
left join public.tenant_role_permissions trp
  on trp.tenant_id = g.tenant_id and trp.role = g.nivel_base and trp.resource_key = a.ancora_key
left join public.role_permissions rp
  on rp.role = g.nivel_base and rp.resource_key = a.ancora_key
on conflict (group_id, resource_key) do nothing;

-- Recursos sem âncora (nav.super e os de super admin) ficam negados de propósito:
-- quem precisa deles passa por `is_super_admin`, que ignora o RBAC (decisão D4).
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, r.key, false, false, false, false
from public.permission_groups g
cross join public.resources r
where r.module_id = 'super' or r.key = 'nav.super'
on conflict (group_id, resource_key) do nothing;

commit;
