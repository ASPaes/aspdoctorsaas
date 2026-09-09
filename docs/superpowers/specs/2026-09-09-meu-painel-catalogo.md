# Catálogo de indicadores — para aprovação

Gerado de `src/lib/kpiCatalog/`. Total: **176** itens.

150 indicadores · 26 gráficos, dos quais 24 aguardam componente próprio do painel.

## Resumo por área

| Área | Indicadores | Gráficos | Aguardando |
|---|---:|---:|---:|
| Atendimento | 41 | 13 | 11 |
| Financeiro / MRR | 57 | 6 | 6 |
| Customer Success | 23 | 4 | 4 |
| Implantação | 23 | 3 | 3 |
| Certificados A1 | 6 | 0 | 0 |

## Atendimento

| Item | Tipo | O que é | Origem | Situação |
|---|---|---|---|---|
| Total de atendimentos | indicador | Todos os atendimentos abertos no período, sem exclusão — inclusive os que o cliente nunca respondeu e os iniciados pela equipe. É o mesmo total da aba Chats. | `atendimento.volume.total` | pronto |
| Clientes novos | indicador | Atendimentos de contatos que falam pela primeira vez (novos) vs que já tinham contato anterior (recorrentes). | `atendimento.volume.novos` | pronto |
| Clientes recorrentes | indicador | Atendimentos de contatos que falam pela primeira vez (novos) vs que já tinham contato anterior (recorrentes). | `atendimento.volume.recorrentes` | pronto |
| Atendimentos proativos | indicador | Quem iniciou: a empresa (agente, operador, automação, ticket = proativo) ou o cliente (customer, fora do horário = reativo). | `atendimento.volume.proativo` | pronto |
| Atendimentos reativos | indicador | Quem iniciou: a empresa (agente, operador, automação, ticket = proativo) ou o cliente (customer, fora do horário = reativo). | `atendimento.volume.reativo` | pronto |
| Atendimentos por canal | gráfico |  | `atendimento.volume.canais` | aguarda gráfico |
| Mapa de calor semanal | gráfico |  | `atendimento.volume.heatmap` | aguarda gráfico |
| Principais motivos de contato | gráfico | Tags de assunto mais frequentes (geradas por IA a partir do conteúdo do atendimento). | `atendimento.volume.top_motivos` | aguarda gráfico |
| TME | indicador | Quanto tempo o cliente fica na fila até um agente assumir. Conta tanto quem assume pela tela quanto quem responde direto pelo WhatsApp do celular. Mostramos a mediana (p50) e a cauda (p90). | `atendimento.velocidade.tme_p50` | pronto |
| 1ª Resposta | indicador | Tempo até a primeira resposta de um agente ao cliente — pela tela ou pelo WhatsApp do celular, conta igual. A saudação automática não conta. Mediana (p50) e cauda (p90). | `atendimento.velocidade.frt_p50` | pronto |
| TMA | indicador | Tempo ativo do atendimento, de quando o agente assume até encerrar. Mediana (p50) e p90. | `atendimento.velocidade.tma_p50` | pronto |
| TMR | indicador | Tempo total da abertura ao encerramento da conversa. Mediana (p50) e p90. | `atendimento.velocidade.tmr_p50` | pronto |
| % dentro do SLA | indicador | Percentual de 1ªs respostas dentro do alvo de tempo configurado. | `atendimento.velocidade.sla_pct` | pronto |
| % SLA (horário útil) | indicador | % de 1ªs respostas dentro do alvo, medindo o tempo em horário útil — descontando o período fora do expediente entre a abertura e a resposta. | `atendimento.velocidade.sla_util_pct` | pronto |
| Não Atendido | indicador | % de atendimentos encerrados em que o time nunca respondeu o cliente. | `atendimento.velocidade.nao_atendido_pct` | pronto |
| SLA por setor | gráfico | Percentual de 1ªs respostas dentro do alvo de tempo configurado. | `atendimento.velocidade.por_departamento` | aguarda gráfico |
| Velocidade ao longo do tempo | gráfico |  | `atendimento.velocidade_timeline.self` | sem texto de ajuda |
| Distribuição de latência | gráfico |  | `atendimento.latencia.self` | sem texto de ajuda |
| Fila Agora | indicador | Conversas aguardando atendimento neste momento, dentro do horário comercial e ainda sem agente. | `atendimento.tempo_real.fila` | pronto |
| Espera Mais Antiga | indicador | Há quanto tempo aguarda o cliente que está esperando há mais tempo na fila. | `atendimento.tempo_real.espera_mais_antigo_seg` | pronto |
| Em Atendimento | indicador | Conversas sendo atendidas agora por um agente. | `atendimento.tempo_real.em_atendimento` | pronto |
| Agentes Online | indicador | Agentes com status ativo e heartbeat recente — conectados de fato neste momento. | `atendimento.tempo_real.agentes_online` | pronto |
| Estourando SLA | indicador | Conversas na fila (em horário) esperando há mais que o limite de SLA de 1ª resposta. | `atendimento.tempo_real.sla_estourando` | pronto |
| Parados > 24h | indicador | Conversas na fila aguardando há mais de 24 horas sem atendimento. | `atendimento.tempo_real.parados_24h` | pronto |
| Backlog aberto | indicador | Tickets em status não-terminal e não deletados, contados agora (independe do período do filtro). | `atendimento.backlog.abertos` | pronto |
| Órfãos | indicador | Tickets abertos sem responsável atribuído. | `atendimento.backlog.orfaos` | pronto |
| Parados (>7d) | indicador | Tickets abertos sem nenhuma atualização há mais de 7 dias. | `atendimento.backlog.parados` | pronto |
| Vencidos | indicador | Tickets abertos que já passaram da previsão de encerramento (previsao_encerramento). | `atendimento.backlog.vencidos` | pronto |
| Envelhecimento do backlog | gráfico |  | `atendimento.backlog.aging` | aguarda gráfico |
| Backlog por prioridade | gráfico |  | `atendimento.backlog.por_prioridade` | aguarda gráfico |
| Encerrados no Período | indicador | Total de atendimentos encerrados pela equipe no período selecionado. | `atendimento.agentes.total_encerrados` | pronto |
| Agentes Ativos | indicador | Número de agentes que atenderam ao menos um chat no período. | `atendimento.agentes.agentes_ativos` | pronto |
| CSAT da Equipe | indicador | Nota média de satisfação dos atendimentos avaliados no período. | `atendimento.agentes.csat_equipe` | pronto |
| Taxa de Reabertura | indicador | % dos atendimentos encerrados que foram reabertos (o problema voltou). | `atendimento.agentes.reabertura_equipe_pct` | pronto |
| Ranking de agentes | gráfico |  | `atendimento.agentes.agentes` | aguarda gráfico |
| CSAT Médio | indicador | Nota média de satisfação das avaliações respondidas no período (escala 0–5). | `atendimento.satisfacao.media` | pronto |
| Taxa de Resposta | indicador | % das pesquisas de CSAT enviadas que foram respondidas. | `atendimento.satisfacao.response_rate_pct` | pronto |
| Divergência CSAT × Sentimento | indicador | Atendimentos com sentimento negativo que mesmo assim receberam nota alta (≥4). | `atendimento.satisfacao.div_neg_nota_alta` | pronto |
| Atendeu na Hora | indicador | % de atendimentos encerrados resolvidos sem reabertura e sem virar ticket. | `atendimento.satisfacao.atendeu_na_hora_pct` | pronto |
| Distribuição das notas | gráfico | Nota média de satisfação das avaliações respondidas no período (escala 0–5). | `atendimento.satisfacao.distribuicao` | aguarda gráfico |
| URAs Enviadas | indicador | Atendimentos em que o menu automático (URA) foi enviado ao cliente. | `atendimento.ura.enviadas` | pronto |
| URA Concluída | indicador | % das URAs enviadas em que o cliente navegou o menu e foi roteado. | `atendimento.ura.completadas_pct` | pronto |
| Timeout / Fallback | indicador | % das URAs enviadas em que o cliente não respondeu e caiu direto para o humano. | `atendimento.ura.timeout_pct` | pronto |
| URA Confusa | indicador | % das URAs enviadas em que o cliente digitou ao menos uma opção inválida. | `atendimento.ura.confusas_pct` | pronto |
| Total de Tickets | indicador | Tickets abertos no período (mundo de tickets, não chats). | `atendimento.taxonomia.total` | pronto |
| Produtos com Tickets | indicador | Distribuição dos tickets pelo produto associado. | `atendimento.taxonomia.por_produto` | pronto |
| Categorias Ativas | indicador | Distribuição dos tickets por categoria de serviço, com peso (%) no total. | `atendimento.taxonomia.por_categoria` | pronto |
| Tickets por categoria | gráfico | Distribuição dos tickets por categoria de serviço, com peso (%) no total. | `atendimento.taxonomia.por_categoria` | aguarda gráfico |
| Mapa de calor de tickets | gráfico |  | `atendimento.taxonomia.heatmap` | aguarda gráfico |
| Maiores ofensores | gráfico |  | `atendimento.taxonomia.ofensores` | aguarda gráfico |
| Clientes atendidos | indicador | Quantidade de clientes distintos com pelo menos um chat ou ticket no período (apenas atendimentos com cliente vinculado). | `atendimento.clientes.totais.clientes` | pronto |
| MRR coberto | indicador | Soma do MRR ativo (cliente_produtos.vlr_mensal onde ativo=true) dos clientes que apareceram no atendimento no período. | `atendimento.clientes.totais.mrr_coberto` | pronto |
| Risco alto | indicador | Contagem de até 4 sinais de risco por cliente: (1) densidade de suporte acima de N× a média do tenant, (2) % de chats com sentimento negativo acima do limiar, (3) reincidência de categorias de ticket, (4) CSAT médio abaixo do limiar (só quando há nota suficiente). 0 = Baixo, 1–2 = Médio, 3–4 = Alto. | `atendimento.clientes.totais.risco_alto` | pronto |
| Ofensor #1 | indicador | Cliente com maior densidade de suporte no período (interações por R$1k de MRR, respeitando o piso de R$ 50). | `atendimento.clientes.clientes` | pronto |

