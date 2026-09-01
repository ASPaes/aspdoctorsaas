/**
 * As regras da importação, fora do componente.
 *
 * Elas decidem quem pode virar cadastro e o que ainda falta preencher — é o que
 * trava o botão Confirmar. Separadas da tela porque é o que precisa de teste:
 * montar o diálogo inteiro só para verificar uma conta que não pode entrar
 * custaria mock de rede e não provaria mais nada.
 */
import type { LinhaRecon } from "./useHiperDados";

export type PorConta = {
  mensalidade: string;
  email: string;
  whatsapp: string;
  area_atuacao_id: string;
  segmento_id: string;
};

export const contaVazia: PorConta = {
  mensalidade: "", email: "", whatsapp: "", area_atuacao_id: "", segmento_id: "",
};

/** Cadastro que já existe aqui para o CNPJ de uma conta do portal. */
export type JaCadastrado = {
  id: string;
  codigo_sequencial: number | null;
  razao_social: string | null;
  cancelado: boolean | null;
  cnpj_digits: string;
};

export const emailOk = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
export const zapOk = (v: string) => v.replace(/\D/g, "").length >= 10;
export const numeroOk = (v: string) =>
  v.trim() !== "" && Number.isFinite(Number(v.replace(",", "."))) && Number(v.replace(",", ".")) >= 0;

/**
 * A mensalidade que o portal informa — e só ela.
 *
 * Nas contas de Hiperador quem cobra o cliente é a revenda, e o portal não
 * conhece o preço: ele manda nulo ou zero. Semear zero no campo faria o
 * operador confirmar sem perceber e criar cliente sem receita com custo saindo.
 */
export const mensalidadeDoPortal = (r: LinhaRecon) =>
  r.mrr_hiper != null && Number(r.mrr_hiper) > 0 ? Number(r.mrr_hiper).toFixed(2) : "";

/**
 * Divide as contas entre as que viram cadastro novo e as que não podem.
 *
 * A reconciliação chama de "sem cliente aqui" toda conta cujo CNPJ não tem
 * cadastro COM CONTRATO ATIVO do Hiper. Cliente cancelado e sem produto entra
 * nessa conta — e para ele criar outro cadastro duplicaria a base. Medido em
 * 01/09: 5 das 12 contas sem dono já tinham cadastro, 4 deles cancelados.
 */
export function separarContas(contas: LinhaRecon[], existentes: JaCadastrado[]) {
  const mapa = new Map<string, JaCadastrado[]>();
  for (const c of existentes) {
    mapa.set(c.cnpj_digits, [...(mapa.get(c.cnpj_digits) ?? []), c]);
  }
  return {
    mapa,
    novas: contas.filter((c) => !c.cnpj_norm || !mapa.has(c.cnpj_norm)),
    bloqueadas: contas.filter((c) => c.cnpj_norm && mapa.has(c.cnpj_norm)),
  };
}

/** Quantas contas ainda têm obrigatório em branco. Área e segmento não contam. */
export function contarFaltando(novas: LinhaRecon[], porConta: Record<string, PorConta>) {
  return novas.filter((c) => {
    const d = porConta[c.id] ?? contaVazia;
    return !numeroOk(d.mensalidade) || !emailOk(d.email) || !zapOk(d.whatsapp);
  }).length;
}

/**
 * A recorrência mora no NOME do plano ("Hiper Gestão - Anual"), não num campo.
 * Espelha exatamente o `case` da RPC hiper_importar_contas — se as duas
 * discordarem, a tela mostra uma coisa e o banco grava outra.
 */
export function recorrenciaDoPlano(plano: string | null | undefined) {
  const p = plano ?? "";
  if (/anual/i.test(p)) return "anual";
  if (/semestral/i.test(p)) return "semestral";
  if (/semanal/i.test(p)) return "semanal";
  return "mensal";
}
