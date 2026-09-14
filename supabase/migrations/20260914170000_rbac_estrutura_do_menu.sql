-- ============================================================================
-- ESTRUTURA DO MENU — módulo = item do menu lateral; grupo = sub-item daquele
-- menu ou aba daquela tela. Se está no menu assim, está na tela de permissões
-- assim, e toda funcionalidade nova segue a mesma regra.
--
-- Por que: "Financeiro", "Equipe", "Integrações", "Dados", "Tickets" e
-- "Dashboard de Atendimento" eram módulos soltos que não existem no menu.
-- Percentuais e Despesas CAC moram em Configurações; a Ponte de MRR mora dentro
-- da aba Crescimento; Movimentos MRR e Reajustes são abas da lista de Clientes.
--
-- Correções de catálogo feitas contra o código (14/09/2026):
--  · "Reativar cliente" não existe em tela nenhuma (reativar_cliente não é
--    chamada pelo frontend) — sai.
--  · "Histórico de acessos" não fica na ficha do cliente: é o histórico de
--    PERMISSÕES, em Configurações › Equipe, duplicata de usuarios.auditoria — sai.
--  · A aba OEM das Integrações usava a permissão do Omie: liberar um liberava o
--    outro. Ganha chave própria, semeada com o valor do Omie.
--  · A configuração de Implantação tem 10 abas reais; checklist e template
--    ficam DENTRO de Pipelines & Etapas.
--  · A ficha tem seções que não estavam no catálogo: Dados Cadastrais, Produto /
--    Contrato, Avisos e Bloqueios, Tickets e Integração.
--
-- MRR: "Receita e MRR" não era tela, era uma trava sobre movimentos_mrr — e 9
-- lugares leem essa tabela direto. Os 5 operadores ativos do ASP abriam Clientes
-- e a aba Financeiro e recebiam o MRR vazio, sem aviso. Agora o banco libera o
-- MRR para quem pode abrir Clientes ou o Dashboard, as duas portas das telas que
-- mostram MRR.
-- ============================================================================
begin;

alter table public.resources
  add column if not exists grupo text,
  add column if not exists grupo_ordem smallint not null default 50;

comment on column public.resources.grupo is
  'Sub-item do menu (ou aba da tela) dentro do módulo. Módulo = item do menu lateral.';

-- ================================================================ MÓDULOS
insert into public.permission_modules (id, nome, descricao, ordem) values
  ('customer_success','Customer Success','Saúde e risco da carteira.',40),
  ('certificados',    'Certificados A1', 'Certificados digitais dos clientes.',60),
  ('painel_uso',      'Painel de Uso',   'Consumo da plataforma pela empresa.',70)
on conflict (id) do nothing;

update public.permission_modules set nome='Dashboard',     ordem=10, descricao='Indicadores do negócio, incluindo faturamento.' where id='dashboard';
update public.permission_modules set nome='Clientes',      ordem=20, descricao='A lista de clientes e a ficha de cada um.' where id='clientes';
update public.permission_modules set nome='Atendimento',   ordem=30, descricao='Dashboard de atendimento, Chat e Tickets.' where id='atendimento';
update public.permission_modules set nome='Implantação',   ordem=50, descricao='Kanban, dashboard e configuração das jornadas.' where id='onboarding';
update public.permission_modules set nome='Configurações', ordem=80, descricao='Na mesma divisão da barra lateral de Configurações.' where id='configuracoes';
update public.permission_modules set nome='Super Admin',   ordem=90, descricao='Visão entre empresas. Só super admin chega aqui, independentemente do grupo.' where id='super';

insert into public.tenant_module_levels (tenant_id, module_id, nivel)
select t.id, m.id, 1 from public.tenants t cross join public.permission_modules m
where m.id in ('customer_success','certificados','painel_uso')
on conflict do nothing;

-- Nível que o admin já escolheu não se perde ao juntar módulos: vale o maior.
update public.tenant_module_levels l set nivel = x.n
  from (select tenant_id, max(nivel) n from public.tenant_module_levels
         where module_id in ('atendimento','atendimento_dash','tickets') group by tenant_id) x
 where l.tenant_id = x.tenant_id and l.module_id = 'atendimento';
