export type BenchmarkStatus = 'ok' | 'warn' | 'crit';

export interface BenchmarkZone {
  status: BenchmarkStatus;
  label: string;
  display: string;
  range_min?: number;
  range_max?: number;
}

export type KpiUnit = 'meses' | 'x' | '%' | 'R$' | 'pp' | 'count' | 'pts';

export interface KpiHelpEntry {
  title: string;
  definition: string;
  why_it_matters: string;
  formula: string;
  example?: string;
  unit?: KpiUnit;
  benchmark?: BenchmarkZone[];
  how_to_improve?: string[];
}

const kpiHelp: Record<string, KpiHelpEntry> = {
  mrr_snapshot: {
    title: "MRR ATUAL",
    definition: "Receita mensal recorrente total dos clientes ativos neste momento.",
    why_it_matters: "É a principal métrica de receita de um SaaS. Se sobe, a empresa cresce; se desce, está perdendo receita.",
    formula: "Σ mensalidade de todos os clientes onde cancelado = false",
    example: "100 clientes × R$ 200 = MRR de R$ 20.000",
  },
  net_new_mrr: {
    title: "Net New MRR",
    definition: "Variação líquida da receita recorrente no período — quanto o MRR cresceu ou encolheu.",
    why_it_matters: "Mostra se a empresa está crescendo (positivo) ou encolhendo (negativo) em receita recorrente.",
    formula: "New MRR + Upsell + Cross-sell − Downsell − Churn MRR",
  },
  arr: {
    title: "ARR (Receita Anual Recorrente)",
    definition: "Projeção anual da receita recorrente, assumindo que o MRR atual se mantém por 12 meses.",
    why_it_matters: "É o indicador padrão para avaliar o porte e o valuation de empresas SaaS.",
    formula: "MRR × 12",
    example: "MRR R$ 50.000 → ARR R$ 600.000",
  },
  ticket_medio: {
    title: "Ticket Médio (ARPU)",
    definition: "Receita média mensal por cliente ativo.",
    why_it_matters: "Ticket subindo indica que você está vendendo mais valor; descendo pode indicar diluição por clientes pequenos.",
    formula: "MRR ÷ Clientes Ativos",
  },
  clientes_ativos: {
    title: "Clientes Ativos",
    definition: "Quantidade total de clientes que não estão cancelados.",
    why_it_matters: "Base do negócio. Crescimento saudável requer aumento consistente desse número.",
    formula: "COUNT(clientes) onde cancelado = false",
  },
  cancelamentos_qtd: {
    title: "Cancelamentos (Qtde)",
    definition: "Número de clientes que cancelaram no período selecionado.",
    why_it_matters: "Cada cancelamento reduz a base e o MRR. Monitorar ajuda a identificar problemas de retenção.",
    formula: "COUNT(clientes) com data_cancelamento no período",
  },
  mrr_cancelado: {
    title: "MRR Cancelado",
    definition: "Soma das mensalidades dos clientes que cancelaram, mais reversões de movimentos.",
    why_it_matters: "Mostra o impacto financeiro real dos cancelamentos. Pode ser maior que a soma das mensalidades se havia movimentos ativos.",
    formula: "Σ mensalidade dos cancelados + reversões de movimentos MRR",
  },
  churn_rate_carteira: {
    title: "Churn Rate (Carteira)",
    definition: "Percentual de clientes perdidos em relação à base total no período.",
    why_it_matters: "Se o churn sobe, a empresa precisa vender cada vez mais só para manter o tamanho. Meta: < 2% ao mês.",
    formula: "Cancelamentos ÷ (Clientes Ativos + Cancelados)",
    example: "5 cancelamentos ÷ 200 base = 2,5%",
    unit: "%",
    benchmark: [
      { status: 'ok',   label: 'OK',      display: '< 2%',    range_max: 0.02 },
      { status: 'warn', label: 'Atenção', display: '2–5%',    range_min: 0.02, range_max: 0.05 },
      { status: 'crit', label: 'Crítico', display: '> 5%',    range_min: 0.05 },
    ],
    how_to_improve: [
      "Auditar causa-raiz dos cancelados do período (preço, produto, atendimento)",
      "Health score com alertas antes do cancelamento",
      "Programa de retenção com ofertas personalizadas",
      "Melhorar onboarding para reduzir Early Churn"
    ],
  },
  churn_rate_receita: {
    title: "Churn Rate (Receita)",
    definition: "Percentual de receita recorrente perdida em relação ao MRR total.",
    why_it_matters: "Mais importante que churn de carteira: se perde clientes grandes, o impacto financeiro é maior.",
    formula: "MRR Cancelado ÷ (MRR Atual + MRR Cancelado)",
    unit: "%",
    benchmark: [
      { status: 'ok',   label: 'OK',      display: '< 1%',    range_max: 0.01 },
      { status: 'warn', label: 'Atenção', display: '1–3%',    range_min: 0.01, range_max: 0.03 },
      { status: 'crit', label: 'Crítico', display: '> 3%',    range_min: 0.03 },
    ],
    how_to_improve: [
      "Foco em retenção dos clientes Top 20 (impacto financeiro maior)",
      "Análise de cancelados por ticket — clientes grandes saindo é crítico",
      "Política de retenção diferenciada para contas de alto valor",
      "Account managers dedicados para clientes acima de threshold"
    ],
  },
  mc_total: {
    title: "MC Total (R$)",
    definition: "Margem de contribuição total — quanto sobra da receita após pagar o custo operacional (COGS).",
    why_it_matters: "Se MC é positiva, cada cliente contribui para o lucro. Se negativa, a operação perde dinheiro a cada venda.",
    formula: "MRR − COGS",
  },
  mc_percent_ponderada: {
    title: "MC% Ponderada",
    definition: "Margem de contribuição como percentual da receita, ponderada pelo valor de cada cliente.",
    why_it_matters: "Indica a eficiência financeira da operação. Meta saudável: acima de 60%. Abaixo de 30% é crítico.",
    formula: "MC Total ÷ MRR Total",
    example: "MC R$ 100.000 ÷ MRR R$ 150.000 = 66,7%",
    unit: "%",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 30%',   range_max: 0.30 },
      { status: 'warn', label: 'Atenção', display: '30–60%',  range_min: 0.30, range_max: 0.60 },
      { status: 'ok',   label: 'OK',      display: '≥ 60%',   range_min: 0.60 },
    ],
    how_to_improve: [
      "Renegociar contratos com fornecedores (COGS)",
      "Eliminar produtos/módulos com margem negativa",
      "Aumentar pricing em segmentos premium",
      "Automatizar operação para reduzir custo variável por cliente"
    ],
  },
  mc_media_cliente: {
    title: "MC Média / Cliente",
    definition: "Quanto de margem de contribuição cada cliente gera, em média.",
    why_it_matters: "Ajuda a entender se novos clientes estão sendo rentáveis individualmente.",
    formula: "MC Total ÷ Clientes Ativos",
  },
  cac_burn: {
    title: "CAC Burn (mês)",
    definition: "Total gasto em aquisição de clientes no mês — soma de todas as despesas de CAC vigentes.",
    why_it_matters: "Mostra quanto a empresa investe para conseguir novos clientes. Deve ser menor que a receita gerada por eles.",
    formula: "Σ valor_alocado de despesas CAC com mes_inicial ≤ mês ≤ mes_final",
  },
  novos_clientes_mes: {
    title: "Novos Clientes (mês)",
    definition: "Quantidade de clientes que entraram (data de venda) no mês.",
    why_it_matters: "Denominador do CAC por Logo. Sem novos clientes, o CAC fica infinito.",
    formula: "COUNT(clientes) com data_venda no mês",
  },
  cac_por_logo: {
    title: "CAC por Logo",
    definition: "Custo unitário para adquirir um novo cliente.",
    why_it_matters: "Deve ser menor que o LTV do cliente para o negócio ser sustentável. Quanto menor, mais eficiente a aquisição.",
    formula: "CAC Burn ÷ Novos Clientes do mês",
    example: "R$ 10.000 gastos ÷ 5 novos = R$ 2.000 por cliente",
  },
  ltv_meses: {
    title: "LTV (meses)",
    definition: "Tempo médio estimado que um cliente permanece ativo, baseado no churn atual.",
    why_it_matters: "Quanto maior, mais tempo o cliente gera receita. Teto de 120 meses quando churn = 0.",
    formula: "1 ÷ Churn Rate mensal (teto: 120 meses)",
    example: "Churn 2% → LTV = 1 ÷ 0,02 = 50 meses",
  },
  ltv_recorrente_margem: {
    title: "LTV Recorrente (R$)",
    definition: "Receita líquida total esperada de um cliente ao longo de sua vida, considerando a margem de contribuição (MRR - COGS).",
    why_it_matters: "É o valor real que o cliente traz. Deve ser pelo menos 3x o CAC para o negócio ser saudável.",
    formula: "ARPA × MC% × LTV (meses)",
  },
  ltv_cac_recorrente: {
    title: "LTV/CAC Recorrente",
    definition: "Quantas vezes o valor do cliente supera o custo de adquiri-lo.",
    why_it_matters: "≥ 3x = saudável; entre 1x e 3x = atenção; < 1x = a empresa perde dinheiro a cada cliente.",
    formula: "LTV Recorrente (R$) ÷ CAC por Logo",
    example: "LTV R$ 9.000 ÷ CAC R$ 3.000 = 3x",
    unit: "x",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 1x',  range_max: 1 },
      { status: 'warn', label: 'Atenção', display: '1–3x',  range_min: 1, range_max: 3 },
      { status: 'ok',   label: 'OK',      display: '≥ 3x',  range_min: 3 },
    ],
    how_to_improve: [
      "Aumentar LTV: reduzir churn, aumentar tenure, aumentar ARPA via upsell",
      "Reduzir CAC: otimizar funil, focar em canais com menor CPL",
      "Aumentar MC%: reduzir COGS, eliminar SKUs deficitários",
      "Priorizar retenção sobre aquisição quando LTV/CAC < 3x"
    ],
  },
  ativacao_media_novos: {
    title: "Ativação Média (novos)",
    definition: "Valor médio cobrado de setup/implantação nos novos clientes do mês.",
    why_it_matters: "Receita pontual que ajuda a cobrir o CAC. Não entra no ARPA nem no LTV recorrente.",
    formula: "Média de valor_ativacao dos novos clientes do mês",
  },
  retencao_cohort: {
    title: "Retenção Cohort",
    definition: "Percentual de clientes de um grupo (cohort) que ainda estão ativos após N meses.",
    why_it_matters: "Revela em qual momento os clientes mais cancelam. M1 baixo indica problema de onboarding.",
    formula: "Clientes retidos no mês N ÷ Tamanho original do cohort × 100",
    example: "Cohort Jan: 20 clientes, 14 ativos após 6 meses = 70%",
    unit: "%",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 60%',   range_max: 0.60 },
      { status: 'warn', label: 'Atenção', display: '60–80%',  range_min: 0.60, range_max: 0.80 },
      { status: 'ok',   label: 'OK',      display: '≥ 80%',   range_min: 0.80 },
    ],
    how_to_improve: [
      "Identificar mês com maior queda na curva de retenção (gargalo)",
      "Reforçar onboarding nos primeiros 90 dias se M3 estiver baixo",
      "Programa de fidelização para cohorts mais antigos",
      "Análise comparativa entre cohorts para identificar mudanças de fit"
    ],
  },
  benchmark_cohort_70: {
    title: "Benchmark 70% (Cohort)",
    definition: "Linha de referência de 70% de retenção, considerada saudável para SaaS.",
    why_it_matters: "Cohorts consistentemente acima de 70% indicam boa retenção. Abaixo sugere problemas de produto ou atendimento.",
    formula: "Referência fixa: 70% do tamanho do cohort",
  },
  nrr: {
    title: "NRR (Net Revenue Retention)",
    definition: "Quanto da receita do início do período foi mantida, incluindo expansões e contrações.",
    why_it_matters: "NRR acima de 100% significa que a empresa cresce mesmo sem novos clientes. Meta: > 100%.",
    formula: "(MRR início + expansão − contração − churn) ÷ MRR início",
    unit: "%",
    benchmark: [
      { status: 'crit', label: 'Crítico',         display: '< 90%',     range_max: 0.90 },
      { status: 'warn', label: 'Atenção',         display: '90–110%',   range_min: 0.90, range_max: 1.10 },
      { status: 'ok',   label: 'OK',              display: '≥ 110%',    range_min: 1.10 },
    ],
    how_to_improve: [
      "Criar playbook de upsell na renovação anual ou semestral",
      "Identificar módulos premium para cross-sell baseado em uso",
      "Reduzir downsell com health scoring proativo (alertas antes da redução)",
      "Reativação automática de contratos cancelados com oferta personalizada"
    ],
  },
  grr: {
    title: "GRR (Gross Revenue Retention)",
    definition: "Quanto da receita do início do período foi mantida, desconsiderando expansões.",
    why_it_matters: "Mostra a capacidade de reter receita existente. Meta: > 90%. Máximo possível: 100%.",
    formula: "(MRR início − churn − downsell) ÷ MRR início",
    unit: "%",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 75%',    range_max: 0.75 },
      { status: 'warn', label: 'Atenção', display: '75–90%',   range_min: 0.75, range_max: 0.90 },
      { status: 'ok',   label: 'OK',      display: '≥ 90%',    range_min: 0.90 },
    ],
    how_to_improve: [
      "Reduzir churn integral: identificar causa-raiz dos cancelados nos últimos 90 dias",
      "Eliminar downsells preventíveis: revisar mudanças de plano dos últimos 6 meses",
      "Pesquisa NPS trimestral para identificar detratores antes do churn",
      "Tickets de risco de churn no CS — playbook de retenção estruturado"
    ],
  },
  concentracao_top10: {
    title: "Concentração Top 10",
    definition: "Percentual do MRR total que vem dos 10 maiores clientes.",
    why_it_matters: "Acima de 50% é um risco: perder 1-2 clientes grandes pode impactar muito a receita.",
    formula: "MRR dos 10 maiores clientes ÷ MRR Total",
    unit: "%",
    benchmark: [
      { status: 'ok',   label: 'OK',      display: '< 30%',   range_max: 0.30 },
      { status: 'warn', label: 'Atenção', display: '30–50%',  range_min: 0.30, range_max: 0.50 },
      { status: 'crit', label: 'Crítico', display: '≥ 50%',   range_min: 0.50 },
    ],
    how_to_improve: [
      "Acelerar aquisição em segmentos novos (diferentes do perfil dos top 10)",
      "Aumentar ARPA da base inferior com upsell agressivo",
      "Definir teto de % por cliente individual (ex: máx 8% do MRR)",
      "Diversificar geograficamente ou por vertical de mercado"
    ],
  },
  quick_ratio: {
    title: "Quick Ratio",
    definition: "Razão entre MRR adicionado e MRR perdido. Mede a saúde do crescimento.",
    why_it_matters: "≥ 4 = excelente (cresce rápido); < 1 = encolhendo; entre 1-4 = crescendo devagar.",
    formula: "(New MRR + Expansion) ÷ (Churn + Contraction)",
    unit: "x",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 1',  range_max: 1 },
      { status: 'warn', label: 'Atenção', display: '1–4',  range_min: 1, range_max: 4 },
      { status: 'ok',   label: 'OK',      display: '≥ 4',  range_min: 4 },
    ],
    how_to_improve: [
      "Aumentar New MRR: revisão de pricing, mais leads qualificados, melhorar conversão",
      "Aumentar Expansion: upsell + cross-sell na base existente",
      "Reduzir Churn integral: focar em retenção dos clientes com maior MRR",
      "Reduzir Downsell: mudanças de plano só com aprovação de CS"
    ],
  },
  crescimento_reais: {
    title: "Crescimento R$",
    definition: "Diferença absoluta em reais entre o MRR atual e o MRR no início do período.",
    why_it_matters: "Mostra o ganho ou perda real de receita recorrente no período.",
    formula: "MRR atual − MRR no início do período",
  },
  crescimento_percent: {
    title: "Crescimento %",
    definition: "Variação percentual do MRR no período selecionado.",
    why_it_matters: "Permite comparar crescimento entre períodos diferentes, independente do tamanho da base.",
    formula: "Crescimento R$ ÷ MRR início do período",
    unit: "%",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 0%',    range_max: 0 },
      { status: 'warn', label: 'Atenção', display: '0–10%',   range_min: 0, range_max: 0.10 },
      { status: 'ok',   label: 'OK',      display: '≥ 10%',   range_min: 0.10 },
    ],
    how_to_improve: [
      "Aumentar New MRR: investimento em aquisição com canais de melhor ROI",
      "Acelerar expansão: upsell e cross-sell na base existente",
      "Reduzir churn: cada cancelamento prevenido é crescimento direto",
      "Reajuste anual indexado ao IPCA ou IGPM"
    ],
  },
  arpa: {
    title: "ARPA (mês)",
    definition: "Receita média por conta (cliente ativo), excluindo receita de ativação/setup.",
    why_it_matters: "Métrica estritamente recorrente. Usado no cálculo de LTV. Não inclui setup fees.",
    formula: "MRR Snapshot ÷ Clientes Ativos",
  },
  cac_payback: {
    title: "CAC Payback (meses)",
    definition: "Tempo necessário para recuperar o investimento feito para adquirir um cliente, considerando a margem (MRR - COGS).",
    why_it_matters: "Ideal ≤ 12 meses. Acima disso, o capital fica preso por muito tempo.",
    formula: "CAC por Logo ÷ (ARPA × MC%)",
    unit: "meses",
    benchmark: [
      { status: 'ok',   label: 'OK',      display: '≤ 12m',   range_max: 12 },
      { status: 'warn', label: 'Atenção', display: '12–18m',  range_min: 12, range_max: 18 },
      { status: 'crit', label: 'Crítico', display: '> 18m',   range_min: 18 },
    ],
    how_to_improve: [
      "Reduzir CAC: melhorar conversão de funil, otimizar canais com melhor CPL",
      "Aumentar ARPA: pricing premium, packaging com módulos pagos",
      "Aumentar MC%: reduzir COGS, automatizar operação",
      "Reduzir tempo de onboarding/ativação — receita começa antes"
    ],
  },
  novos_clientes_vendas: {
    title: "Novos Clientes (Vendas)",
    definition: "Clientes cadastrados no período selecionado que estão ativos.",
    why_it_matters: "Indica a capacidade comercial de trazer novos clientes para a base.",
    formula: "COUNT(clientes) com data_venda no período e status ativo",
  },
  new_mrr_vendas: {
    title: "New MRR (Vendas)",
    definition: "Soma das mensalidades dos novos clientes vendidos no período.",
    why_it_matters: "Receita recorrente gerada pelas novas vendas. Principal combustível do crescimento.",
    formula: "Σ mensalidade dos clientes com data_venda no período",
  },
  receita_ativacao: {
    title: "Receita de Ativação",
    definition: "Soma dos valores de setup/implantação cobrados dos novos clientes.",
    why_it_matters: "Receita pontual que ajuda a cobrir custos de aquisição. Não é recorrente.",
    formula: "Σ valor_ativacao dos novos clientes no período",
  },
  mrr_adicionado: {
    title: "MRR Adicionado",
    definition: "Toda receita recorrente nova no período: vendas + upsell + cross-sell.",
    why_it_matters: "Mostra a capacidade total de geração de receita recorrente, não apenas novas vendas.",
    formula: "New MRR + Upsell MRR + Cross-sell MRR",
  },
  ticket_medio_novos: {
    title: "Ticket Médio (Novos)",
    definition: "Mensalidade média dos clientes vendidos no período.",
    why_it_matters: "Se está subindo, o comercial está fechando contratos maiores. Se cai, pode indicar foco em clientes menores.",
    formula: "New MRR ÷ Novos Clientes no período",
  },
  setup_medio: {
    title: "Setup Médio",
    definition: "Valor médio cobrado de implantação por novo cliente.",
    why_it_matters: "Ajuda a entender se o pricing de setup está compatível com o custo de onboarding.",
    formula: "Receita de Ativação ÷ Novos Clientes",
  },
  ltv_cac_3m: {
    title: "LTV/CAC (Janela 3M)",
    definition: "Razão LTV/CAC calculada com médias dos últimos 3 meses de churn, ARPA e MC%.",
    why_it_matters: "Suaviza flutuações mensais e dá uma visão mais estável da eficiência de aquisição.",
    formula: "LTV Rec. (3M) ÷ CAC por Logo (3M)",
    example: "Se LTV 3M = R$ 12.000 e CAC 3M = R$ 3.000 → 4.0x",
  },
  ltv_cac_6m: {
    title: "LTV/CAC (Janela 6M)",
    definition: "Razão LTV/CAC calculada com médias dos últimos 6 meses de churn, ARPA e MC%.",
    why_it_matters: "Visão de médio prazo, ideal para decisões estratégicas de investimento em aquisição.",
    formula: "LTV Rec. (6M) ÷ CAC por Logo (6M)",
    example: "Se LTV 6M = R$ 15.000 e CAC 6M = R$ 4.000 → 3.75x",
  },
  // ── CS Dashboard ──
  cs_tickets_abertos: {
    title: "Tickets Abertos",
    definition: "Quantidade de tickets de CS criados no período selecionado.",
    why_it_matters: "Mede a demanda do time de CS. Volume crescente pode indicar problemas no produto ou oportunidades de melhoria.",
    formula: "COUNT(tickets) com criado_em no período",
  },
  cs_tickets_fechados: {
    title: "Tickets Fechados",
    definition: "Quantidade de tickets concluídos ou cancelados no período.",
    why_it_matters: "Mostra a capacidade de resolução do time. Deve acompanhar ou superar os tickets abertos.",
    formula: "COUNT(tickets) com concluido_em no período",
  },
  cs_vencidos_sla: {
    title: "Vencidos SLA",
    definition: "Tickets que ultrapassaram o prazo definido para primeira ação ou conclusão.",
    why_it_matters: "SLAs estourados indicam gargalos operacionais e risco de insatisfação do cliente.",
    formula: "COUNT(tickets) onde sla_primeira_acao_ate ou sla_conclusao_ate < agora e status aberto",
  },
  cs_reaberturas: {
    title: "Reaberturas",
    definition: "Tickets que foram reabertos após serem concluídos.",
    why_it_matters: "Alta taxa de reabertura indica que os problemas não estão sendo resolvidos de forma definitiva.",
    formula: "COUNT(tickets) com status reaberto no período",
  },
  cs_tempo_1a_acao_media: {
    title: "Tempo 1ª Ação (Média)",
    definition: "Tempo médio entre a criação do ticket e a primeira ação do responsável.",
    why_it_matters: "Mede a velocidade de resposta. Clientes esperam atendimento rápido — ideal < 24h.",
    formula: "Média(primeira_acao_em − criado_em) dos tickets concluídos no período",
  },
  cs_tempo_1a_acao_mediana: {
    title: "Tempo 1ª Ação (Mediana)",
    definition: "Valor central (mediana) do tempo até a primeira ação, eliminando outliers.",
    why_it_matters: "Mais representativo que a média quando há poucos tickets com tempo muito alto.",
    formula: "Mediana(primeira_acao_em − criado_em) dos tickets concluídos no período",
  },
  cs_tempo_conclusao_media: {
    title: "Tempo Conclusão (Média)",
    definition: "Tempo médio entre a criação e a conclusão do ticket.",
    why_it_matters: "Indica a eficiência do ciclo completo de atendimento. Meta varia por tipo de ticket.",
    formula: "Média(concluido_em − criado_em) dos tickets concluídos no período",
  },
  cs_percent_higiene: {
    title: "% Higiene",
    definition: "Percentual de tickets abertos que possuem próxima ação E data de follow-up preenchidas.",
    why_it_matters: "Tickets sem plano de ação ficam parados. Meta: ≥ 80% para garantir acompanhamento ativo.",
    formula: "(Tickets com proxima_acao + proximo_followup_em) ÷ Tickets abertos × 100",
    example: "40 tickets com plano ÷ 50 abertos = 80%",
  },
  cs_clientes_em_risco: {
    title: "Clientes em Risco",
    definition: "Clientes com tickets de tipo 'Risco de Churn' abertos ou em andamento.",
    why_it_matters: "Cada cliente em risco pode significar perda de MRR. Requer ação imediata de retenção.",
    formula: "COUNT(tickets) tipo = risco_churn e status ∉ {concluído, cancelado}",
  },
  cs_mrr_em_risco: {
    title: "MRR em Risco",
    definition: "Soma do MRR dos clientes com tickets de risco de churn abertos.",
    why_it_matters: "Quantifica o impacto financeiro potencial do churn. Prioriza ações de retenção por valor.",
    formula: "Σ mrr_em_risco dos tickets de risco ativos",
  },
  cs_mrr_recuperado: {
    title: "MRR Recuperado",
    definition: "MRR de clientes que estavam em risco e foram retidos (ticket concluído como retido).",
    why_it_matters: "Mede a eficácia do time de retenção. MRR recuperado é receita que seria perdida.",
    formula: "Σ mrr_recuperado dos tickets de risco concluídos no período",
  },
  cs_percent_risco_com_plano: {
    title: "% Com Plano de Ação",
    definition: "Percentual de tickets de risco que possuem próxima ação definida.",
    why_it_matters: "Riscos sem plano têm maior chance de virar churn. Meta: 100%.",
    formula: "(Tickets risco com proxima_acao) ÷ Total tickets risco × 100",
  },
  cs_indicacoes_ganhas: {
    title: "Indicações Ganhas",
    definition: "Indicações que resultaram em fechamento de negócio no período.",
    why_it_matters: "Clientes indicados tendem a ter menor CAC e melhor retenção.",
    formula: "COUNT(tickets indicação) com indicacao_status = 'fechou' no período",
  },
  cs_indicacoes_perdidas: {
    title: "Indicações Perdidas",
    definition: "Indicações que não se converteram em negócio.",
    why_it_matters: "Ajuda a entender gargalos no funil de indicações e melhorar a qualificação.",
    formula: "COUNT(tickets indicação) com indicacao_status = 'nao_fechou' no período",
  },
  cs_indicacoes_conversao: {
    title: "% Conversão de Indicações",
    definition: "Percentual de indicações finalizadas que se converteram em negócio.",
    why_it_matters: "Taxa saudável indica boa qualificação de indicações. Meta: ≥ 40%.",
    formula: "Ganhas ÷ (Ganhas + Perdidas) × 100",
    example: "8 ganhas ÷ (8 + 12) = 40%",
  },
  cs_oportunidades_abertas: {
    title: "Oportunidades Abertas",
    definition: "Tickets de oportunidade (expansão/upsell) com status aberto.",
    why_it_matters: "Pipeline de receita incremental vindo da base existente.",
    formula: "COUNT(tickets oportunidade) com status aberto",
  },
  cs_oportunidades_ganhas: {
    title: "Oportunidades Ganhas",
    definition: "Oportunidades que se converteram em receita no período.",
    why_it_matters: "Receita de expansão é mais barata que aquisição. Métrica chave de NRR.",
    formula: "COUNT(tickets oportunidade) com resultado = 'ganho' no período",
  },
  cs_oportunidades_perdidas: {
    title: "Oportunidades Perdidas",
    definition: "Oportunidades que não se concretizaram no período.",
    why_it_matters: "Permite analisar objeções e melhorar a abordagem de expansão.",
    formula: "COUNT(tickets oportunidade) com resultado = 'perdido' no período",
  },
  cs_oportunidades_conversao: {
    title: "% Conversão de Oportunidades",
    definition: "Percentual de oportunidades finalizadas que foram ganhas.",
    why_it_matters: "Indica a eficácia do time em converter expansões. Meta: ≥ 50%.",
    formula: "Ganhas ÷ (Ganhas + Perdidas) × 100",
  },
  cs_previsao_ativacao: {
    title: "Previsão Ativação",
    definition: "Soma dos valores de ativação previstos nas oportunidades abertas.",
    why_it_matters: "Receita pontual esperada do pipeline de expansão.",
    formula: "Σ oport_valor_previsto_ativacao dos tickets oportunidade abertos",
  },
  cs_previsao_mrr: {
    title: "Previsão MRR",
    definition: "Soma do MRR previsto nas oportunidades abertas.",
    why_it_matters: "Receita recorrente esperada do pipeline de expansão. Alimenta projeções de crescimento.",
    formula: "Σ oport_valor_previsto_mrr dos tickets oportunidade abertos",
  },
  cs_ganho_ativacao: {
    title: "Ganho Ativação",
    definition: "Valor de ativação efetivamente realizado das oportunidades ganhas no período.",
    why_it_matters: "Receita pontual conquistada pela equipe de CS via expansão.",
    formula: "Σ oport_valor_previsto_ativacao dos tickets oportunidade ganhos no período",
  },
  cs_ganho_mrr: {
    title: "Ganho MRR",
    definition: "MRR efetivamente adicionado das oportunidades ganhas no período.",
    why_it_matters: "Contribuição direta do CS para o crescimento do MRR.",
    formula: "Σ oport_valor_previsto_mrr dos tickets oportunidade ganhos no período",
  },
  cs_cobertura_90d: {
    title: "% Cobertura 90D",
    definition: "Percentual de clientes ativos que tiveram ao menos um contato (ticket) nos últimos 90 dias.",
    why_it_matters: "Clientes sem contato prolongado têm maior risco de churn silencioso. Meta: ≥ 80%.",
    formula: "(Clientes com ticket nos últimos 90d) ÷ Clientes Ativos × 100",
    example: "160 cobertos ÷ 200 ativos = 80%",
  },
  cs_descobertos: {
    title: "Clientes Descobertos",
    definition: "Clientes ativos que não tiveram nenhum contato (ticket) nos últimos 90 dias.",
    why_it_matters: "São os mais propensos a churn silencioso. Devem ser priorizados para contato proativo.",
    formula: "Clientes Ativos − Clientes Cobertos (com ticket nos últimos 90d)",
  },
  // ── Espelho Financeiro (cliente) ──
  ef_receita_mrr: {
    title: "Receita (MRR Atual)",
    definition: "Receita mensal recorrente efetiva do cliente, incluindo a mensalidade base e movimentos (upsell, cross-sell, downsell).",
    why_it_matters: "É quanto o cliente paga efetivamente por mês. Base para todos os cálculos de rentabilidade.",
    formula: "MRR Base + Σ valor_delta dos movimentos ativos",
  },
  ef_cogs: {
    title: "Custo Operação (COGS)",
    definition: "Custo variável mensal para operar o serviço deste cliente (valor pago ao fornecedor/parceiro).",
    why_it_matters: "Quanto maior o COGS em relação à receita, menor a margem. Controle rigoroso é essencial.",
    formula: "Custo Base + Σ custo_delta dos movimentos ativos",
  },
  ef_receita_apos_cogs: {
    title: "Receita após COGS",
    definition: "Quanto sobra da receita do cliente após pagar o custo operacional.",
    why_it_matters: "Primeiro nível de lucro. Se negativo, o cliente dá prejuízo operacional.",
    formula: "MRR Atual − COGS Atual",
  },
  ef_impostos: {
    title: "Impostos",
    definition: "Valor estimado de impostos sobre o faturamento do cliente.",
    why_it_matters: "Reduz a margem real. Deve ser considerado para precificação correta.",
    formula: "MRR Atual × Imposto%",
    example: "MRR R$ 500 × 8% = R$ 40 de impostos",
  },
  ef_margem_contribuicao: {
    title: "Margem de Contribuição",
    definition: "Quanto o cliente contribui para cobrir despesas fixas e gerar lucro, após COGS e impostos.",
    why_it_matters: "Se positiva, o cliente ajuda a pagar os custos fixos. Se negativa, cada mês aumenta o prejuízo.",
    formula: "MRR Atual − COGS − Impostos",
  },
  ef_mc_percent: {
    title: "MC %",
    definition: "Percentual de contribuição do cliente sobre sua receita.",
    why_it_matters: "Permite comparar rentabilidade entre clientes de diferentes tamanhos. Meta: > 60%.",
    formula: "(MC ÷ MRR Atual) × 100",
  },
  ef_custos_fixos: {
    title: "Custos Fixos",
    definition: "Parcela das despesas fixas da empresa alocada proporcionalmente a este cliente.",
    why_it_matters: "Completa o cálculo de rentabilidade real. Inclui aluguel, folha, infra etc.",
    formula: "MRR Atual × Custo Fixo%",
  },
  ef_lucro_real: {
    title: "Lucro Real",
    definition: "Resultado líquido final do cliente após todos os custos (COGS, impostos e fixos).",
    why_it_matters: "Mostra se o cliente é realmente lucrativo. Clientes com lucro negativo consomem margem dos demais.",
    formula: "MC − Custos Fixos",
    example: "MC R$ 300 − Fixos R$ 80 = Lucro R$ 220",
  },
  ef_lucro_real_percent: {
    title: "Lucro Real %",
    definition: "Rentabilidade líquida percentual do cliente.",
    why_it_matters: "Permite ranquear clientes por eficiência. Clientes grandes com margem baixa podem ser piores que pequenos rentáveis.",
    formula: "(Lucro Real ÷ MRR Atual) × 100",
  },
  ef_markup_cogs: {
    title: "Markup COGS",
    definition: "Percentual de acréscimo sobre o custo operacional para chegar no preço cobrado.",
    why_it_matters: "Markup baixo (< 50%) indica que o preço não cobre adequadamente os custos. Ideal: > 100%.",
    formula: "((MRR ÷ COGS) − 1) × 100",
    example: "MRR R$ 500 ÷ COGS R$ 200 = 150% de markup",
  },
  ef_fator_preco: {
    title: "Fator Preço",
    definition: "Quantas vezes o preço cobrado cobre o custo operacional.",
    why_it_matters: "Fator < 2x é arriscado. Ideal ≥ 3x para SaaS saudável.",
    formula: "MRR Atual ÷ COGS Atual",
    example: "MRR R$ 600 ÷ COGS R$ 200 = 3.0x",
  },
  rule_of_40: {
    title: "Rule of 40",
    definition: "Soma do crescimento percentual com a margem de contribuição percentual. Métrica de saúde geral que junta crescimento + rentabilidade num único número.",
    why_it_matters: "Padrão a16z/Bessemer para boards de SaaS. ≥ 40 = empresa saudável. Permite trocar crescimento por margem (e vice-versa) — uma SaaS crescendo 60% com MC -20% atinge a regra; outra com 10% de crescimento e 30% de MC também.",
    formula: "Crescimento % do período + MC% Ponderada × 100",
    example: "Growth +20% + MC% 25% = Rule of 40 = 45 (saudável)",
    unit: "pts",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 20', range_max: 20 },
      { status: 'warn', label: 'Atenção', display: '20–40', range_min: 20, range_max: 40 },
      { status: 'ok',   label: 'OK',      display: '≥ 40', range_min: 40 },
    ],
    how_to_improve: [
      "Aumentar receita recorrente: New MRR + Upsell + Cross-sell na base ativa",
      "Reduzir COGS: renegociar fornecedores, automatizar operação, eliminar SKUs deficitários",
      "Aumentar ARPA: revisão de pricing, packaging em tiers, módulos premium",
      "Reduzir churn: health score proativo, programa de retenção, melhorar onboarding"
    ],
  },
  tenure_medio: {
    title: "Tenure Médio (meses)",
    definition: "Tempo médio em meses que os clientes ativos estão na carteira, contado desde a primeira venda registrada.",
    why_it_matters: "Indica maturidade da base. Tenure alto = receita previsível, NPS provavelmente bom, expansion provável. Tenure baixo = base instável ou empresa muito nova.",
    formula: "AVG(EXTRACT(MONTH FROM AGE(now(), data_inicial))) dos clientes ativos · data_inicial = MIN(contratos.data_venda) com fallback clientes.data_cadastro",
    example: "Base de 100 clientes com média de 24 meses cada → Tenure Médio = 24m",
    unit: "meses",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 6m',   range_max: 6 },
      { status: 'warn', label: 'Atenção', display: '6–18m',  range_min: 6, range_max: 18 },
      { status: 'ok',   label: 'OK',      display: '≥ 18m',  range_min: 18 },
    ],
    how_to_improve: [
      "Reduzir churn dos primeiros 90 dias (Early Churn) com onboarding estruturado",
      "Aumentar percepção de valor com checkins regulares de CS",
      "Identificar clientes em risco com health scoring antes de cancelarem",
      "Programa de fidelização com benefícios escalonados por tempo de casa"
    ],
  },
  mrr_vs_trimestre: {
    title: "MRR vs Último Trimestre",
    definition: "Comparativo do MRR atual com o MRR do trimestre anterior completo.",
    why_it_matters: "Mostra a trajetória de médio prazo — suaviza ruído mensal e revela tendência consolidada.",
    formula: "MRR atual − MRR no fim do trimestre anterior · Snapshot calculado via contratos ativos naquela data",
    unit: "R$",
  },
  mrr_vs_semestre: {
    title: "MRR vs Último Semestre",
    definition: "Comparativo do MRR atual com o MRR do semestre anterior completo.",
    why_it_matters: "Visão de médio-longo prazo — captura ciclos de negócio e impacto de mudanças estratégicas.",
    formula: "MRR atual − MRR no fim do semestre anterior",
    unit: "R$",
  },
  mrr_vs_ano: {
    title: "MRR vs Ano Anterior",
    definition: "Comparativo do MRR atual com o MRR de exatamente 12 meses atrás.",
    why_it_matters: "Métrica YoY (Year over Year) — referência padrão para apresentações executivas, investidores e Rule of 40 anualizado.",
    formula: "MRR atual − MRR de 12 meses atrás",
    unit: "R$",
  },

  // ── Crescimento V2 — Velocity ──

  mrr_growth_rate_mom: {
    title: "MRR Growth Rate (MoM)",
    definition: "Taxa de crescimento do MRR mês a mês.",
    why_it_matters: "Mostra o ritmo real de crescimento. Mensal é mais sensível que o crescimento do período — captura aceleração/desaceleração imediata. Estável e consistente é melhor que pico isolado.",
    formula: "(MRR mês atual − MRR mês anterior) ÷ MRR mês anterior",
    example: "MRR Mai R$ 156k vs Abr R$ 147k → +5.7% MoM",
    unit: "%",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 2%',  range_max: 0.02 },
      { status: 'warn', label: 'Atenção', display: '2–5%',  range_min: 0.02, range_max: 0.05 },
      { status: 'ok',   label: 'OK',      display: '≥ 5%',  range_min: 0.05 },
    ],
    how_to_improve: [
      "Aumentar New MRR: revisar funil de vendas, qualificar leads, melhorar pricing",
      "Reduzir Churn: alertas proativos de risco em CS, ofertas de retenção",
      "Acelerar Expansion: campanhas de upsell programadas, cross-sell por uso de módulos",
      "Reduzir Downsell: revisar política de downgrade (CS deve aprovar antes)"
    ],
  },

  arr_growth_yoy: {
    title: "ARR Growth (YoY)",
    definition: "Crescimento percentual do ARR comparado ao mesmo mês do ano anterior.",
    why_it_matters: "Métrica YoY é a referência padrão para investidores e boards. Captura crescimento real eliminando sazonalidade mensal. Padrão Bessemer/Battery: ≥30% YoY para B2B SaaS estabelecida; T2D3 (≥200%) para early-stage.",
    formula: "(ARR atual − ARR de 12 meses atrás) ÷ ARR de 12 meses atrás",
    example: "ARR R$ 1.87M vs R$ 1.58M ano passado → +18.3% YoY",
    unit: "%",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 15%',  range_max: 0.15 },
      { status: 'warn', label: 'Atenção', display: '15–30%', range_min: 0.15, range_max: 0.30 },
      { status: 'ok',   label: 'OK',      display: '≥ 30%',  range_min: 0.30 },
    ],
    how_to_improve: [
      "Aumentar máquina de vendas: novos canais, expansão de SDRs, melhorar conversão",
      "Aumentar ARPA: pricing tiers premium, packaging com módulos pagos",
      "Acelerar expansão NRR > 110%: programa estruturado de upsell na base",
      "Reduzir Logo Churn: o que sai por cancelamento freia o YoY no ano seguinte"
    ],
  },

  growth_persistence: {
    title: "Growth Persistence",
    definition: "Razão entre o crescimento dos últimos 12 meses e o crescimento dos 12 meses anteriores. Métrica Bessemer Cloud Index.",
    why_it_matters: "Indica se a empresa está acelerando, mantendo ou desacelerando seu crescimento ano após ano. Empresas de classe mundial mantêm ≥ 0.8 (deceleração natural mas controlada). Abaixo de 0.5 = desaceleração forte.",
    formula: "(Growth últimos 12m) ÷ (Growth dos 12m anteriores) · Precisa de 24 meses de série histórica",
    example: "Growth ano corrente +18% / Growth ano anterior +20% → Persistence = 0.9 (mantendo)",
    unit: "x",
    benchmark: [
      { status: 'crit', label: 'Crítico',     display: '< 0.5',     range_max: 0.5 },
      { status: 'warn', label: 'Desacelerando', display: '0.5–1',    range_min: 0.5, range_max: 1 },
      { status: 'ok',   label: 'Mantendo+',     display: '≥ 1',      range_min: 1 },
    ],
    how_to_improve: [
      "Investir em novos canais de aquisição antes que os atuais saturarem",
      "Expandir TAM com novos segmentos ou geografias",
      "Aumentar ARPA via verticalização e pricing premium",
      "Programa estruturado de NRR > 110% para crescer dentro da base"
    ],
  },

  // ── Crescimento V2 — Composition ──

  expansion_rate: {
    title: "Expansion Rate (mensal)",
    definition: "Percentual do MRR adicionado no mês que veio da BASE EXISTENTE (upsell + cross-sell + reativação + reajuste) — não de novas vendas.",
    why_it_matters: "Distingue 'crescer pela porta da frente' (caro, novo cliente) de 'crescer dentro de casa' (barato, expansão). SaaS B2B saudável tem ≥5% mensal de expansion. Empresas pré-IPO tipo Snowflake/Datadog rodam 20%+.",
    formula: "(Upsell + Cross + Reativação + Reajuste) ÷ MRR_início_período",
    example: "Expansion R$ 3.5k ÷ MRR R$ 150k = 2.3% (abaixo da meta)",
    unit: "%",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 2%',  range_max: 0.02 },
      { status: 'warn', label: 'Atenção', display: '2–5%',  range_min: 0.02, range_max: 0.05 },
      { status: 'ok',   label: 'OK',      display: '≥ 5%',  range_min: 0.05 },
    ],
    how_to_improve: [
      "Mapear módulos premium do produto e oferecer upsell ativo no aniversário do contrato",
      "Cross-sell sistemático por gatilho de uso (cliente usa X há 6 meses → ofertar Y)",
      "Política de reajuste anual indexado (IPCA + bônus por NPS alto)",
      "Programa de reativação de cancelados com oferta personalizada"
    ],
  },

  reativacoes_periodo: {
    title: "Reativações no Período",
    definition: "Quantidade de clientes que voltaram após cancelamento + MRR recuperado.",
    why_it_matters: "Alavanca de growth subestimada. Custa muito menos que aquisição nova (cliente já conhece o produto) e tem maior conversão. Empresas que medem e otimizam reativação têm NRR mais alto.",
    formula: "COUNT(clientes que reativaram no período) · Σ MRR dos contratos reativados",
    example: "4 logos reativados · +R$ 480 recuperados no mês",
  },

  // ── Crescimento V2 — Acquisition ──

  net_logo_growth: {
    title: "Net Logo Growth",
    definition: "Variação líquida de clientes no período: novos menos cancelados, em valor absoluto.",
    why_it_matters: "Crescer em receita mas perder logos é sinal de concentração. Crescer em logos sem ticket é sinal de comoditização. Os dois (MRR e logo) precisam acompanhar.",
    formula: "Novos Clientes − Cancelados (no período)",
    example: "18 novos − 6 cancelados = +12 logos",
  },

  logo_growth_rate: {
    title: "Logo Growth Rate (mensal)",
    definition: "Taxa de crescimento percentual da base de clientes (logos), independente do ticket.",
    why_it_matters: "Mede crescimento da base ativa. Ajuda a separar 'cresci porque vendi mais caro' (ticket subindo) de 'cresci porque ganhei mais clientes' (logo subindo).",
    formula: "(Novos − Cancelados) ÷ Base no início do período",
    example: "+12 logos ÷ 651 base = 1.8% / mês",
    unit: "%",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 1%',  range_max: 0.01 },
      { status: 'warn', label: 'Atenção', display: '1–2%',  range_min: 0.01, range_max: 0.02 },
      { status: 'ok',   label: 'OK',      display: '≥ 2%',  range_min: 0.02 },
    ],
    how_to_improve: [
      "Aumentar volume de leads qualificados no funil",
      "Melhorar taxa de conversão de demo → contrato fechado",
      "Reduzir churn de logos (não só de receita) — pequenos cancelam tanto quanto grandes",
      "Programa de indicação ativa (cliente atual traz cliente novo)"
    ],
  },

  arpa_novo_vs_base: {
    title: "ARPA: Novo vs Base",
    definition: "Comparativo entre o ticket médio dos clientes novos do período e o ticket médio da base ativa.",
    why_it_matters: "Ratio > 1 = price realization positiva (você está vendendo mais caro do que a média da base atual). Ratio < 1 = comoditização ou descontos agressivos. Tendência fundamental para validar se mudanças de pricing estão funcionando.",
    formula: "ARPA Novos = New MRR ÷ Novos Clientes · ARPA Base = MRR Atual ÷ Clientes Ativos · Ratio = Novos ÷ Base",
    example: "ARPA Novos R$ 510 ÷ ARPA Base R$ 240 = 2.1x (price realization positiva)",
  },

  // ── Crescimento V2 — Efficiency ──

  burn_multiple: {
    title: "Burn Multiple",
    definition: "Quanto a empresa gasta em CAC para cada R$ de Net New MRR gerado. Métrica de eficiência de capital criada por David Sacks (Craft Ventures) em 2022.",
    why_it_matters: "Substitui o Magic Number como métrica principal pós-2022. Em ambientes de capital caro, Burn Multiple < 1x é o que diferencia empresas que escalam de forma saudável. Burn Multiple > 2x = a empresa está queimando mais do que gera.",
    formula: "CAC Burn ÷ Net New MRR · Só faz sentido quando Net New MRR > 0",
    example: "CAC R$ 11.788 ÷ Net New R$ 8.420 = 1.4x (atenção — gasta R$ 1,40 pra gerar R$ 1 de Net New)",
    unit: "x",
    benchmark: [
      { status: 'ok',   label: 'OK',      display: '< 1x',  range_max: 1 },
      { status: 'warn', label: 'Atenção', display: '1–2x',  range_min: 1, range_max: 2 },
      { status: 'crit', label: 'Crítico', display: '≥ 2x',  range_min: 2 },
    ],
    how_to_improve: [
      "Reduzir CAC Burn: cortar canais com pior CPL, automatizar SDR, focar em ICP claro",
      "Aumentar Net New MRR: vender ticket maior, acelerar fechamento, reduzir churn",
      "Aumentar Expansion: cada R$ de upsell tem Burn Multiple ~0 (custo marginal mínimo)",
      "Revisar pricing: subir o ARPA dos novos clientes melhora o numerador sem aumentar denominador"
    ],
  },

  magic_number: {
    title: "Magic Number",
    definition: "Eficiência da máquina de vendas: quanto de ARR é gerado para cada R$ gasto em CAC. Criada por Mamoon Hamid (Kleiner Perkins).",
    why_it_matters: "Indica se vale acelerar ou frear o investimento em vendas. ≥1 = pisa no acelerador (cada R$ em CAC vira ≥R$ 1 em ARR). <0.5 = pisa no freio (não vale o esforço). 0.5-1 = OK, mas otimize.",
    formula: "(Net New MRR × 12) ÷ CAC Burn",
    example: "(R$ 8.420 × 12) ÷ R$ 123k = 0.82 (atenção — abaixo de 1)",
    unit: "x",
    benchmark: [
      { status: 'crit', label: 'Crítico', display: '< 0.5',  range_max: 0.5 },
      { status: 'warn', label: 'Atenção', display: '0.5–1',  range_min: 0.5, range_max: 1 },
      { status: 'ok',   label: 'OK',      display: '≥ 1',    range_min: 1 },
    ],
    how_to_improve: [
      "Aumentar produtividade de SDRs/closers: treinamento + ferramentas + scripts",
      "Reduzir tempo médio de ciclo de venda — receita começa a contar antes",
      "Subir Net New MRR sem subir CAC: vendas inbound mais eficientes que outbound",
      "Reduzir downsell e churn: melhora o numerador (Net New) sem mexer no denominador"
    ],
  },

  // ── Crescimento V2 — Visualização ──

  mrr_forecast_90d: {
    title: "Forecast MRR (próximos 90 dias)",
    definition: "Projeção do MRR para os próximos 3 meses baseada em regressão linear sobre os últimos 12 meses de série histórica.",
    why_it_matters: "Permite antecipar a trajetória de MRR e validar se os planos de growth (vendas + retenção) sustentam a projeção. R² alto = série bem comportada, projeção confiável. R² baixo = MRR oscila muito, projeção tem incerteza maior.",
    formula: "Regressão linear (método dos mínimos quadrados) sobre Σ MRR mensal dos últimos 12 meses · Projeção de 3 pontos à frente",
    example: "Série [120k, 125k, 132k, ..., 156k] → projeção 162k, 168k, 174k com R² = 0.94",
  },

};

export default kpiHelp;

/** Fallback entry for KPIs not yet in the dictionary */
export const kpiHelpFallback: KpiHelpEntry = {
  title: "Indicador",
  definition: "Definição em construção. Consulte o admin.",
  why_it_matters: "Em breve teremos a explicação completa deste indicador.",
  formula: "—",
};
