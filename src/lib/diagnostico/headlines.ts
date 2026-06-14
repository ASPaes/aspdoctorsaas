import type { DiagnosticoInput, DiagnosticoTab, Severity } from './types';

/**
 * Seleciona a melhor headline para o estado atual.
 * Prioridade: padrões específicos da aba > padrões genéricos de problema > padrões saudáveis.
 */
export function buildHeadline(
  input: DiagnosticoInput,
  severity: Severity,
  tab?: DiagnosticoTab,
): string {
  // Aba sem cobertura de diagnóstico — não assumir saúde nem risco
  if (severity === 'indeterminado') {
    return input.comparativoIndeterminado === true
      ? 'Dados insuficientes para avaliar este período com segurança (amostra pequena, início de mês ou intervalo fora de um mês fechado).'
      : 'Esta aba ainda não tem cobertura de diagnóstico — não dá pra afirmar saúde nem risco com os dados atuais.';
  }

  // ─── Padrões específicos da aba Cancelamentos ───
  if (tab === 'cancelamentos') {
    // Concentração crítica de motivo (risco binário)
    if (input.motivoConcentradoPct !== undefined && input.motivoConcentradoPct > 0.25) {
      return `Cancelamento concentrado em um único motivo — risco binário. Resolver um problema resolve a maior parte da sangria.`;
    }

    // Segmento crítico (incêndio focal)
    if (input.segmentoChurnMax !== undefined && input.segmentoChurnMax > 0.5) {
      return `Um segmento da carteira está sangrando — antes de expandir nesse vertical, entender por quê.`;
    }

    // Tendência subindo forte (problema emergente)
    if (input.tendenciaSubindoFator !== undefined && input.tendenciaSubindoFator > 1.3) {
      return `Cancelamentos estão acelerando — motivo emergente sinaliza problema novo, não estrutural. Janela curta pra agir.`;
    }

    // Origem perigosa (canal de aquisição trazendo cliente que cancela)
    if (input.origemMaxChurn !== undefined && input.origemMaxChurn >= 0.05) {
      return `Existe canal de aquisição trazendo cliente que cancela demais. Revisar ICP/qualidade de lead dessa origem ou cortar investimento nela.`;
    }

    // Early Churn alto (onboarding/ICP)
    if (input.earlyChurnRate !== undefined && input.earlyChurnRate > 0.2) {
      return `Cliente está saindo antes de ver valor. Onboarding fraco ou ICP errado — você perde antes mesmo do produto provar nada.`;
    }

    // Win-back zero em base madura
    if (
      input.winbackTotal12m !== undefined && input.winbackTotal12m === 0 &&
      input.clientesAtivos !== undefined && input.clientesAtivos >= 100
    ) {
      return `Cliente que sai vira receita perdida permanente. Sem processo de reativação, você reinventa a roda toda venda.`;
    }

    // Mortalidade alta (desuso)
    if (input.mortalidadeQtdPct !== undefined && input.mortalidadeQtdPct > 0.2) {
      return `Clientes morrem por desuso, não por preço — sinal forte de baixa adoção do produto.`;
    }
  }

  // ─── Padrões específicos da aba Crescimento ───
  if (tab === 'crescimento') {
    // Crescimento dependente de aquisição (expansion fraca + R40 baixo)
    if (
      input.expansionRate !== undefined && input.expansionRate < 0.02 &&
      input.ruleOf40 !== undefined && input.ruleOf40 < 40
    ) {
      return `Crescimento sustentado, mas dependente de aquisição. Sem expansão da base, cada mês exige reposição completa via novas vendas.`;
    }
    // Máquina cara de crescimento (Burn Multiple alto OU Magic Number baixo)
    if (
      (input.burnMultiple !== undefined && input.burnMultiple > 1.5) ||
      (input.magicNumber !== undefined && input.magicNumber < 0.5)
    ) {
      return `Crescer está caro. Cada R$ de receita exige mais investimento do que devolve — eficiência marginal abaixo do saudável.`;
    }
    // Crescimento estagnado (Growth MoM + ARR YoY baixos)
    if (
      input.growthRateMoM !== undefined && input.growthRateMoM < 0.02 &&
      input.arrGrowthYoY !== undefined && input.arrGrowthYoY < 0.15
    ) {
      return `Crescimento estagnado em MoM e YoY. Falta motor — seja em aquisição, expansão ou pricing.`;
    }
    // Crescimento acelerando (Growth Persistence alta)
    if (input.growthPersistence !== undefined && input.growthPersistence >= 1) {
      return `Crescimento acelerando. A taxa de crescimento deste ciclo supera a do ciclo anterior — momentum positivo.`;
    }
  }

  // ─── Padrões específicos da aba Vendas ───
  if (tab === 'vendas' && input.vendasComparavel === true) {
    const efQtd = input.vendasEhMesCorrente ? input.vendasQtdProj : input.vendasQtdAtual;
    const efMrr = input.vendasEhMesCorrente ? input.vendasMrrProj : input.vendasMrrAtual;
    if (input.vendasQtdMedia3m && input.vendasQtdMedia3m > 0 && efQtd !== undefined && (efQtd / input.vendasQtdMedia3m) < 0.5) {
      return input.vendasEhMesCorrente
        ? `No ritmo atual o mês de vendas fecha bem abaixo da média recente — a máquina de aquisição desacelerou e precisa de atenção agora.`
        : `O mês fechou com vendas bem abaixo da média recente — a máquina de aquisição perdeu tração.`;
    }
    if (input.vendasMrrYoY && input.vendasMrrYoY > 0 && efMrr !== undefined && (efMrr / input.vendasMrrYoY) < 0.7) {
      return `Vendas abaixo do mesmo mês do ano passado — não é sazonalidade esperada, é queda real de aquisição.`;
    }
    if (input.vendasTicketMedia3m && input.vendasTicketMedia3m > 0 && input.vendasTicketAtual !== undefined && (input.vendasTicketAtual / input.vendasTicketMedia3m) < 0.85) {
      return `O ticket médio das vendas novas caiu vs a média recente — perda de poder de pricing ou mix de produto pior.`;
    }
  }

  // Padrão #1: Motor comercial vs hemorragia (mais grave e mais comum)
  const newMrr = input.newMrr ?? 0;
  const lost = (input.mrrCancelado ?? 0) + (input.downsellMrr ?? 0);
  if (lost > 0 && newMrr > 0 && newMrr / lost < 0.15) {
    const ratio = Math.round(lost / newMrr);
    return `O motor comercial não compensa a hemorragia da base. A cada R$ 1 que entra, R$ ${ratio} saem.`;
  }

  // Padrão #2: NRR encolhendo com expansão parada
  if (input.nrr !== undefined && input.nrr < 0.9 && input.grr !== undefined && (input.nrr - input.grr) < 0.05) {
    return `Receita encolhe sem motor de expansão. Sem upsell ou cross-sell para compensar as perdas, cada mês a base fica menor.`;
  }

  // Padrão #3: NRR > 110% (expansão saudável)
  if (input.nrr !== undefined && input.nrr >= 1.1) {
    return `A base cresce sozinha. Mesmo sem novos clientes, a expansão compensa as perdas — o motor de retenção está saudável.`;
  }

  // Padrão #4: GRR alto mas Quick Ratio baixo (retém mas não cresce)
  if (input.grr !== undefined && input.grr >= 0.9 && input.quickRatio !== undefined && input.quickRatio < 1) {
    return `Base estável, crescimento estagnado. Retenção forte mas o motor de aquisição não está entregando.`;
  }

  // Fallback por severidade
  if (severity === 'crit') {
    return 'Estado crítico — múltiplos indicadores em zona vermelha demandam ação imediata.';
  }
  if (severity === 'warn') {
    return 'Indicadores mistos — alguns sinais de atenção que merecem ação preventiva.';
  }
  return 'Indicadores em zona saudável — manter cadência operacional atual.';
}