update public.tenant_module_levels l set nivel = x.n
  from (select tenant_id, max(nivel) n from public.tenant_module_levels
         where module_id in ('configuracoes','financeiro','equipe','integracoes','dados') group by tenant_id) x
 where l.tenant_id = x.tenant_id and l.module_id = 'configuracoes';

-- ==================================================================== MRR
drop policy if exists rbac_mrr_select on public.movimentos_mrr;
create policy rbac_mrr_select on public.movimentos_mrr
  as restrictive for select to authenticated
  using ((select public.has_perm('clientes','view')) or (select public.has_perm('nav.dashboard','view')));

delete from public.resources where key in ('fin.mrr','clientes.reativar','clientes.historico');

-- ======================================================= RECURSOS NOVOS
insert into public.resources
  (key, module, module_id, label, description, where_it_appears, parent_key, display_order,
   is_navigation, hidden, nivel, secao, acoes)
select v.key, m.nome, v.module_id, v.label, v.descr, v.caminho, v.pai, v.ordem,
       false, false, v.nivel, v.secao, v.acoes::text[]
from (values
 ('clientes.divergencias_hiper','clientes','Aba Divergências Hiper','Diferenças entre a carteira do PortalHiper e o cadastro. Só aparece para empresa com Hiper.','Clientes › Divergências Hiper','clientes',104,3,'aba','{view,update}'),
 ('clientes.cadastro_incompleto','clientes','Aba Cadastro incompleto','Clientes com campo obrigatório faltando. Só aparece quando há pendência.','Clientes › Cadastro incompleto','clientes',105,3,'aba','{view,update}'),
 ('clientes.dados','clientes','Dados cadastrais','Nome, documento, endereço e responsáveis do cliente.','Ficha do cliente › Dados Cadastrais','clientes.ficha',111,3,'aba','{view,update}'),
 ('clientes.venda_produto','clientes','Produto e contrato','O que o cliente comprou e em que condições.','Ficha do cliente › Produto / Contrato','clientes.ficha',112,3,'aba','{view}'),
 ('clientes.parametros_atendimento','clientes','Avisos e bloqueios','Avisos que aparecem no atendimento e bloqueios deste cliente.','Ficha do cliente › Avisos e Bloqueios','clientes.ficha',116,3,'aba','{view,update}'),
 ('clientes.tickets','clientes','Tickets do cliente','Chamados abertos para este cliente.','Ficha do cliente › Tickets','clientes.ficha',117,3,'aba','{view}'),
 ('clientes.integracao','clientes','Integração','Vínculos do cliente com Hiper, OEM e acesso remoto.','Ficha do cliente › Integração','clientes.ficha',121,3,'aba','{view,update}'),
 ('onb.cfg.jornadas','onboarding','Aba Jornadas','Tipos de jornada da empresa.','Implantação › Configuração › Jornadas',null,480,3,'config','{view,insert,update,delete}'),
 ('onb.cfg.demandas','onboarding','Aba Tipos de demanda','Tipos de demanda que abrem ticket de implantação.','Implantação › Configuração › Tipos de demanda',null,484,3,'config','{view,insert,update,delete}'),
 ('onb.cfg.tipos_treino','onboarding','Aba Tipos de treino','Treinos que podem ser agendados na jornada.','Implantação › Configuração › Tipos de treino',null,485,3,'config','{view,insert,update,delete}'),
 ('onb.cfg.retornos','onboarding','Aba Retorno ao vendedor','Motivos para devolver a implantação ao vendedor.','Implantação › Configuração › Retorno ao vendedor',null,487,3,'config','{view,insert,update,delete}'),
 ('onb.cfg.contabilidade','onboarding','Aba Dados da contabilidade','Informações da contabilidade pedidas na implantação.','Implantação › Configuração › Dados da contabilidade',null,488,3,'config','{view,update}'),
 ('onb.cfg.indicadores','onboarding','Aba Indicadores','Metas e indicadores do painel de implantação.','Implantação › Configuração › Indicadores',null,489,3,'config','{view,update}'),
 ('certificados.dashboard','certificados','Aba Dashboard','Vencimentos e situação dos certificados.','Certificados A1 › Dashboard','nav.certificados_a1',2,3,'aba','{view}'),
 ('cfg.integracoes_oem','configuracoes','OEM','Licenças do PDV Legal/TabletCloud: vínculo com clientes, custo e divergências.','Configurações › Integrações › OEM',null,902,1,'config','{view,update}')
) as v(key, module_id, label, descr, caminho, pai, ordem, nivel, secao, acoes)
join public.permission_modules m on m.id = v.module_id
on conflict (key) do nothing;