## Financeiro / MRR

| Item | Tipo | O que é | Origem | Situação |
|---|---|---|---|---|
| MRR Atual | indicador | Receita mensal recorrente total dos clientes ativos neste momento. | `financeiro.dashboard.mrr` | pronto |
| Clientes Ativos | indicador | Quantidade total de clientes que não estão cancelados. | `financeiro.dashboard.clientesAtivos` | pronto |
| Ticket Médio | indicador | Receita média mensal por cliente ativo. | `financeiro.dashboard.ticketMedio` | pronto |
| ARR | indicador | Projeção anual da receita recorrente, assumindo que o MRR atual se mantém por 12 meses. | `financeiro.dashboard.arr` | pronto |
| Faturamento total | indicador |  | `financeiro.dashboard.faturamentoTotal` | sem texto de ajuda |
| Rule of 40 | indicador | Soma do crescimento percentual com a margem de contribuição percentual. Métrica de saúde geral que junta crescimento + rentabilidade num único número. | `financeiro.crescimento.ruleOf40` | pronto |
| CAC Payback | indicador | Tempo necessário para recuperar o investimento feito para adquirir um cliente, considerando a margem (MRR - COGS). | `financeiro.dashboard.cacPayback` | pronto |
| LTV / CAC | indicador | Quantas vezes o valor do cliente supera o custo de adquiri-lo. | `financeiro.dashboard.ltvCac` | pronto |
| Tenure Médio | indicador | Tempo médio em meses que os clientes ativos estão na carteira, contado desde a primeira venda registrada. | `financeiro.visao_geral.tenureMedio` | pronto |
| NRR | indicador | Quanto da receita do início do período foi mantida, incluindo expansões e contrações. | `financeiro.dashboard.nrr` | pronto |
| GRR | indicador | Quanto da receita do início do período foi mantida, desconsiderando expansões. | `financeiro.dashboard.grr` | pronto |
| Concentração Top 10 | indicador | Percentual do MRR total que vem dos 10 maiores clientes. | `financeiro.dashboard.concentracaoTop10` | pronto |
| Quick Ratio | indicador | Razão entre MRR adicionado e MRR perdido. Mede a saúde do crescimento. | `financeiro.dashboard.quickRatio` | pronto |
| LTV (meses) | indicador |  | `financeiro.dashboard.ltvMeses` | sem texto de ajuda |
| LTV (R$) | indicador |  | `financeiro.dashboard.ltvReais` | sem texto de ajuda |
| CAC | indicador |  | `financeiro.dashboard.cac` | sem texto de ajuda |
| Margem de contribuição | indicador |  | `financeiro.dashboard.margemContribuicao` | sem texto de ajuda |
| Receita por funcionário | indicador |  | `financeiro.dashboard.revenuePerFuncionario` | sem texto de ajuda |
| Evolução do MRR · 12 meses | gráfico | Receita mensal recorrente total dos clientes ativos neste momento. | `financeiro.visao_geral.mrrSeries` | aguarda gráfico |
| Net New MRR | indicador | Variação líquida da receita recorrente no período — quanto o MRR cresceu ou encolheu. | `financeiro.dashboard.netNewMrr` | pronto |
| Growth Rate MoM | indicador | Taxa de crescimento do MRR mês a mês. | `financeiro.crescimento.growthRateMoM` | pronto |
| Growth Rate QoQ | indicador |  | `financeiro.crescimento.growthRateQoQ` | sem texto de ajuda |
| Growth Rate YoY | indicador |  | `financeiro.crescimento.growthRateYoY` | sem texto de ajuda |
| ARR Growth YoY | indicador | Crescimento percentual do ARR comparado ao mesmo mês do ano anterior. | `financeiro.crescimento.arrGrowthYoY` | pronto |
| Growth Persistence | indicador | Razão entre o crescimento dos últimos 12 meses e o crescimento dos 12 meses anteriores. Métrica Bessemer Cloud Index. | `financeiro.crescimento.growthPersistence` | pronto |
| Expansion Rate | indicador | Percentual do MRR adicionado no mês que veio da BASE EXISTENTE (upsell + cross-sell + reativação + reajuste) — não de novas vendas. | `financeiro.crescimento.expansionRate` | pronto |
| Net Logo Growth | indicador | Variação líquida de clientes no período: novos menos cancelados, em valor absoluto. | `financeiro.crescimento.netLogoGrowth` | pronto |
| Logo Growth Rate | indicador | Taxa de crescimento percentual da base de clientes (logos), independente do ticket. | `financeiro.crescimento.logoGrowthRate` | pronto |
| ARPA — clientes novos | indicador |  | `financeiro.crescimento.arpaNovo` | sem texto de ajuda |
| ARPA — base atual | indicador |  | `financeiro.crescimento.arpaBase` | sem texto de ajuda |
| CAC por Logo | indicador | Custo unitário para adquirir um novo cliente. | `financeiro.dashboard.cac` | pronto |
| Burn Multiple | indicador | Quanto a empresa gasta em CAC para cada R$ de Net New MRR gerado. Métrica de eficiência de capital criada por David Sacks (Craft Ventures) em 2022. | `financeiro.crescimento.burnMultiple` | pronto |
| Magic Number | indicador | Eficiência da máquina de vendas: quanto de ARR é gerado para cada R$ gasto em CAC. Criada por Mamoon Hamid (Kleiner Perkins). | `financeiro.crescimento.magicNumber` | pronto |
| Reativações | indicador |  | `financeiro.crescimento.reativacoesQtd` | sem texto de ajuda |
| MRR reativado | indicador |  | `financeiro.crescimento.reativacoesMrr` | sem texto de ajuda |
| Net New — média 3 meses | indicador |  | `financeiro.crescimento.netNewHistorico.media3m` | sem texto de ajuda |
| Net New — média 12 meses | indicador |  | `financeiro.crescimento.netNewHistorico.media12m` | sem texto de ajuda |
| Upsell | indicador |  | `financeiro.dashboard.upsellMrr` | sem texto de ajuda |
| Cross-sell | indicador |  | `financeiro.dashboard.crossSellMrr` | sem texto de ajuda |
| Downsell | indicador |  | `financeiro.dashboard.downsellMrr` | sem texto de ajuda |
| Reajuste | indicador |  | `financeiro.dashboard.reajusteMrr` | sem texto de ajuda |
| Composição do Net New MRR | gráfico | Variação líquida da receita recorrente no período — quanto o MRR cresceu ou encolheu. | `financeiro.crescimento.netNewHistorico` | aguarda gráfico |
| MRR com projeção de 90 dias | gráfico |  | `financeiro.crescimento.mrrForecast` | aguarda gráfico |
| Novos Clientes | indicador | Clientes cadastrados no período selecionado que estão ativos. | `financeiro.dashboard.novosClientes` | pronto |
| New MRR | indicador | Soma das mensalidades dos novos clientes vendidos no período. | `financeiro.dashboard.newMrr` | pronto |
| Receita de Ativação | indicador | Todo setup/implantação cobrado no período: o dos novos clientes mais o lançado em movimentos de MRR (upsell e cross-sell com taxa de ativação). | `financeiro.dashboard.receitaAtivacao` | pronto |
| Total de implantação | indicador |  | `financeiro.dashboard.totalImplantacao` | sem texto de ajuda |
| Ticket Médio (Novos) | indicador | Mensalidade média dos clientes vendidos no período. | `financeiro.dashboard.newMrr` | pronto |
| MRR Adicionado | indicador | Toda receita recorrente nova no período: vendas + upsell + cross-sell. | `financeiro.dashboard.newMrr` | pronto |
| Setup Médio | indicador | Valor médio cobrado de implantação por novo cliente. | `financeiro.dashboard.totalImplantacao` | pronto |
| Cancelamentos (Qtde) | indicador | Número de clientes que cancelaram no período selecionado. | `financeiro.cancelamentos.cancelamentosQtd` | pronto |
| MRR Perdido (bruto) | indicador | Soma das mensalidades dos clientes que cancelaram, mais reversões de movimentos. | `financeiro.cancelamentos.mrrCancelado` | pronto |
| MRR perdido (líquido) | indicador |  | `financeiro.cancelamentos.mrrLiquidoPerdido` | sem texto de ajuda |
| Churn Rate (Carteira) | indicador | Percentual de clientes perdidos no período em relação à base ativa no início dele. Em período de mais de um mês o número é ACUMULADO — a média por mês aparece no rodapé do card. | `financeiro.cancelamentos.churnRateLogo` | pronto |
| Churn Rate (Receita) | indicador | Percentual de receita recorrente perdida (cancelamento + downsell) em relação ao MRR no início do período. Em período de mais de um mês o número é ACUMULADO — a média por mês aparece no rodapé do card. | `financeiro.cancelamentos.churnRateMrr` | pronto |
| Early churn (qtde) | indicador |  | `financeiro.cancelamentos.earlyChurnQtd` | sem texto de ajuda |
| Early churn (taxa) | indicador |  | `financeiro.cancelamentos.earlyChurnRate` | sem texto de ajuda |
| Winback 12 meses | indicador |  | `financeiro.cancelamentos.winbackRate12m` | sem texto de ajuda |
| Tempo de casa ao cancelar | indicador |  | `financeiro.cancelamentos.tenureMedioCancDias` | sem texto de ajuda |
| CAC perdido | indicador |  | `financeiro.cancelamentos.cacPerdido` | sem texto de ajuda |
| Churn por categoria | gráfico |  | `financeiro.cancelamentos.categorias` | aguarda gráfico |
| Churn por tempo de casa | gráfico |  | `financeiro.cancelamentos.buckets` | aguarda gráfico |
| Principais motivos de cancelamento | gráfico |  | `financeiro.cancelamentos.topMotivos` | aguarda gráfico |

