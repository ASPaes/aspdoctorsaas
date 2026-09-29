import type { CSSProperties } from "react";

/**
 * Cor por caixa de e-mail (DEM-0497). A conta guarda um hex em
 * `email_accounts.cor` e escolhe em `cor_modo` onde ele aparece na tela E-mails:
 * 'linha' pinta a linha inteira, 'email' pinta só o endereço. Sem cor, nada muda.
 */
export type CorModo = "linha" | "email";

export interface CorDaCaixa {
  cor?: string | null;
  cor_modo?: CorModo | string | null;
}

export const CORES_DA_CAIXA: { hex: string; nome: string }[] = [
  { hex: "#3B82F6", nome: "Azul" },
  { hex: "#22C55E", nome: "Verde" },
  { hex: "#EAB308", nome: "Amarelo" },
  { hex: "#F97316", nome: "Laranja" },
  { hex: "#EF4444", nome: "Vermelho" },
  { hex: "#EC4899", nome: "Rosa" },
  { hex: "#8B5CF6", nome: "Roxo" },
  { hex: "#06B6D4", nome: "Ciano" },
  { hex: "#64748B", nome: "Cinza" },
];

const faixa = (hex: string): CSSProperties => ({ boxShadow: `inset 3px 0 0 ${hex}` });

/**
 * Estilos prontos para a linha da tabela. `linha` vai no <tr>, `faixa` na
 * primeira célula (box-shadow no <tr> não desenha em todo navegador) e `email`
 * no bloco do endereço. Linha selecionada fica com o destaque de seleção.
 */
export function estiloDaCaixa(conta: CorDaCaixa | null | undefined, selecionada = false) {
  const hex = conta?.cor;
  if (!hex) return { linha: undefined, faixa: undefined, email: undefined };
  if (conta?.cor_modo === "linha") {
    return {
      linha: selecionada ? undefined : ({ backgroundColor: `${hex}24` } as CSSProperties),
      faixa: faixa(hex),
      email: undefined,
    };
  }
  return {
    linha: undefined,
    faixa: undefined,
    email: { ...faixa(hex), backgroundColor: `${hex}33` } as CSSProperties,
  };
}