-- ================================================================ DASHBOARD
update public.resources set module_id='dashboard', grupo=null, secao='entrada', parent_key=null,
       label='Abrir o Dashboard', where_it_appears='Menu › Dashboard' where key='nav.dashboard';
update public.resources set grupo='Abas', grupo_ordem=10
 where module_id='dashboard' and key not in ('nav.dashboard','dash.valores_financeiros');
update public.resources set module_id='dashboard', grupo='Abas', grupo_ordem=10, secao='aba',
       parent_key='dash.crescimento', label='Ponte de MRR',
       where_it_appears='Dashboard › Crescimento › Ponte de MRR',
       display_order=(select display_order from public.resources where key='dash.crescimento')
 where key='fin.bridge';
update public.resources set where_it_appears='Dashboard › Diagnóstico executivo › Conselho DS' where key='dashboard_conselho';
update public.resources set grupo='Vale em todo o Dashboard', grupo_ordem=90 where key='dash.valores_financeiros';

-- ================================================================= CLIENTES
update public.resources set label='Abrir Clientes', grupo=null, secao='entrada', parent_key=null,
       where_it_appears='Menu › Clientes' where key='clientes';

update public.resources set grupo='Abas da lista', grupo_ordem=10, parent_key='clientes'
 where key in ('clientes.exportar','fin.movimentos','clientes.reajuste','clientes.divergencias_hiper',
               'clientes.cadastro_incompleto','clientes.oem_aprovacao');
update public.resources set label='Exportar a lista', secao='acao', display_order=101,
       where_it_appears='Clientes › botão Exportar XLSX' where key='clientes.exportar';
update public.resources set module_id='clientes', secao='aba', display_order=102, label='Aba Movimentos MRR',
       where_it_appears='Clientes › Movimentos MRR',
       description='Extrato de upsell, downsell, churn e reativação de todos os clientes.' where key='fin.movimentos';
update public.resources set secao='aba', display_order=103, label='Aba Reajustes', acoes='{view,insert,delete}',
       where_it_appears='Clientes › Reajustes',
       description='Preparar, aplicar e estornar reajustes. Aplicar grava o movimento de MRR.' where key='clientes.reajuste';
update public.resources set secao='aba', display_order=106, label='Aba Aprovação OEM',
       where_it_appears='Clientes › Aprovação OEM' where key='clientes.oem_aprovacao';

update public.resources set grupo='Ficha do cliente', grupo_ordem=20
 where key in ('clientes.ficha','clientes.dados','clientes.contatos','clientes.venda_produto','clientes.contratos',
               'clientes.modulos','clientes.parametros_atendimento','clientes.tickets','clientes.filiais',
               'clientes.financeiro','clientes.custos','clientes.integracao','clientes.cancelar','clientes.purge');
update public.resources set secao='entrada', parent_key='clientes', display_order=110, label='Abrir a ficha do cliente',
       where_it_appears='Clientes › abrir um cliente' where key='clientes.ficha';
update public.resources set parent_key='clientes.dados', display_order=111, label='Contatos adicionais',
       where_it_appears='Ficha do cliente › Dados Cadastrais › Contatos adicionais' where key='clientes.contatos';
update public.resources set parent_key='clientes.venda_produto', display_order=113, secao='aba',
       where_it_appears='Ficha do cliente › Produto / Contrato › Contratos' where key='clientes.contratos';
update public.resources set parent_key='clientes.venda_produto', display_order=114, secao='aba', label='Produtos e módulos',
       where_it_appears='Ficha do cliente › Produto / Contrato › Produtos & Módulos' where key='clientes.modulos';
