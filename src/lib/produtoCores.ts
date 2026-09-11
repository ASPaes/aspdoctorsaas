/**
 * Paleta do selo de produto na lista de conversas do chat.
 *
 * O banco guarda só a CHAVE (`produtos.cor`); as classes ficam aqui, com um tom
 * para o tema claro e outro para o escuro. NULL ou chave desconhecida = padrão
 * (azul-claro), a cor que todo produto tinha antes de existir a escolha.
 *
 * As classes são strings inteiras de propósito: o Tailwind só gera o que
 * encontra escrito no código, `bg-${cor}-500` montado em tempo de execução
 * sairia sem estilo.
 */
export interface ProdutoCor {
  /** Valor gravado em `produtos.cor`. `null` = padrão. */
  key: string | null;
  label: string;
  /** Borda, fundo e texto do selo. */
  badge: string;
  /** Bolinha usada no seletor e na tabela de produtos. */
  dot: string;
}

export const PRODUTO_COR_PADRAO: ProdutoCor = {
  key: null,
  label: "Padrão",
  badge: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  dot: "bg-sky-500",
};

export const PRODUTO_CORES: ProdutoCor[] = [
  PRODUTO_COR_PADRAO,
  { key: "azul", label: "Azul", badge: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  { key: "verde", label: "Verde", badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  { key: "verde_agua", label: "Verde-água", badge: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300", dot: "bg-teal-500" },
  { key: "amarelo", label: "Amarelo", badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  { key: "laranja", label: "Laranja", badge: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300", dot: "bg-orange-500" },
  { key: "vermelho", label: "Vermelho", badge: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300", dot: "bg-red-500" },
  { key: "rosa", label: "Rosa", badge: "border-pink-500/40 bg-pink-500/10 text-pink-700 dark:text-pink-300", dot: "bg-pink-500" },
  { key: "roxo", label: "Roxo", badge: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  { key: "cinza", label: "Cinza", badge: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300", dot: "bg-slate-500" },
];

export function produtoCor(key: string | null | undefined): ProdutoCor {
  if (!key) return PRODUTO_COR_PADRAO;
  return PRODUTO_CORES.find((c) => c.key === key) ?? PRODUTO_COR_PADRAO;
}
