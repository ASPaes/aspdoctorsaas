/**
 * A linha de jornada que o drill-down da faixa de situação mostra, e os três
 * cálculos que tela e planilha fazem sobre ela.
 *
 * Mora fora do componente porque o exportador de Excel precisa dos mesmos
 * rótulos e da mesma conta de dias: deixá-los no .tsx faria a planilha importar
 * o componente e fecharia um ciclo entre os dois arquivos.
 */
/**
 * Uma jornada na lista que abre ao clicar num cartão da faixa de situação. É a
 * lista de CLIENTES que o cartão conta (DEM-0439), então o nome do cliente é a
 * primeira coluna; `journeyId` serve ao link que abre a jornada no quadro.
 */
export interface LinhaJornada {
  journeyId: string;
  cliente: string;
  responsavel: string;
  situacao: string | null;
  abertaEm: string | null;
  /** Conclusão ou cancelamento — o carimbo que fechou a jornada. `null` = ainda aberta. */
  fechadaEm: string | null;
}

const ROTULO_SITUACAO: Record<string, string> = {
  nao_iniciado: "Não iniciada",
  em_andamento: "Em andamento",
  parado: "Parada",
  concluido: "Concluída",
  cancelado: "Cancelada",
};

export const COR_SITUACAO: Record<string, string> = {
  nao_iniciado: "text-muted-foreground",
  em_andamento: "text-[hsl(199_89%_48%)]",
  parado: "text-[hsl(38_92%_50%)]",
  concluido: "text-[hsl(142_71%_45%)]",
  cancelado: "text-destructive",
};

export function rotuloSituacao(s: string | null): string {
  return (s && ROTULO_SITUACAO[s]) || "—";
}

/** Data em dd/mm/aa pelo fuso do navegador. O carimbo vem em UTC e `slice` no ISO
 *  mostraria o dia seguinte para tudo que acontece depois das 21h em São Paulo. */
export function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Dias corridos entre abertura e desfecho — ou até hoje, quando não há desfecho. */
export function diasDeVida(l: LinhaJornada): number | null {
  if (!l.abertaEm) return null;
  const de = new Date(l.abertaEm).getTime();
  const ate = l.fechadaEm ? new Date(l.fechadaEm).getTime() : Date.now();
  if (Number.isNaN(de) || Number.isNaN(ate)) return null;
  return Math.max(0, Math.floor((ate - de) / 86_400_000));
}
