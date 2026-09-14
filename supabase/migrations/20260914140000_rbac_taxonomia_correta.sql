-- ============================================================================
-- TAXONOMIA — funde duplicatas, remove parentesco inventado e organiza por seção
--
-- TRES PROBLEMAS, todos medidos:
--  1. 16 pares duplicados: o mesmo Dashboard aparecia no modulo "Menu principal"
--     e no modulo "Dashboard". Vieram de eu ter somado o catalogo novo ao antigo
--     sem reconciliar.
--  2. 20 parentescos INVENTADOS: as 10 abas do Dashboard viraram filhas de
--     "Visao Geral" e as 10 do Atendimento filhas de "Tempo Real", so para a
--     arvore renderizar. Elas sao IRMAS.
--  3. A tela mostrava a chave tecnica (`clientes.filiais`) em vez do caminho
--     ate a funcionalidade. `where_it_appears` ja existia preenchido nos 143.
--
-- REGRA DA FUSAO — duas situacoes diferentes, e confundi-las tira acesso:
--  · Chave que morre SEM portao no codigo: o valor dela nunca teve efeito, entao
--    e descartado e o sobrevivente fica como esta. (Aplicar AND aqui faria 13
--    grupos perderem o menu do Dashboard por causa de um valor que nunca valeu.)
--  · Chave que morre COM portao: vale o AND dos dois. Nunca concede.
-- ============================================================================
begin;

-- ------------------------------------------------------- seção do recurso
alter table public.resources
  add column if not exists secao text not null default 'item'
    check (secao in ('entrada','aba','acao','config','transversal','pessoal','item'));

comment on column public.resources.secao is
  'Agrupamento DENTRO do modulo. Substitui o parentesco inventado: abas sao irmas, nao filhas umas das outras.';

-- ============================ 1. FUSÃO ======================================
-- 1a) Chaves COM portão: AND, para nunca conceder.
do $$
declare p record;
begin
  for p in select * from (values
      -- ia_configuracoes NAO entra aqui: o portao dela no codigo foi criado nesta
      -- mesma entrega, entao em producao o valor dela nunca teve efeito. Com AND,
      -- 14 operadores da Digi Office perdiam a aba de IA (corrigido em 14/09).
      ('nav.tickets','tickets'), ('nav.clientes','clientes')
    ) as t(morre, sobrevive)
  loop
    update public.group_permissions gp
       set can_view   = gp.can_view   and coalesce(m.can_view,false),
           can_insert = gp.can_insert and coalesce(m.can_insert,false),
           can_update = gp.can_update and coalesce(m.can_update,false),
           can_delete = gp.can_delete and coalesce(m.can_delete,false)
      from public.group_permissions m
     where m.group_id = gp.group_id
       and m.resource_key = p.morre
       and gp.resource_key = p.sobrevive;
  end loop;
end $$;

-- 1b) Todas as duplicatas saem do catálogo. O CASCADE leva as regras junto.
delete from public.resources where key in (
  'dashboard_operacional',       -- = nav.dashboard
  'nav.tickets',                 -- = tickets
  'nav.clientes',                -- = clientes
  'nav.chat',                    -- = atendimento_chat
  'cs.painel',                   -- = nav.customer_success
  'certificados',                -- = nav.certificados_a1
  'painel_uso',                  -- = nav.painel_uso
  'nav.meu_painel', 'meu_painel',-- = dash.meu_painel
  'nav.whatsapp_contatos',       -- = atend.contatos
  'onb.quadro',                  -- = nav.onboarding
  'ia_configuracoes',            -- = cfg.ia
  'base_conhecimento',           -- = cfg.kb
  'whatsapp_instancias',         -- = cfg.canais
  'parametros_atendimento',      -- = cfg.operacao
  'nav.cadastros',               -- rota e so um redirecionamento
  'lancamentos','receita_mrr','dashboard_financeiro'  -- ocultos, cobertos por fin.mrr
);

-- ======================= 2. HIERARQUIA E SEÇÃO ==============================
-- Fora o parentesco inventado. Depois cada recurso recebe o pai certo.
update public.resources set parent_key = null
 where parent_key in ('dash.visao_geral','atd.tempo_real');