## Customer Success

| Item | Tipo | O que é | Origem | Situação |
|---|---|---|---|---|
| Tickets Abertos | indicador | Quantidade de tickets de CS criados no período selecionado. | `cs.dashboard.ticketsAbertos` | pronto |
| Tickets Concluídos | indicador | Quantidade de tickets concluídos ou cancelados no período. | `cs.dashboard.ticketsFechados` | pronto |
| Vencendo SLA | indicador | Tickets com SLA de primeira ação ou conclusão prestes a vencer (janela curta antes do estouro). | `cs.dashboard.vencendoSlaAcao` | pronto |
| Vencidos SLA | indicador | Tickets que ultrapassaram o prazo definido para primeira ação ou conclusão. | `cs.dashboard.vencidosSlaAcao` | pronto |
| Reaberturas | indicador |  | `cs.dashboard.reaberturas` | sem texto de ajuda |
| % Higiene | indicador | Percentual de tickets abertos que possuem próxima ação E data de follow-up preenchidas. | `cs.dashboard.percentHigiene` | pronto |
| Tempo até a 1ª ação | indicador |  | `cs.dashboard.tempoAteAcaoMediana` | sem texto de ajuda |
| Tempo até a conclusão | indicador |  | `cs.dashboard.tempoAteConclusaoMediana` | sem texto de ajuda |
| Tickets por situação | gráfico |  | `cs.dashboard.backlogPorStatus` | aguarda gráfico |
| Tickets por prioridade | gráfico |  | `cs.dashboard.backlogPorPrioridade` | aguarda gráfico |
| Clientes em Risco | indicador | Clientes com tickets de tipo 'Risco de Churn' abertos ou em andamento. | `cs.dashboard.clientesEmRisco` | pronto |
| MRR em Risco | indicador | Soma do MRR dos clientes com tickets de risco de churn abertos. | `cs.dashboard.mrrEmRisco` | pronto |
| MRR Recuperado | indicador | MRR de clientes que estavam em risco e foram retidos (ticket concluído como retido). | `cs.dashboard.mrrRecuperado` | pronto |
| % de risco com plano de ação | indicador |  | `cs.dashboard.percentRiscoComPlano` | sem texto de ajuda |
| Desfecho dos clientes em risco | gráfico |  | `cs.dashboard.resultadoRisco` | aguarda gráfico |
| Clientes Ativos | indicador | Quantidade total de clientes que não estão cancelados. | `cs.dashboard.cobertura90d.totalAtivos` | pronto |
| % Cobertura 90D | indicador | Percentual de clientes ativos que tiveram ao menos um contato (ticket) nos últimos 90 dias. | `cs.dashboard.cobertura90d.percentCoberto` | pronto |
| Descobertos | indicador | Clientes ativos que não tiveram nenhum contato (ticket) nos últimos 90 dias. | `cs.dashboard.cobertura90d.descobertos` | pronto |
| Indicações ganhas | indicador |  | `cs.dashboard.indicacoesGanhas` | sem texto de ajuda |
| Indicações perdidas | indicador |  | `cs.dashboard.indicacoesPerdidas` | sem texto de ajuda |
| Conversão das indicações | indicador |  | `cs.dashboard.indicacoesConversaoPercent` | sem texto de ajuda |
| Funil de indicações | gráfico |  | `cs.dashboard.pipelineIndicacao` | aguarda gráfico |
| Oportunidades abertas | indicador |  | `cs.dashboard.oportunidadesAbertas` | sem texto de ajuda |
| Oportunidades ganhas | indicador |  | `cs.dashboard.oportunidadesGanhas` | sem texto de ajuda |
| Conversão das oportunidades | indicador |  | `cs.dashboard.oportunidadesConversaoPercent` | sem texto de ajuda |
| MRR previsto em oportunidades | indicador |  | `cs.dashboard.oportunidadesValorPrevistoMrr` | sem texto de ajuda |
| MRR ganho em oportunidades | indicador |  | `cs.dashboard.oportunidadesValorGanhoMrr` | sem texto de ajuda |

