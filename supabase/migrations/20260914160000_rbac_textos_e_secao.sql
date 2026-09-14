-- ============================================================================
-- Textos que o admin lê: seção faltando e acentuação
--
-- Os textos dos recursos criados em 14/09 foram escritos sem acento, e alguns
-- traziam jargão interno ("decisão D4", "flag onboarding_enabled") que não
-- diz nada a quem administra permissões. É isto que o ⓘ abre na tela.
-- ============================================================================
begin;

-- Sem seção, caíam num grupo "Outros" que o desenho aprovado não tem.
update public.resources set secao = 'aba' where key in ('dashboard_conselho', 'super_monitor');

update public.resources set where_it_appears = 'Todos os painéis com valor em R$'
 where key = 'dash.valores_financeiros';

update public.resources as r set description = v.d
from (values
 ('atd.chats',                 'Conversas por período.'),
 ('atd.ura',                   'Uso do menu automático.'),
 ('atend.acesso_remoto',       'Abre uma sessão remota na máquina do cliente.'),
 ('atend.historico_terceiros', 'Abrir um atendimento que é de outra pessoa.'),
 ('clientes.filiais',          'Matriz e filiais vinculadas a este cliente.'),
 ('clientes.financeiro',       'Mensalidade, faturamento e composição do valor.'),
 ('clientes.historico',        'Quem abriu a ficha deste cliente e quando.'),
 ('clientes.purge',            'Apaga cadastro, contratos e histórico. Não tem volta.'),
 ('clientes.reativar',         'Devolve o cliente e o MRR.'),
 ('clientes.cancelar',         'Encerra os contratos e dá baixa no MRR.'),
 ('dash.cancelamentos',        'Churn do período e os motivos de saída.'),
 ('dash.cohort',               'Retenção por safra de entrada.'),
 ('dash.crescimento',          'Evolução do MRR e entrada de clientes novos.'),
 ('dash.cs',                   'Saúde da carteira e clientes em risco.'),
 ('dash.distribuicao',         'Como a carteira se distribui por produto, região e porte.'),
 ('dash.meu_painel',           'Indicadores que a própria pessoa monta. Sempre dela.'),
 ('dash.valores_financeiros',  'Quando negado, os gráficos continuam e os valores em R$ aparecem mascarados.'),
 ('dash.vendas',               'Vendas por vendedor e por origem. É a base do cálculo de comissão.'),
 ('dash.visao_geral',          'Panorama do negócio: base de clientes, receita e alertas.'),
 ('fin.bridge',                'Decomposição do MRR entre dois períodos.'),
 ('fin.movimentos',            'Extrato de upsell, downsell, churn e reativação.'),
 ('fin.mrr',                   'Visão da receita recorrente.'),
 ('nav.onboarding',            'Porta do módulo de Onboarding e Implantação. A empresa também precisa ter o módulo contratado.'),
 ('nav.super',                 'Bloco de super admin. Só quem é super admin chega aqui, independentemente do grupo.'),
 ('onb.cancelar',              'Encerra a jornada sem conclusão.'),
 ('onb.cfg.templates',         'Modelos de jornada que a IA usa ao criar uma implantação.'),
 ('onb.criar_jornada',         'Abrir uma implantação ou um acompanhamento novo.'),
 ('onb.editar_jornada',        'Alterar as informações da implantação.'),
 ('onb.golive',                'Conclui a implantação e fecha o SLA.'),
 ('onb.reabrir',               'Volta uma jornada encerrada e reescreve o histórico.'),
 ('onb.transferir',            'Troca quem conduz a implantação.'),
 ('onb.treinos',               'Agendar treino, registrar falta e desistência.'),
 ('super.limpeza_uras',        'Manutenção das conversas de URA.'),
 ('super.tenants',             'Cadastro e configuração das empresas.'),
 ('usuarios.auditoria',        'Histórico de quem mudou cada permissão.')
) as v(k, d)
where r.key = v.k;

commit;
