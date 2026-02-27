export interface KpiHelpEntry {
  title: string;
  definition: string;
  why_it_matters: string;
  formula: string;
  example?: string;
}

const kpiHelp: Record<string, KpiHelpEntry> = {
  mrr_snapshot: {
    title: "MRR Atual (Snapshot)",
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
  },
  churn_rate_receita: {
    title: "Churn Rate (Receita)",
    definition: "Percentual de receita recorrente perdida em relação ao MRR total.",
    why_it_matters: "Mais importante que churn de carteira: se perde clientes grandes, o impacto financeiro é maior.",
    formula: "MRR Cancelado ÷ (MRR Atual + MRR Cancelado)",
  },
  mc_total: {
    title: "MC Total (R$)",
    definition: "Margem de contribuição total — quanto sobra da receita após pagar custos operacionais, impostos e custos fixos alocados.",
    why_it_matters: "Se MC é positiva, cada cliente contribui para o lucro. Se negativa, a operação perde dinheiro a cada venda.",
    formula: "MRR − COGS − Impostos (R$) − Custos Fixos (R$)",
  },
  mc_percent_ponderada: {
    title: "MC% Ponderada",
    definition: "Margem de contribuição como percentual da receita, ponderada pelo valor de cada cliente.",
    why_it_matters: "Indica a eficiência financeira da operação. Meta saudável: acima de 30%. Abaixo de 10% é crítico.",
    formula: "MC Total ÷ MRR Total",
    example: "MC R$ 15.000 ÷ MRR R$ 50.000 = 30%",
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
    definition: "Receita líquida total esperada de um cliente ao longo de sua vida, considerando a margem de contribuição.",
    why_it_matters: "É o valor real que o cliente traz. Deve ser pelo menos 3x o CAC para o negócio ser saudável.",
    formula: "ARPA × MC% Ponderada × LTV (meses)",
  },
  ltv_cac_recorrente: {
    title: "LTV/CAC Recorrente",
    definition: "Quantas vezes o valor do cliente supera o custo de adquiri-lo.",
    why_it_matters: "≥ 3x = saudável; entre 1x e 3x = atenção; < 1x = a empresa perde dinheiro a cada cliente.",
    formula: "LTV Recorrente (R$) ÷ CAC por Logo",
    example: "LTV R$ 9.000 ÷ CAC R$ 3.000 = 3x",
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
  },
  grr: {
    title: "GRR (Gross Revenue Retention)",
    definition: "Quanto da receita do início do período foi mantida, desconsiderando expansões.",
    why_it_matters: "Mostra a capacidade de reter receita existente. Meta: > 90%. Máximo possível: 100%.",
    formula: "(MRR início − churn − downsell) ÷ MRR início",
  },
  concentracao_top10: {
    title: "Concentração Top 10",
    definition: "Percentual do MRR total que vem dos 10 maiores clientes.",
    why_it_matters: "Acima de 50% é um risco: perder 1-2 clientes grandes pode impactar muito a receita.",
    formula: "MRR dos 10 maiores clientes ÷ MRR Total",
  },
  quick_ratio: {
    title: "Quick Ratio",
    definition: "Razão entre MRR adicionado e MRR perdido. Mede a saúde do crescimento.",
    why_it_matters: "≥ 4 = excelente (cresce rápido); < 1 = encolhendo; entre 1-4 = crescendo devagar.",
    formula: "(New MRR + Expansion) ÷ (Churn + Contraction)",
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
  },
  arpa: {
    title: "ARPA (mês)",
    definition: "Receita média por conta (cliente ativo), excluindo receita de ativação/setup.",
    why_it_matters: "Métrica estritamente recorrente. Usado no cálculo de LTV. Não inclui setup fees.",
    formula: "MRR Snapshot ÷ Clientes Ativos",
  },
  cac_payback: {
    title: "CAC Payback (meses)",
    definition: "Tempo necessário para recuperar o investimento feito para adquirir um cliente.",
    why_it_matters: "Ideal ≤ 12 meses. Acima disso, o capital fica preso por muito tempo.",
    formula: "CAC por Logo ÷ (ARPA × MC%)",
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
};

export default kpiHelp;

/** Fallback entry for KPIs not yet in the dictionary */
export const kpiHelpFallback: KpiHelpEntry = {
  title: "Indicador",
  definition: "Definição em construção. Consulte o admin.",
  why_it_matters: "Em breve teremos a explicação completa deste indicador.",
  formula: "—",
};