## Implantação

| Item | Tipo | O que é | Origem | Situação |
|---|---|---|---|---|
| Jornadas em aberto | indicador |  | `implantacao.dash.situacao.emAberto` | sem texto de ajuda |
| Jornadas concluídas | indicador |  | `implantacao.dash.situacao.concluidas` | sem texto de ajuda |
| Jornadas canceladas | indicador |  | `implantacao.dash.situacao.canceladas` | sem texto de ajuda |
| Jornadas paradas | indicador |  | `implantacao.dash.situacao.paradas` | sem texto de ajuda |
| Jornadas não iniciadas | indicador |  | `implantacao.dash.situacao.naoIniciadas` | sem texto de ajuda |
| Tempo total | indicador |  | `implantacao.dash.tempos.total` | sem texto de ajuda |
| Tempo de onboarding | indicador |  | `implantacao.dash.tempos.onboarding` | sem texto de ajuda |
| Tempo de implantação | indicador |  | `implantacao.dash.tempos.implantacao` | sem texto de ajuda |
| 1º contato com o cliente | indicador |  | `implantacao.dash.tempos.primeiroContato` | sem texto de ajuda |
| No prazo · bruto | indicador |  | `implantacao.dash.sla.pctC` | sem texto de ajuda |
| No prazo · efetivo | indicador |  | `implantacao.dash.sla.pctE` | sem texto de ajuda |
| Tempo parado | indicador |  | `implantacao.dash.sla.parado` | sem texto de ajuda |
| Ciclo médio · efetivo | indicador |  | `implantacao.dash.sla.cicloE` | sem texto de ajuda |
| Treinos realizados | indicador |  | `implantacao.dash.treinos.realizado` | sem texto de ajuda |
| % Realizado | indicador |  | `implantacao.dash.treinos.realizadoPct` | sem texto de ajuda |
| Faltas | indicador |  | `implantacao.dash.treinos.faltas` | sem texto de ajuda |
| Taxa de no-show | indicador |  | `implantacao.dash.treinos.noShowRate` | sem texto de ajuda |
| % Retreinamento | indicador |  | `implantacao.dash.treinos.retreinosPct` | sem texto de ajuda |
| Proprietário presente | indicador |  | `implantacao.dash.treinos.propPct` | sem texto de ajuda |
| Total PDV finalizados | indicador |  | `implantacao.dash.treinos.pdvFinalizados` | sem texto de ajuda |
| Total de retornos | indicador |  | `implantacao.dash.retornos.total` | sem texto de ajuda |
| Atribuíveis ao vendedor | indicador |  | `implantacao.dash.retornos.atribuiveisVendedor` | sem texto de ajuda |
| Retornos em aberto | indicador |  | `implantacao.dash.retornos.emAberto` | sem texto de ajuda |
| Jornadas por etapa | gráfico |  | `implantacao.dash.porEtapa` | aguarda gráfico |
| Cumprimento de SLA por etapa | gráfico |  | `implantacao.dash.sla.porEtapa` | aguarda gráfico |
| Jornadas por responsável | gráfico |  | `implantacao.dash.porResponsavel` | aguarda gráfico |