-- As entradas: o item de menu vira a porta do proprio modulo.
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='nav.dashboard';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='clientes';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='atendimento_chat';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='tickets';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='nav.atendimento_dashboard';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='nav.onboarding';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='nav.configuracoes';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='nav.customer_success';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='nav.certificados_a1';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='nav.painel_uso';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='nav.super';
update public.resources set secao='entrada', parent_key=null, display_order=1 where key='nav.emails';

-- Rotulo da entrada, em linguagem de quem usa.
update public.resources set label='Abrir o Dashboard'               where key='nav.dashboard';
update public.resources set label='Abrir o módulo de Clientes'      where key='clientes';
update public.resources set label='Abrir o Chat'                    where key='atendimento_chat';
update public.resources set label='Abrir o módulo de Tickets'       where key='tickets';
update public.resources set label='Abrir o Dashboard de Atendimento'where key='nav.atendimento_dashboard';
update public.resources set label='Abrir Onboarding e Implantação'  where key='nav.onboarding';
update public.resources set label='Abrir Configurações'             where key='nav.configuracoes';
update public.resources set label='Abrir Customer Success'          where key='nav.customer_success';
update public.resources set label='Abrir Certificados A1'           where key='nav.certificados_a1';
update public.resources set label='Abrir o Painel de Uso'           where key='nav.painel_uso';
update public.resources set label='Abrir Super Admin'               where key='nav.super';

-- O "Menu principal" deixa de existir: cada entrada vai para o seu modulo.
update public.resources set module_id='dashboard'        where key='nav.dashboard';
update public.resources set module_id='atendimento_dash' where key='nav.atendimento_dashboard';
update public.resources set module_id='onboarding'       where key='nav.onboarding';
update public.resources set module_id='configuracoes'    where key in ('nav.configuracoes','nav.customer_success','nav.certificados_a1','nav.painel_uso','nav.emails');
update public.resources set module_id='super'            where key='nav.super';
delete from public.permission_modules where id='menu';

-- Seções por tipo, no lugar de parentesco falso.
update public.resources set secao='aba'
 where key like 'dash.%' and key not in ('dash.valores_financeiros','dash.meu_painel');
update public.resources set secao='transversal' where key='dash.valores_financeiros';
update public.resources set secao='pessoal'     where key='dash.meu_painel';
update public.resources set secao='aba'         where key like 'atd.%';

update public.resources set secao='aba'
 where key in ('clientes.ficha','clientes.financeiro','clientes.custos','clientes.filiais',
               'clientes.contatos','clientes.historico');
update public.resources set secao='acao'
 where key in ('clientes.exportar','clientes.contratos','clientes.cancelar','clientes.reativar',
               'clientes.reajuste','clientes.purge','clientes.modulos','clientes.oem_aprovacao');

update public.resources set secao='aba'
 where key in ('atend.historico_terceiros','atend.contatos','atend.busca','atendimento_filtros');
update public.resources set secao='acao'
 where key in ('atend.assumir','atend.enviar','atend.agendar','atend.encaminhar',
               'atend.acesso_remoto','atendimento_transferir','atendimento_grupo_participantes');
update public.resources set secao='config' where key='atend.macros';

update public.resources set secao='acao'   where key like 'tickets.%';
update public.resources set secao='acao'   where key like 'onb.%' and key not like 'onb.cfg.%' and key<>'onb.dashboard';
update public.resources set secao='aba'    where key='onb.dashboard';
update public.resources set secao='config' where key like 'onb.cfg.%';
update public.resources set secao='config' where key like 'cfg.%';
update public.resources set secao='acao'   where key in ('usuarios_roles','usuarios_convites','usuarios.desativar');
update public.resources set secao='aba'    where key in ('usuarios.auditoria','fin.mrr','fin.bridge','fin.movimentos');
update public.resources set secao='aba'    where key like 'super.%';

-- Parentesco só onde ele existe de verdade.
update public.resources set parent_key='clientes'          where key like 'clientes.%';
update public.resources set parent_key='atendimento_chat'  where key like 'atend%' and key<>'atendimento_chat';
update public.resources set parent_key='tickets'           where key like 'tickets.%';
update public.resources set parent_key='nav.onboarding'    where key like 'onb.%' and key<>'onb.cfg.pipelines';
update public.resources set parent_key='onb.cfg.pipelines' where key like 'onb.cfg.%' and key<>'onb.cfg.pipelines';
update public.resources set parent_key=null                where key='onb.cfg.pipelines';

commit;