update public.resources set parent_key='clientes.ficha', display_order=118, where_it_appears='Ficha do cliente › Filiais' where key='clientes.filiais';
update public.resources set parent_key='clientes.ficha', display_order=119, where_it_appears='Ficha do cliente › Financeiro' where key='clientes.financeiro';
update public.resources set parent_key='clientes.financeiro', display_order=120,
       where_it_appears='Ficha do cliente › Financeiro › Parâmetros financeiros' where key='clientes.custos';
update public.resources set parent_key='clientes.ficha', display_order=122, where_it_appears='Ficha do cliente › Cancelamento' where key='clientes.cancelar';
update public.resources set parent_key='clientes.ficha', display_order=123,
       where_it_appears='Ficha do cliente › Zona de Perigo › Excluir tudo' where key='clientes.purge';

-- ============================================================== ATENDIMENTO
-- Primeiro o Chat (enquanto só ele está no módulo), depois os outros dois.
update public.resources set grupo='Chat', grupo_ordem=20 where module_id='atendimento';
update public.resources set label='Abrir o Chat', where_it_appears='Menu › Atendimento › Chat' where key='atendimento_chat';
update public.resources set module_id='atendimento', grupo='Dashboard de atendimento', grupo_ordem=10
 where module_id='atendimento_dash';
update public.resources set label='Abrir o Dashboard de atendimento', where_it_appears='Menu › Atendimento › Dashboard'
 where key='nav.atendimento_dashboard';
update public.resources set module_id='atendimento', grupo='Tickets', grupo_ordem=30 where module_id='tickets';
update public.resources set label='Abrir Tickets', where_it_appears='Menu › Atendimento › Tickets' where key='tickets';

-- ====================================== TELAS DE UMA PORTA SÓ (menu próprio)
update public.resources set module_id='customer_success', grupo=null, secao='entrada', parent_key=null,
       label='Abrir Customer Success', where_it_appears='Menu › Customer Success' where key='nav.customer_success';
update public.resources set module_id='certificados', grupo=null, secao='entrada', parent_key=null,
       label='Abrir Certificados A1', where_it_appears='Menu › Certificados A1' where key='nav.certificados_a1';
update public.resources set grupo='Abas', grupo_ordem=10 where key='certificados.dashboard';
update public.resources set module_id='painel_uso', grupo=null, secao='entrada', parent_key=null,
       label='Abrir o Painel de Uso', where_it_appears='Menu › Painel de Uso' where key='nav.painel_uso';
-- E-mails é feature em construção: some da tela até a rota existir.
update public.resources set hidden=true where key='nav.emails';

-- ============================================================== IMPLANTAÇÃO
update public.resources set label='Abrir Implantação', grupo=null, secao='entrada', parent_key=null,
       where_it_appears='Menu › Implantação' where key='nav.onboarding';
update public.resources set grupo='Kanban', grupo_ordem=10, parent_key=null
 where key in ('onb.mover','onb.criar_jornada','onb.editar_jornada','onb.golive','onb.cancelar',
               'onb.reabrir','onb.transferir','onb.treinos');
update public.resources set grupo='Dashboard', grupo_ordem=20, parent_key=null where key='onb.dashboard';
update public.resources set grupo='Configuração', grupo_ordem=30, parent_key=null where key like 'onb.cfg.%';
update public.resources set label='Aba Pipelines & Etapas', display_order=481,
       where_it_appears='Implantação › Configuração › Pipelines & Etapas' where key='onb.cfg.pipelines';
update public.resources set label='Aba Distribuição', display_order=482,
       where_it_appears='Implantação › Configuração › Distribuição' where key='onb.cfg.distribuicao';
update public.resources set label='Aba Motivos de Parada', display_order=483,
       description='Motivos para pausar uma jornada.',
       where_it_appears='Implantação › Configuração › Motivos de Parada' where key='onb.cfg.motivos';
update public.resources set label='Aba Papéis', display_order=486,
       where_it_appears='Implantação › Configuração › Papéis' where key='onb.cfg.papeis';
update public.resources set parent_key='onb.cfg.pipelines', label='Checklist das etapas',
       where_it_appears='Implantação › Configuração › Pipelines & Etapas › Checklist' where key='onb.cfg.checklists';
update public.resources set parent_key='onb.cfg.pipelines', label='Aplicar template de pipeline',
       where_it_appears='Implantação › Configuração › Pipelines & Etapas › Aplicar template' where key='onb.cfg.templates';