## Certificados A1

| Item | Tipo | O que é | Origem | Situação |
|---|---|---|---|---|
| Vendas no Período | indicador | Quantidade de certificados A1 vendidos no período (status 'ganho'). | `certificados.a1.vendasQtd` | pronto |
| Faturamento A1 | indicador | Soma dos valores de certificados A1 vendidos no período. | `certificados.a1.faturamento` | pronto |
| Perdido p/ Terceiro | indicador | Quantidade de renovações de certificado A1 perdidas para concorrentes no período. | `certificados.a1.perdidoTerceiroQtd` | pronto |
| Oportunidades (Janela) | indicador | Clientes com certificado A1 vencendo entre -20 e +30 dias da data atual. | `certificados.a1.oportunidadesJanela` | pronto |
| Vencendo em 30 dias | indicador | Clientes ativos com certificado A1 vencendo nos próximos 30 dias. | `certificados.a1.oportunidadesVencendo` | pronto |
| Vencidos até 20 dias | indicador | Clientes ativos com certificado A1 vencido nos últimos 20 dias. | `certificados.a1.oportunidadesVencidas` | pronto |

## Itens sem texto de ajuda (80)

No painel aparecem sem o "?". Escrever o verbete é decisão sua, item a item.

- `at.backlog_aging`
- `at.backlog_por_prioridade`
- `at.latencia_histograma`
- `at.ranking_agentes`
- `at.tax_heatmap`
- `at.tax_ofensores`
- `at.velocidade_timeline`
- `at.volume_canais`
- `at.volume_heatmap`
- `cs.backlog_por_prioridade`
- `cs.backlog_por_status`
- `cs.indicacoes_conversao`
- `cs.indicacoes_ganhas`
- `cs.indicacoes_perdidas`
- `cs.oportunidades_abertas`
- `cs.oportunidades_conversao`
- `cs.oportunidades_ganhas`
- `cs.oportunidades_mrr_ganho`
- `cs.oportunidades_mrr_previsto`
- `cs.pipeline_indicacao`
- `cs.reaberturas`
- `cs.resultado_risco`
- `cs.risco_com_plano`
- `cs.tempo_ate_acao`
- `cs.tempo_ate_conclusao`
- `fin.arpa_base`
- `fin.arpa_novo`
- `fin.cac`
- `fin.cac_perdido`
- `fin.churn_por_categoria`
- `fin.churn_por_tempo_casa`
- `fin.churn_top_motivos`
- `fin.cross_sell_mrr`
- `fin.downsell_mrr`
- `fin.early_churn_qtd`
- `fin.early_churn_rate`
- `fin.faturamento_total`
- `fin.growth_rate_qoq`
- `fin.growth_rate_yoy`
- `fin.ltv_meses`
- `fin.ltv_reais`
- `fin.margem_contribuicao`
- `fin.mrr_forecast`
- `fin.mrr_liquido_perdido`
- `fin.net_new_media_12m`
- `fin.net_new_media_3m`
- `fin.reajuste_mrr`
- `fin.reativacoes_mrr`
- `fin.reativacoes_qtd`
- `fin.receita_por_funcionario`
- `fin.tenure_medio_cancelados`
- `fin.total_implantacao`
- `fin.upsell_mrr`
- `fin.winback_rate`
- `imp.jornadas_canceladas`
- `imp.jornadas_concluidas`
- `imp.jornadas_em_aberto`
- `imp.jornadas_nao_iniciadas`
- `imp.jornadas_paradas`
- `imp.jornadas_por_etapa`
- `imp.pdv_finalizados`
- `imp.por_responsavel`
- `imp.primeiro_contato`
- `imp.retornos_em_aberto`
- `imp.retornos_total`
- `imp.retornos_vendedor`
- `imp.sla_ciclo_efetivo`
- `imp.sla_no_prazo_bruto`
- `imp.sla_no_prazo_efetivo`
- `imp.sla_por_etapa`
- `imp.sla_tempo_parado`
- `imp.tempo_implantacao`
- `imp.tempo_onboarding`
- `imp.tempo_total`
- `imp.treinos_faltas`
- `imp.treinos_no_show`
- `imp.treinos_pct_realizado`
- `imp.treinos_proprietario`
- `imp.treinos_realizados`
- `imp.treinos_retreinamento`

