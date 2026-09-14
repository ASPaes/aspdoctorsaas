-- ============================================================================
-- RBAC v2 — CATÁLOGO COMPLETO
-- Traz para `resources` as funcionalidades levantadas em RBAC_FUNCTIONALITIES.md
-- que existem no produto e nunca estiveram no catálogo.
--
-- REGRA DE SEMEADURA (governança, seção 6-A do plano): recurso novo nasce
-- espelhando o acesso que as pessoas TÊM HOJE — nunca o que "faria sentido".
-- Como nenhum deles tem portão no código ainda, o acesso de hoje é o do item
-- pai. Endurecer é decisão separada do admin, depois, com aviso.
--
-- Todos entram marcados como sem portão: a tela mostra "ainda não aplicado"
-- até a entrega que liga cada um (F3).
-- ============================================================================
begin;

insert into public.permission_modules (id, nome, descricao, ordem) values
  ('atendimento_dash','Dashboard de Atendimento','Indicadores da operacao de atendimento, incluindo desempenho individual.',55),
  ('tickets',         'Tickets',                 'Chamados: fila, detalhe, anexos e encerramento.',                        58),
  ('onboarding',      'Onboarding e Implantacao','Jornadas, quadros, treinos e a configuracao dos pipelines.',             65)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- catálogo
-- nivel: 1 = a tela de hoje · 2 = modulos e acoes sensiveis · 3 = abas e sub-acoes
-- `resources.module` (texto legado, NOT NULL) e preenchido a partir do nome do
-- modulo normalizado, para a tela antiga continuar agrupando certo.
insert into public.resources
  (key, module, module_id, label, description, where_it_appears, parent_key, display_order, is_navigation, hidden, nivel)
select v.key, m.nome, v.module_id, v.label, v.description, v.where_it_appears,
       v.parent_key, v.display_order, v.is_navigation, v.hidden, v.nivel