-- ============================================ CONFIGURAÇÕES (= barra lateral)
update public.resources set module_id='configuracoes'
 where key in ('cfg.percentuais','cfg.despesas_cac','cfg.acessos','cfg.permissoes','cfg.seguranca',
               'usuarios_convites','usuarios_roles','usuarios.desativar','usuarios.auditoria',
               'cfg.canais','cfg.email','cfg.ia','cfg.integracoes_omie','cfg.integracoes_hiper',
               'cfg.duplicidades','cfg.importacao','atend.macros');
update public.resources set grupo=null, secao='entrada', parent_key=null, label='Abrir Configurações',
       where_it_appears='Menu › Configurações' where key='nav.configuracoes';

update public.resources as r set grupo=v.grupo, grupo_ordem=v.ord, label=v.label,
       where_it_appears=v.caminho, parent_key=v.pai, secao=case when v.pai is null then 'config' else r.secao end
from (values
 ('cfg.geral','Sistema',10,'Geral','Configurações › Sistema › Geral',null),
 ('cfg.notificacoes','Sistema',10,'Théo','Configurações › Sistema › Théo',null),
 ('cfg.setup','Sistema',10,'Guia de configuração','Configurações › Sistema › Guia de configuração',null),
 ('cfg.percentuais','Financeiro',20,'Percentuais','Configurações › Financeiro › Percentuais',null),
 ('cfg.despesas_cac','Financeiro',20,'Despesas CAC','Configurações › Financeiro › Despesas CAC',null),
 ('cfg.produtos','Cadastros · Comercial',30,'Produtos','Configurações › Cadastros › Comercial › Produtos',null),
 ('cfg.fornecedores','Cadastros · Comercial',30,'Fornecedores','Configurações › Cadastros › Comercial › Fornecedores',null),
 ('cfg.modelos_contrato','Cadastros · Comercial',30,'Modelos de contrato','Configurações › Cadastros › Comercial › Modelos de contrato',null),
 ('cfg.origens_venda','Cadastros · Comercial',30,'Origens de venda','Configurações › Cadastros › Comercial › Origens de venda',null),
 ('cfg.formas_pagamento','Cadastros · Comercial',30,'Formas de pagamento','Configurações › Cadastros › Comercial › Formas de pagamento',null),
 ('cfg.setores','Cadastros · Operacional',31,'Setores','Configurações › Cadastros › Operacional › Setores',null),
 ('cfg.funcionarios','Cadastros · Operacional',31,'Funcionários','Configurações › Cadastros › Operacional › Funcionários',null),
 ('cfg.tickets_config','Cadastros · Operacional',31,'Tickets','Configurações › Cadastros › Operacional › Tickets',null),
 ('cfg.categorias_servico','Cadastros · Serviços',32,'Categorias','Configurações › Cadastros › Serviços › Categorias',null),
 ('cfg.tipos_servico','Cadastros · Serviços',32,'Tipos de serviço','Configurações › Cadastros › Serviços › Tipos de serviço',null),
 ('cfg.segmentos','Cadastros · Classificação',33,'Segmentos','Configurações › Cadastros › Classificação › Segmentos',null),
 ('cfg.areas_atuacao','Cadastros · Classificação',33,'Áreas de atuação','Configurações › Cadastros › Classificação › Áreas de atuação',null),
 ('cfg.unidades_base','Cadastros · Classificação',33,'Unidades base','Configurações › Cadastros › Classificação › Unidades base',null),
 ('cfg.motivos_cancelamento','Cadastros · Ciclo de vida',34,'Motivos de cancelamento','Configurações › Cadastros › Ciclo de vida › Motivos de cancelamento',null),
 ('cfg.motivos_pausa','Cadastros · Ciclo de vida',34,'Motivos de pausa','Configurações › Cadastros › Ciclo de vida › Motivos de pausa',null),
 ('cfg.acessos','Equipe',40,'Acessos & permissões','Configurações › Equipe › Acessos & permissões',null),
 ('usuarios_convites','Equipe',40,'Convidar pessoas','Configurações › Equipe › Acessos & permissões › botão Convidar','cfg.acessos'),
 ('usuarios_roles','Equipe',40,'Trocar o grupo de outra pessoa','Configurações › Equipe › Acessos & permissões › coluna Grupo','cfg.acessos'),
 ('usuarios.desativar','Equipe',40,'Desativar pessoa','Configurações › Equipe › Acessos & permissões › Status','cfg.acessos'),
 ('usuarios.auditoria','Equipe',40,'Histórico de alterações','Configurações › Equipe › Acessos & permissões › Histórico','cfg.acessos'),
 ('cfg.permissoes','Equipe',40,'Permissões e papéis','Configurações › Equipe › Permissões e papéis',null),
 ('cfg.seguranca','Equipe',40,'Segurança','Configurações › Equipe › Segurança',null),
 ('cfg.canais','Atendimento',50,'Canais','Configurações › Atendimento › Canais',null),
 ('cfg.distribuicao','Atendimento',50,'Distribuição','Configurações › Atendimento › Distribuição',null),
 ('cfg.operacao','Atendimento',50,'Operação','Configurações › Atendimento › Operação',null),
 ('atend.macros','Atendimento',50,'Macros e respostas rápidas','Configurações › Atendimento › Operação › Macros','cfg.operacao'),
 ('cfg.email','Atendimento',50,'E-mail','Configurações › Atendimento › E-mail',null),
 ('cfg.ia','Atendimento',50,'Inteligência artificial','Configurações › Atendimento › Inteligência artificial',null),
 ('cfg.horario_plantao','Atendimento',50,'Horário & plantão','Configurações › Atendimento › Horário & plantão',null),
 ('cfg.kb','Atendimento',50,'Base de conhecimento','Configurações › Atendimento › Base de conhecimento',null),
 ('cfg.duplicidades','Dados',60,'Duplicidades','Configurações › Dados › Duplicidades',null),
 ('cfg.importacao','Dados',60,'Importação','Configurações › Dados › Importação',null),
 ('cfg.integracoes_omie','Integrações',70,'Omie','Configurações › Integrações › Omie',null),
 ('cfg.integracoes_hiper','Integrações',70,'Hiper','Configurações › Integrações › Hiper',null),
 ('cfg.integracoes_oem','Integrações',70,'OEM','Configurações › Integrações › OEM',null)
) as v(key, grupo, ord, label, caminho, pai)
where r.key = v.key;

