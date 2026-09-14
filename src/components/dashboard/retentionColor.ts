/**
 * Escala de cor de retencao, compartilhada pelo cohort de receita (Dashboard) e
 * pelo de permanencia (Onboarding). Vivia local no `CohortTab`; as duas telas
 * precisam ler igual, e duas copias divergiriam na primeira mudanca de faixa.
 */
export function getRetentionColor(percent: number | null): string {
  if (percent == null) return '';
  if (percent >= 90) return 'bg-emerald-600/90 text-white';
  if (percent >= 80) return 'bg-emerald-500/70 text-white';
  if (percent >= 70) return 'bg-emerald-400/50 text-foreground';
  if (percent >= 60) return 'bg-yellow-400/50 text-foreground';
  if (percent >= 50) return 'bg-orange-400/50 text-foreground';
  if (percent >= 30) return 'bg-orange-500/60 text-white';
  return 'bg-destructive/60 text-white';
}