from (values
-- ......................................................... menu principal
 ('nav.onboarding','menu','Onboarding e Implantação','Item do menu lateral. Hoje a tela e liberada so pela flag onboarding_enabled do tenant.','Menu lateral > Implantacao',null,36,true,false,2),
 ('nav.cadastros','menu','Cadastros','Atalho para os cadastros auxiliares.','Menu lateral > Cadastros',null,37,true,false,3),
 ('nav.whatsapp_contatos','menu','Contatos do WhatsApp','Agenda de contatos. Hoje compartilha a chave do Chat: nao da para liberar um sem o outro.','Menu lateral > Chat > Contatos',null,51,true,false,2),
 ('nav.meu_painel','menu','Meu Painel','Painel pessoal de indicadores.','Dashboard > Meu Painel',null,71,true,false,3),
 ('nav.super','menu','Super Admin','Bloco de super admin no menu. Continua protegido por is_super_admin (decisao D4).','Menu lateral > Super Admin',null,85,true,false,3),
-- ............................................................... dashboard
 ('dash.visao_geral','dashboard','Aba Visão Geral','Panorama do negocio.','Dashboard > Visao Geral',null,320,false,false,2),
 ('dash.crescimento','dashboard','Aba Crescimento','Evolucao de MRR e base.','Dashboard > Crescimento',null,321,false,false,2),
 ('dash.cancelamentos','dashboard','Aba Cancelamentos','Churn e motivos de saida.','Dashboard > Cancelamentos',null,322,false,false,2),
 ('dash.vendas','dashboard','Aba Vendas','Vendas por vendedor e origem. Base de comissao.','Dashboard > Vendas',null,323,false,false,2),
 ('dash.distribuicao','dashboard','Aba Distribuição','Distribuicao da carteira.','Dashboard > Distribuicao',null,324,false,false,3),
 ('dash.cs','dashboard','Aba Customer Success','Saude da carteira.','Dashboard > Customer Success',null,325,false,false,3),
 ('dash.cohort','dashboard','Aba Cohort','Retencao por safra.','Dashboard > Cohort',null,326,false,false,2),
 ('dash.meu_painel','dashboard','Aba Meu Painel','Indicadores pessoais. Sempre do proprio usuario.','Dashboard > Meu Painel',null,327,false,false,3),
 ('dash.valores_financeiros','dashboard','Ver valores em R$ nos painéis','Quando negado, os graficos continuam visiveis e os valores em dinheiro aparecem mascarados.','Todos os paineis com valor monetario',null,328,false,false,2),
-- ................................................ dashboard de atendimento
 ('atd.tempo_real','atendimento_dash','Aba Tempo Real','Fila e atendimentos agora.','Dashboard de Atendimento > Tempo Real',null,340,false,false,2),
 ('atd.velocidade','atendimento_dash','Aba Velocidade / SLA','Tempos de resposta e SLA.','Dashboard de Atendimento > Velocidade',null,341,false,false,3),
 ('atd.agentes','atendimento_dash','Aba Agentes','Produtividade individual de cada operador.','Dashboard de Atendimento > Agentes',null,342,false,false,2),
 ('atd.satisfacao','atendimento_dash','Aba Satisfação','Nota de CSAT individual por operador.','Dashboard de Atendimento > Satisfacao',null,343,false,false,2),
 ('atd.volume','atendimento_dash','Aba Volume','Volume de atendimentos.','Dashboard de Atendimento > Volume',null,344,false,false,3),
 ('atd.ura','atendimento_dash','Aba URA','Uso do menu automatico.','Dashboard de Atendimento > URA',null,345,false,false,3),
 ('atd.chats','atendimento_dash','Aba Chats','Conversas por periodo.','Dashboard de Atendimento > Chats',null,346,false,false,3),
 ('atd.tickets','atendimento_dash','Aba Tickets','Chamados abertos pelo atendimento.','Dashboard de Atendimento > Tickets',null,347,false,false,3),
 ('atd.backlog','atendimento_dash','Aba Backlog','Fila acumulada.','Dashboard de Atendimento > Backlog',null,348,false,false,3),
 ('atd.clientes','atendimento_dash','Aba Clientes','Atendimento por cliente.','Dashboard de Atendimento > Clientes',null,349,false,false,3),
 ('atd.cobertura','atendimento_dash','Aba Cobertura','Cobertura da equipe no horario.','Dashboard de Atendimento > Cobertura',null,350,false,false,3),
-- ................................................................ clientes
 ('clientes.ficha','clientes','Abrir a ficha do cliente','Dados cadastrais completos.','Clientes > ficha','clientes',113,false,false,3),
 ('clientes.contratos','clientes','Contratos do cliente','Criar, editar e encerrar contrato. Mexe no MRR.','Ficha do cliente > Contratos','clientes',114,false,false,2),
 ('clientes.financeiro','clientes','Aba Financeiro do cliente','Mensalidade, faturamento e composicao.','Ficha do cliente > Financeiro','clientes',115,false,false,2),
 ('clientes.cancelar','clientes','Cancelar cliente','Encerra os contratos e baixa o MRR.','Ficha do cliente > Cancelar','clientes',116,false,false,2),
 ('clientes.reativar','clientes','Reativar cliente','Volta o cliente e o MRR.','Ficha do cliente > Reativar','clientes',117,false,false,2),
 ('clientes.reajuste','clientes','Aplicar reajuste','Altera o valor cobrado e grava movimento de MRR.','Ficha do cliente > Reajuste','clientes',118,false,false,2),
 ('clientes.purge','clientes','Excluir tudo do cliente','Remove cadastro, contratos e historico. Irreversivel.','Ficha do cliente > Excluir tudo','clientes',119,false,false,2),
 ('clientes.historico','clientes','Histórico de acessos','Quem abriu a ficha e quando.','Ficha do cliente > Historico','clientes',120,false,false,3),
 ('clientes.filiais','clientes','Filiais do cliente','Matriz e filiais vinculadas.','Ficha do cliente > Filiais','clientes',121,false,false,3),
 ('clientes.contatos','clientes','Contatos do cliente','Telefones e e-mails das pessoas do cliente.','Ficha do cliente > Contatos','clientes',122,false,false,3),
-- .............................................................. financeiro
 ('fin.mrr','financeiro','Receita e MRR','Visao de receita recorrente.','Dashboard e relatorios de MRR',null,205,false,false,2),
 ('fin.bridge','financeiro','Ponte de MRR','Decomposicao do MRR entre dois periodos.','Dashboard > Crescimento > Ponte',null,206,false,false,2),
 ('fin.movimentos','financeiro','Movimentos de MRR','Extrato de upsell, downsell, churn e reativacao.','Relatorio de movimentos',null,207,false,false,3),
-- ............................................................. atendimento
 ('atend.assumir','atendimento','Assumir conversa da fila','Puxar um atendimento que esta aguardando.','Chat > Fila','atendimento_chat',440,false,false,3),
 ('atend.enviar','atendimento','Enviar mensagem','Responder no chat.','Chat','atendimento_chat',441,false,false,3),
 ('atend.agendar','atendimento','Agendar mensagem','Programar envio para depois.','Chat > Agendar','atendimento_chat',442,false,false,3),
 ('atend.encaminhar','atendimento','Encaminhar mensagem e mídia','Envia conteudo de um cliente para outro destino.','Chat > Encaminhar','atendimento_chat',443,false,false,2),
 ('atend.macros','atendimento','Macros e respostas rápidas','Textos prontos compartilhados pela equipe.','Chat > Macros','atendimento_chat',444,false,false,3),
 ('atend.historico_terceiros','atendimento','Ver conversa de outro agente','Abrir atendimento que nao e seu.','Chat > Historico do contato','atendimento_chat',445,false,false,2),
 ('atend.acesso_remoto','atendimento','Acesso remoto (AcessoFast)','Iniciar sessao remota na maquina do cliente.','Chat > Acesso remoto','atendimento_chat',446,false,false,2),
 ('atend.contatos','atendimento','Agenda de contatos do WhatsApp','Lista completa de contatos. Hoje presa a chave do Chat.','Chat > Contatos','atendimento_chat',447,false,false,2),
 ('atend.busca','atendimento','Busca em mensagens','Procurar texto dentro das conversas.','Chat > Buscar','atendimento_chat',448,false,false,3),
-- ................................................................. tickets
 ('tickets','tickets','Abrir o módulo de tickets','Lista de chamados.','Tela Tickets',null,460,false,false,2),
 ('tickets.criar','tickets','Criar ticket','Abrir chamado novo.','Tickets > Novo','tickets',461,false,false,3),
 ('tickets.editar','tickets','Editar ticket','Alterar dados do chamado.','Tickets > Detalhe','tickets',462,false,false,3),
 ('tickets.encerrar','tickets','Encerrar ticket','Fechar o chamado.','Tickets > Detalhe > Encerrar','tickets',463,false,false,3),
 ('tickets.reabrir','tickets','Reabrir ticket','Voltar chamado encerrado.','Tickets > Detalhe > Reabrir','tickets',464,false,false,3),
 ('tickets.excluir','tickets','Excluir ticket','Remove o chamado.','Tickets > Detalhe > Excluir','tickets',465,false,false,2),
 ('tickets.transferir','tickets','Transferir responsável','Passar o chamado para outra pessoa ou setor.','Tickets > Detalhe > Transferir','tickets',466,false,false,3),
 ('tickets.anexos','tickets','Anexos do ticket','Arquivos enviados pelo cliente.','Tickets > Detalhe > Anexos','tickets',467,false,false,2),
 ('tickets.mencoes','tickets','Menções','Citações da pessoa em chamados.','Tickets > Mencoes','tickets',468,false,false,3),
-- .............................................................. onboarding
 ('onb.quadro','onboarding','Quadro de jornadas','Kanban de Implantacao e Acompanhamento.','Implantacao > Kanban',null,470,false,false,2),
 ('onb.mover','onboarding','Mover cartão de etapa','Arrastar entre colunas. Mexe no SLA.','Implantacao > Kanban','onb.quadro',471,false,false,3),
 ('onb.criar_jornada','onboarding','Criar jornada','Abrir nova implantacao ou acompanhamento.','Implantacao > Nova jornada','onb.quadro',472,false,false,3),
 ('onb.editar_jornada','onboarding','Editar dados da jornada','Alterar informacoes da implantacao.','Implantacao > Jornada > Editar','onb.quadro',473,false,false,3),
 ('onb.golive','onboarding','Go-live / encerrar jornada','Conclui a implantacao e fecha o SLA.','Implantacao > Jornada > Go-live','onb.quadro',474,false,false,2),
 ('onb.cancelar','onboarding','Cancelar jornada','Encerra sem conclusao.','Implantacao > Jornada > Cancelar','onb.quadro',475,false,false,2),
 ('onb.reabrir','onboarding','Reabrir jornada','Volta jornada encerrada e reescreve o historico.','Implantacao > Jornada > Reabrir','onb.quadro',476,false,false,2),
 ('onb.transferir','onboarding','Transferir responsável','Troca quem conduz a implantacao.','Implantacao > Jornada > Transferir','onb.quadro',477,false,false,3),
 ('onb.treinos','onboarding','Treinos','Agendar, registrar falta e desistencia.','Implantacao > Treinos','onb.quadro',478,false,false,3),
 ('onb.dashboard','onboarding','Dashboard de Implantação','Indicadores e SLA das jornadas.','Implantacao > Dashboard',null,479,false,false,2),
 ('onb.cfg.pipelines','onboarding','Configurar pipelines e etapas','Estrutura dos quadros e SLA de cada etapa.','Implantacao > Configuracao > Pipelines',null,480,false,false,2),
 ('onb.cfg.checklists','onboarding','Configurar checklists','Itens obrigatorios de cada etapa.','Implantacao > Configuracao > Checklists','onb.cfg.pipelines',481,false,false,3),
 ('onb.cfg.papeis','onboarding','Configurar papéis de participante','Quem faz o que na jornada.','Implantacao > Configuracao > Papeis','onb.cfg.pipelines',482,false,false,3),
 ('onb.cfg.distribuicao','onboarding','Configurar distribuição','Rodizio de responsaveis por pipeline.','Implantacao > Configuracao > Distribuicao','onb.cfg.pipelines',483,false,false,3),
 ('onb.cfg.motivos','onboarding','Configurar motivos e retornos','Motivos de parada e retorno ao vendedor.','Implantacao > Configuracao > Motivos','onb.cfg.pipelines',484,false,false,3),
 ('onb.cfg.templates','onboarding','Templates por produto','Modelos de jornada usados pela IA na criacao.','Implantacao > Configuracao > Templates','onb.cfg.pipelines',485,false,false,3),
-- ......................................................... equipe e outros
 ('usuarios.desativar','equipe','Desativar pessoa','Tira o acesso de alguem ao sistema.','Configuracoes > Equipe > Acessos',null,520,false,false,2),
 ('usuarios.auditoria','equipe','Ver trilha de auditoria','Historico de quem mudou permissao.','Configuracoes > Equipe > Acessos > Historico',null,521,false,false,3),
 ('cs.painel','configuracoes','Painel de Customer Success','Saude e risco da carteira.','Tela Customer Success',null,530,false,false,2),
 ('certificados','configuracoes','Certificados A1','Certificados digitais dos clientes.','Tela Certificados A1',null,531,false,false,2),
 ('painel_uso','configuracoes','Painel de Uso','Consumo da plataforma pelo tenant.','Tela Painel de Uso',null,532,false,false,3),
 ('meu_painel','configuracoes','Meu Painel','Indicadores pessoais. Sempre do proprio usuario.','Dashboard > Meu Painel',null,533,false,false,3),
-- .................................................................. super
 ('super.tenants','super','Gestão de empresas','Cadastro e configuracao dos tenants.','Super Admin > Tenants',null,910,false,false,3),
 ('super.templates','super','Catálogo de templates','Templates compartilhados entre empresas.','Super Admin > Templates',null,911,false,false,3),
 ('super.limpeza_uras','super','Limpeza de URAs','Manutencao das conversas de URA.','Super Admin > Limpeza de URAs',null,912,false,false,3)
) as v(key, module_id, label, description, where_it_appears, parent_key,
        display_order, is_navigation, hidden, nivel)
join public.permission_modules m on m.id = v.module_id
on conflict (key) do nothing;

commit;