-- =================================================================== SUPER
update public.resources set grupo=null, secao='entrada', parent_key=null, where_it_appears='Menu › Super Admin' where key='nav.super';
update public.resources as r set grupo='Telas', grupo_ordem=10, label=v.label, where_it_appears=v.caminho
from (values
 ('super.tenants','Tenants','Super Admin › Tenants'),
 ('super.templates','Templates','Super Admin › Templates'),
 ('super_monitor','Monitor','Super Admin › Monitor'),
 ('super.limpeza_uras','Limpeza de URAs','Super Admin › Limpeza de URAs')
) as v(key, label, caminho) where r.key = v.key;

-- Oculto, mas também precisa de casa: sem isto a exclusão dos módulos abaixo
-- falha na FK (foi o que aconteceu na primeira execução desta migration).
update public.resources set module_id='configuracoes', grupo='Atendimento', grupo_ordem=50
 where key='cfg.whatsapp';

-- Os módulos que não existem no menu somem. A FK de resources.module_id não é
-- cascata: se sobrou algum recurso neles, a migration FALHA aqui — de propósito.
delete from public.permission_modules
 where id in ('financeiro','equipe','integracoes','dados','tickets','atendimento_dash');

-- ============================== SEMEADURA dos novos, pelo acesso de hoje
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, a.key, coalesce(gp.can_view, trp.can_view, rp.can_view, false),
       case when a.key = 'cfg.integracoes_oem' then coalesce(gp.can_insert, trp.can_insert, rp.can_insert, false) else false end,
       case when a.key = 'cfg.integracoes_oem' then coalesce(gp.can_update, trp.can_update, rp.can_update, false) else false end,
       case when a.key = 'cfg.integracoes_oem' then coalesce(gp.can_delete, trp.can_delete, rp.can_delete, false) else false end