## Verbetes do kpiHelp que nenhuma tela usa (84)

Cada um é uma decisão: criar o indicador, ou apagar o verbete.

- `arpa` — ARPA (mês)
- `arpa_novo_vs_base` — ARPA: Novo vs Base
- `atendimento_ag_csat` — CSAT do Agente
- `atendimento_ag_encerrados` — Encerrados (Encerr.)
- `atendimento_ag_faixa` — Faixa Mais Comum
- `atendimento_ag_frt` — 1ª Resposta
- `atendimento_ag_latencia` — Latência de Resposta
- `atendimento_ag_msgs` — Mensagens por Atendimento
- `atendimento_ag_pico` — Pico de Simultâneos
- `atendimento_ag_reabertura` — Taxa de Reabertura
- `atendimento_ag_tma` — TMA — Tempo de Atendimento
- `atendimento_ag_total` — Atendimentos (Atend.)
- `atendimento_atendendo_agente` — Atendendo por Agente
- `atendimento_ativos_depto` — Ativos por Departamento
- `atendimento_backlog_aging` — Aging do backlog
- `atendimento_backlog_plantao` — Plantão por produto
- `atendimento_backlog_prioridade` — Backlog por prioridade
- `atendimento_backlog_status` — Backlog por status
- `atendimento_canais` — Canais de Abertura
- `atendimento_cli_densidade` — Densidade de suporte (int/R$1k MRR)
- `atendimento_cob_chats` — Chats (todos os tenants)
- `atendimento_cob_cliente` — % com cliente vinculado
- `atendimento_cob_maturidade` — Maturidade de dados por tenant
- `atendimento_cob_tenants` — Tenants ativos
- `atendimento_cob_ticket` — % que vira ticket
- `atendimento_csat_distribuicao` — Distribuição de Notas
- `atendimento_csat_por_agente` — CSAT por Agente
- `atendimento_heatmap` — Mapa de Calor (hora × dia)
- `atendimento_resol_csat` — Resolução por Nota
- `atendimento_scorecard` — Scorecard por Agente
- `atendimento_tax_densidade` — Densidade por Produto
- `atendimento_ura_funil` — Funil da URA
- `ativacao_media_novos` — Ativação Média (novos)
- `benchmark_cohort_70` — Benchmark 70% (Cohort)
- `cac_burn` — CAC Burn (mês)
- `cohort_curva_retencao` — Curva de Retenção
- `cohort_melhor` — Melhor Coorte
- `cohort_pior` — Pior Coorte
- `cohort_retencao_media` — Retenção Média (Cohort)
- `crescimento_percent` — Crescimento %
- `crescimento_reais` — Crescimento R$
- `cs_ganho_ativacao` — Ganho Ativação
- `cs_ganho_mrr` — Ganho MRR
- `cs_indicacoes_conversao` — % Conversão de Indicações
- `cs_indicacoes_ganhas` — Indicações Ganhas
- `cs_indicacoes_perdidas` — Indicações Perdidas
- `cs_oportunidades_abertas` — Oportunidades Abertas
- `cs_oportunidades_conversao` — % Conversão de Oportunidades
- `cs_oportunidades_ganhas` — Oportunidades Ganhas
- `cs_oportunidades_perdidas` — Oportunidades Perdidas
- `cs_percent_risco_com_plano` — % Com Plano de Ação
- `cs_previsao_ativacao` — Previsão Ativação
- `cs_previsao_mrr` — Previsão MRR
- `cs_reaberturas` — Reaberturas
- `cs_tempo_1a_acao_media` — Tempo 1ª Ação (Média)
- `cs_tempo_1a_acao_mediana` — Tempo 1ª Ação (Mediana)
- `cs_tempo_conclusao_media` — Tempo Conclusão (Média)
- `ef_cogs` — Custo Operação (COGS)
- `ef_custos_fixos` — Custos Fixos
- `ef_fator_preco` — Fator Preço
- `ef_impostos` — Impostos
- `ef_lucro_real` — Lucro Real
- `ef_lucro_real_percent` — Lucro Real %
- `ef_margem_contribuicao` — Margem de Contribuição
- `ef_markup_cogs` — Markup COGS
- `ef_mc_percent` — MC %
- `ef_receita_apos_cogs` — Receita após COGS
- `ef_receita_mrr` — Receita (MRR Atual)
- `ltv_cac_3m` — LTV/CAC (Janela 3M)
- `ltv_cac_6m` — LTV/CAC (Janela 6M)
- `ltv_meses` — LTV (meses)
- `ltv_recorrente_margem` — LTV Recorrente (R$)
- `margem_nova_rs` — Margem nova (R$)
- `margem_pct_nova` — Margem % nova
- `mc_media_cliente` — MC Média / Cliente
- `mc_percent_ponderada` — MC% Ponderada
- `mc_total` — MC Total (R$)
- `mrr_forecast_90d` — Forecast MRR (próximos 90 dias)
- `mrr_vs_ano` — MRR vs Ano Anterior
- `mrr_vs_semestre` — MRR vs Último Semestre
- `mrr_vs_trimestre` — MRR vs Último Trimestre
- `novos_clientes_mes` — Novos Clientes (mês)
- `reativacoes_periodo` — Reativações no Período
- `retencao_cohort` — Retenção Cohort
