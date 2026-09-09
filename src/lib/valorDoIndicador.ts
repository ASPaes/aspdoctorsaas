import type { CatalogEntry, KpiFormat } from "@/lib/kpiCatalog";

/** Segue um caminho como "totais.mrr_coberto" dentro do objeto do provider.
 *  Devolve `undefined` para qualquer tropeço — caminho errado não derruba a
 *  tela, vira travessão. */
export function lerCaminho(raiz: unknown, caminho: string): unknown {
  if (raiz === null || raiz === undefined) return undefined;
  let atual: unknown = raiz;
  for (const parte of caminho.split(".")) {
    if (atual === null || atual === undefined || typeof atual !== "object") return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const doisDec = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Segundos → "1m48s" / "2h05m". A tela de Atendimento mostra assim. */
export function formatarDuracao(seg: number): string {
  const s = Math.max(0, Math.round(seg));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}m`;
}

export const SEM_VALOR = "—";

export function formatarValor(valor: unknown, formato: KpiFormat): string {
  if (valor === null || valor === undefined) return SEM_VALOR;

  if (formato === "text") {
    const t = String(valor).trim();
    return t || SEM_VALOR;
  }

  /** Vários indicadores apontam para uma LISTA e o que a tela mostra é o
   *  tamanho dela ("Produtos com Tickets" = por_produto.length). Contar aqui
   *  é o que a §5.0 manda: o painel refaz a conta, sem tocar na tela. */
  if (Array.isArray(valor)) return inteiro.format(valor.length);

  const n = typeof valor === "number" ? valor : Number(valor);

  /** Infinito é resultado LEGÍTIMO de razão: o Quick Ratio da tela mostra ∞
   *  quando não houve nenhuma perda no período. Tem que passar antes do
   *  descarte de não-finito, senão vira travessão e some a informação. */
  if (formato === "ratio" && n === Infinity) return "∞";
  if (!Number.isFinite(n)) return SEM_VALOR;

  switch (formato) {
    case "currency":
      return brl.format(n);
    case "percent":
      return `${doisDec.format(n).replace(",00", "")}%`;
    case "integer":
      return inteiro.format(n);
    case "decimal":
      return doisDec.format(n);
    case "ratio":
      return `${doisDec.format(n)}x`;
    case "duration":
      return formatarDuracao(n);
    default:
      return inteiro.format(n);
  }
}

/** Valor cru, para a barra de benchmark do KPICardEnhanced posicionar o
 *  marcador. Só faz sentido quando é número de verdade. */
export function valorNumerico(valor: unknown): number | undefined {
  if (Array.isArray(valor)) return valor.length;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : undefined;
}

export function resolverIndicador(entrada: CatalogEntry, dados: unknown) {
  const cru = lerCaminho(dados, entrada.source.path);
  return {
    texto: formatarValor(cru, entrada.format),
    numero: valorNumerico(cru),
    ausente: cru === null || cru === undefined,
  };
}