from public.permission_groups g
cross join (values
 ('clientes.divergencias_hiper','clientes'), ('clientes.cadastro_incompleto','clientes'),
 ('clientes.dados','clientes.ficha'), ('clientes.venda_produto','clientes.ficha'),
 ('clientes.parametros_atendimento','clientes.ficha'), ('clientes.tickets','clientes.ficha'),
 ('clientes.integracao','clientes.ficha'),
 ('onb.cfg.jornadas','onb.cfg.pipelines'), ('onb.cfg.demandas','onb.cfg.pipelines'),
 ('onb.cfg.tipos_treino','onb.cfg.pipelines'), ('onb.cfg.retornos','onb.cfg.pipelines'),
 ('onb.cfg.contabilidade','onb.cfg.pipelines'), ('onb.cfg.indicadores','onb.cfg.pipelines'),
 ('certificados.dashboard','nav.certificados_a1'),
 -- OEM herda o valor que valia de fato: era a permissão do Omie que a abria.
 ('cfg.integracoes_oem','cfg.integracoes_omie')
) as a(key, ancora_key)
left join public.group_permissions gp  on gp.group_id = g.id and gp.resource_key = a.ancora_key
left join public.tenant_role_permissions trp
  on trp.tenant_id = g.tenant_id and trp.role = g.nivel_base and trp.resource_key = a.ancora_key
left join public.role_permissions rp on rp.role = g.nivel_base and rp.resource_key = a.ancora_key
on conflict (group_id, resource_key) do nothing;

-- ============ cfg.ia: devolve o que a fusão tirou por engano (14 da Digi Office)
update public.group_permissions gp set can_view = true, updated_at = now()
  from public.permission_groups g
 where g.id = gp.group_id and gp.resource_key = 'cfg.ia' and gp.can_view = false
   and coalesce(
     (select trp.can_view from public.tenant_role_permissions trp
       where trp.tenant_id = g.tenant_id and trp.role = g.nivel_base and trp.resource_key = 'cfg.ia'),
     (select rp.can_view from public.role_permissions rp where rp.role = g.nivel_base and rp.resource_key = 'cfg.ia'),
     false) = true;

-- ======================================================== LEITURA DA TELA
create or replace function public.rbac_get_config(p_tenant_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid;
begin
  v_tenant := public.rbac_assert_admin(p_tenant_id);
  return jsonb_build_object(
    'tenant_id', v_tenant,
    'v2_ligado', (select rbac_v2_enabled from public.tenants where id=v_tenant),
    'modulos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id',m.id,'nome',m.nome,'descricao',m.descricao,'ordem',m.ordem,
                  'nivel', coalesce(l.nivel,1)) order by m.ordem),'[]'::jsonb)
                from public.permission_modules m
                left join public.tenant_module_levels l on l.module_id=m.id and l.tenant_id=v_tenant),
    'grupos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id',g.id,'nome',g.nome,'slug',g.slug,'nivel_base',g.nivel_base,
                  'is_system',g.is_system,'ordem',g.ordem,
                  'membros',(select count(*) from public.user_groups ug where ug.group_id=g.id)
                ) order by g.ordem),'[]'::jsonb)
               from public.permission_groups g where g.tenant_id=v_tenant),
    'recursos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'key',r.key,'label',r.label,'descricao',r.description,
                  'caminho',r.where_it_appears,'secao',r.secao,
                  'grupo',r.grupo,'grupo_ordem',r.grupo_ordem,
                  'module_id',r.module_id,'parent_key',r.parent_key,'nivel',r.nivel,'ordem',r.display_order,
                  'acoes',r.acoes,'escopo_aplicavel',r.escopo_aplicavel,'escopos_validos',r.escopos_validos
                ) order by r.display_order),'[]'::jsonb)
                from public.resources r where not r.hidden),
    'permissoes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'group_id',gp.group_id,'key',gp.resource_key,'view',gp.can_view,
                  'insert',gp.can_insert,'update',gp.can_update,'delete',gp.can_delete,'escopo',gp.escopo)),'[]'::jsonb)
                from public.group_permissions gp
                join public.permission_groups g on g.id=gp.group_id where g.tenant_id=v_tenant)
  );
end $$;

commit;
