-- ============================================================================
-- RBAC v2 — quais AÇÕES e qual ESCOPO cada recurso aceita
--
-- Sem isto a tela mostra "Ver" para tudo e "Quais linhas: Todas" para tudo,
-- inclusive onde nenhuma das duas coisas faz sentido:
--   · "Exportar lista" nao tem inserir/editar/excluir — exportar E a acao.
--   · "Cancelar cliente" tambem nao: o recurso E o botao.
--   · "Percentuais" nao tem escopo de linha: e um ajuste unico do tenant.
-- E faltava o principal: em "Clientes", o inserir/alterar/excluir do cadastro.
-- ============================================================================
begin;

alter table public.resources
  add column if not exists acoes text[] not null default '{view}',
  add column if not exists escopo_aplicavel boolean not null default false,
  add column if not exists escopos_validos text[] not null default '{todos}';

comment on column public.resources.acoes is
  'Acoes que fazem sentido para este recurso. Recurso que JA E uma acao (exportar, cancelar) tem apenas {view}: ligado = pode fazer.';
comment on column public.resources.escopo_aplicavel is
  'Se o recurso admite escopo de linha. So vale no nivel 3 e so onde existe coluna para filtrar.';

-- ------------------------------------------------- cadastros: CRUD completo
update public.resources set acoes = '{view,insert,update,delete}'
 where key in (
   'clientes','clientes.contratos','clientes.contatos','clientes.filiais',
   'tickets','atend.macros','base_conhecimento','cfg.kb',
   'cfg.produtos','cfg.fornecedores','cfg.modelos_contrato','cfg.origens_venda',
   'cfg.formas_pagamento','cfg.setores','cfg.funcionarios','cfg.tickets_config',
   'cfg.categorias_servico','cfg.tipos_servico','cfg.segmentos','cfg.areas_atuacao',
   'cfg.unidades_base','cfg.motivos_cancelamento','cfg.motivos_pausa',
   'cfg.despesas_cac','cfg.percentuais',
   'onb.cfg.pipelines','onb.cfg.checklists','onb.cfg.papeis','onb.cfg.motivos','onb.cfg.templates',
   'clientes.modulos','usuarios_convites'
 );

-- Editar sem poder excluir e um caso real: quem corrige cadastro nao apaga.
update public.resources set acoes = '{view,update}'
 where key in ('clientes.financeiro','clientes.custos','cfg.geral','cfg.notificacoes',
               'cfg.seguranca','cfg.acessos','cfg.permissoes','ia_configuracoes',
               'cfg.ia','cfg.distribuicao','cfg.operacao','cfg.horario_plantao',
               'cfg.canais','cfg.email','whatsapp_instancias','parametros_atendimento',
               'cfg.integracoes_omie','cfg.integracoes_hiper','usuarios_roles',
               'onb.cfg.distribuicao','dash.meu_painel','meu_painel');

-- ------------------------------------------------------- escopo de linha
-- Só onde existe coluna para filtrar. `unidade` ja roda em producao em 5 tabelas.
update public.resources
   set escopo_aplicavel = true,
       escopos_validos  = '{nenhum,unidade,todos}'
 where key in ('clientes','clientes.ficha','clientes.contratos','clientes.financeiro',
               'cs.painel','certificados','dash.visao_geral','dash.crescimento',
               'dash.cancelamentos','dash.vendas','dash.cs','fin.mrr','onb.dashboard');

update public.resources
   set escopo_aplicavel = true,
       escopos_validos  = '{nenhum,proprio,setor,todos}'
 where key in ('atendimento_chat','atend.historico_terceiros','atd.agentes','atd.satisfacao');

update public.resources
   set escopo_aplicavel = true,
       escopos_validos  = '{nenhum,proprio,setor,unidade,todos}'
 where key in ('tickets','onb.quadro');

-- --------------------------------------------------------- hierarquia (1)
-- `clientes.exportar` nao tinha pai: aparecia no mesmo nivel de "Clientes" e
-- fazia os filhos seguintes parecerem pendurados nele.
update public.resources set parent_key = 'clientes'
 where key in ('clientes.exportar','clientes.ficha','clientes.contratos','clientes.financeiro',
               'clientes.cancelar','clientes.reativar','clientes.reajuste','clientes.purge',
               'clientes.historico','clientes.filiais','clientes.contatos');

update public.resources set parent_key = 'tickets'
 where key like 'tickets.%';

update public.resources set parent_key = 'atendimento_chat'
 where key like 'atend.%' and parent_key is null;

update public.resources set parent_key = 'onb.quadro'
 where key in ('onb.mover','onb.criar_jornada','onb.editar_jornada','onb.golive',
               'onb.cancelar','onb.reabrir','onb.transferir','onb.treinos');

update public.resources set parent_key = 'atd.tempo_real'
 where module_id = 'atendimento_dash' and key <> 'atd.tempo_real';

update public.resources set parent_key = 'dash.visao_geral'
 where module_id = 'dashboard' and key not in ('dash.visao_geral','dash.valores_financeiros');

-- ----------------------------------------------------- gravar o escopo
create or replace function public.rbac_set_group_scope(
  p_group_id uuid, p_resource_key text, p_escopo text)
returns jsonb language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid; v_base text; v_uid uuid := auth.uid(); v_validos text[]; v_old text;
begin
  select tenant_id, nivel_base into v_tenant, v_base
    from public.permission_groups where id = p_group_id;
  if v_tenant is null then raise exception 'Grupo inexistente'; end if;
  perform public.rbac_assert_admin(v_tenant);

  select escopos_validos into v_validos from public.resources where key = p_resource_key;
  if v_validos is null then raise exception 'Recurso inexistente'; end if;
  if not (p_escopo = any(v_validos)) then
    raise exception 'Escopo "%" nao vale para este recurso. Validos: %', p_escopo, array_to_string(v_validos, ', ');
  end if;

  select escopo into v_old from public.group_permissions
   where group_id = p_group_id and resource_key = p_resource_key;

  insert into public.group_permissions (group_id, resource_key, escopo, updated_by)
  values (p_group_id, p_resource_key, p_escopo, v_uid)
  on conflict (group_id, resource_key) do update
    set escopo = excluded.escopo, updated_at = now(), updated_by = v_uid;

  insert into public.permission_audit
    (tenant_id, role, group_id, resource_key, action, escopo_old, escopo_new, changed_by)
  values (v_tenant, v_base, p_group_id, p_resource_key, 'escopo', v_old, p_escopo, v_uid);

  return jsonb_build_object('status','ok','escopo',p_escopo);
end $$;

revoke all on function public.rbac_set_group_scope(uuid,text,text) from public;
grant execute on function public.rbac_set_group_scope(uuid,text,text) to authenticated, service_role;

commit;
