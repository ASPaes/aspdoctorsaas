-- ============================================================================
-- RBAC — semeadura das 28 permissões. Parte 2 de 2: o valor por GRUPO.
--
-- As 42 linhas de grupo já existem (semeadura por âncora), então
-- `on conflict do nothing` não conserta nada — é preciso ALINHAR o valor, nos
-- DOIS sentidos, porque o valor morto erra para os dois lados:
--   · 680 linhas sobem para SIM  (hoje todo mundo pode)
--   ·  12 linhas descem para NÃO (hoje é só admin) — deixá-las em `true` daria
--     acesso NOVO no dia da publicação: 14 operadores da Digi Office veriam a
--     aba Meu Painel e 21 gestores em 11 empresas veriam o Histórico de
--     alterações de acessos.
--
-- Guarda: só mexe em linha que NINGUÉM editou à mão (`permission_audit` sem
-- `changed_by`). Escolha de admin não se desfaz por migration. Conferido antes
-- de aplicar: 0 linhas protegidas entre as que mudariam.
--
-- Conferido depois de aplicar, com foto de acesso das 123 pessoas: o diff tem
-- exatamente estas duas perdas e nenhuma outra.
-- ============================================================================
create temporary table _chaves_semeadas on commit drop as
select unnest(array[
  'nav.onboarding','onb.mover','onb.criar_jornada','onb.cancelar','onb.reabrir',
  'onb.transferir','onb.treinos','onb.dashboard','onb.cfg.jornadas','onb.cfg.pipelines',
  'onb.cfg.checklists','onb.cfg.distribuicao','onb.cfg.motivos','onb.cfg.demandas',
  'onb.cfg.tipos_treino','onb.cfg.papeis','onb.cfg.retornos','onb.cfg.contabilidade',
  'onb.cfg.indicadores','fin.bridge','atend.macros','usuarios.desativar',
  'certificados.dashboard','dash.meu_painel','onb.editar_jornada','onb.cfg.templates',
  'onb.golive','usuarios.auditoria'
]) as key;

-- Onde faltar linha de grupo, cria com o valor do papel base.
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, rp.resource_key,
       coalesce(trp.can_view, rp.can_view, false), false, false, false
  from public.permission_groups g
  join public.role_permissions rp
    on rp.role = g.nivel_base
   and rp.resource_key in (select key from _chaves_semeadas)
  left join public.tenant_role_permissions trp
    on trp.tenant_id = g.tenant_id and trp.role = g.nivel_base and trp.resource_key = rp.resource_key
on conflict (group_id, resource_key) do nothing;

-- Alinha o que já existe ao valor de HOJE (ajuste da empresa, senão global).
-- O `coalesce` se repete porque o UPDATE não pode referenciar `gp` numa LATERAL
-- do FROM ("invalid reference to FROM-clause entry"). É o mesmo desenho da
-- semeadura de 18/09.
update public.group_permissions gp
   set can_view = coalesce(
        (select trp.can_view from public.tenant_role_permissions trp
          where trp.tenant_id = g.tenant_id and trp.role = g.nivel_base
            and trp.resource_key = gp.resource_key),
        (select rp.can_view from public.role_permissions rp
          where rp.role = g.nivel_base and rp.resource_key = gp.resource_key),
        false),
       updated_at = now()
  from public.permission_groups g
 where g.id = gp.group_id
   and gp.resource_key in (select key from _chaves_semeadas)
   and gp.can_view is distinct from coalesce(
        (select trp.can_view from public.tenant_role_permissions trp
          where trp.tenant_id = g.tenant_id and trp.role = g.nivel_base
            and trp.resource_key = gp.resource_key),
        (select rp.can_view from public.role_permissions rp
          where rp.role = g.nivel_base and rp.resource_key = gp.resource_key),
        false)
   and not exists (select 1 from public.permission_audit pa
                    where pa.group_id = gp.group_id and pa.resource_key = gp.resource_key
                      and pa.changed_by is not null);
