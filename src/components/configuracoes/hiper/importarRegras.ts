/**
 * As regras da importação, fora do componente.
 *
 * Elas decidem quem pode virar cadastro e o que ainda falta preencher — é o que
 * trava o botão Confirmar. Separadas da tela porque é o que precisa de teste:
 * montar o diálogo inteiro só para verificar uma conta que não pode entrar
 * custaria mock de rede e não provaria mais nada.
 */
import { maskPhoneBR } from "@/lib/masks";
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
/**
 * Mensalidade válida — e zero NÃO é.
 *
 * A régua antiga aceitava 0, e a RPC também só recusa negativo. Numa conta de
 * Hiperador isso cria exatamente o que a obrigatoriedade existe para impedir:
 * cliente sem receita nenhuma com o custo do portal saindo todo mês.
 *
 * Cortesia legítima (R$ 0,00 de verdade) não entra pelo lote: cadastra pela
 * ficha. Se virar volume, vira marcação explícita — nunca um zero digitado no
 * meio dos outros.
 */
export const mensalidadeOk = (v: string) =>
  v.trim() !== "" && Number.isFinite(Number(v.replace(",", "."))) && Number(v.replace(",", ".")) > 0;

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
    return !mensalidadeOk(d.mensalidade) || !emailOk(d.email) || !zapOk(d.whatsapp);
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

/**
 * O contato como o espelho guarda. Dois pares: o da conta e o da pessoa de
 * contato — o portal preenche ora um, ora o outro.
 */
export type ContatoEspelho = {
  id_portal: string;
  email: string | null;
  contato_email: string | null;
  telefone: string | null;
  contato_telefone: string | null;
};

const primeiro = (...vs: (string | null | undefined)[]) =>
  vs.map((v) => (v ?? "").trim()).find((v) => v !== "") ?? "";

/**
 * O cartão de uma conta já preenchido com o que o portal entregou.
 *
 * Medido em 10/09/2026 nas 998 contas do espelho: e-mail em 998, telefone em
 * 998. A tela pedia os dois à mão, conta a conta — trabalho inventado, e o que
 * inviabilizava importar centenas de uma vez.
 *
 * Mensalidade continua sendo a exceção deliberada: `mensalidadeDoPortal` só
 * semeia quando o portal sabe o preço. Área e segmento não existem lá.
 */
export function semearConta(r: LinhaRecon, contato?: ContatoEspelho): PorConta {
  const fone = primeiro(contato?.telefone, contato?.contato_telefone);
  return {
    ...contaVazia,
    mensalidade: mensalidadeDoPortal(r),
    email: primeiro(contato?.email, contato?.contato_email),
    // Máscara na semeadura: o espelho guarda só dígitos e o campo da tela é
    // mascarado. Sem isso a primeira tecla digitada reformataria o número
    // inteiro na frente da pessoa.
    whatsapp: fone ? maskPhoneBR(fone) : "",
  };
}

/**
 * Fixo num campo chamado WhatsApp.
 *
 * 472 dos 998 telefones do espelho têm 10 dígitos. Marcar é obrigatório: a
 * operação usa esse número para falar com o cliente, e descobrir só na hora do
 * envio que ele não tem WhatsApp é tarde.
 *
 * Menos de 10 dígitos não é fixo, é incompleto — `zapOk` já barra, e um segundo
 * aviso diria outra coisa sobre o mesmo defeito.
 */
export const telefoneEhFixo = (v: string) => v.replace(/\D/g, "").length === 10;

/** O teto que `hiper_importar_contas` impõe por chamada. */
export const TETO_LOTE = 200;

const CENTRAL = ["central_cobranca", "central_leads"];

/**
 * As duas faixas de trabalho, decididas por tipo de contrato E presença de valor.
 *
 * Medido em 10/09/2026, só contas ativas:
 * - Hiperador: 352 contas, **0** com MRR no portal. Nessas quem cobra o cliente
 *   é a revenda; o portal só conhece o custo. Vai sempre para a faixa manual,
 *   mesmo se um dia vier valor — ali o valor do portal é suspeito, não fonte.
 * - Central de Cobrança: 113 ativas, 108 com valor. Central de Leads: 155, 141.
 *   Sobram **19 sem valor** — e é por isso que o tipo sozinho não decide.
 *   Assumir que Central sempre tem preço criaria 19 clientes com R$ 0,00 e
 *   custo saindo.
 */
export function separarFaixas(novas: LinhaRecon[]) {
  const automatica = (c: LinhaRecon) =>
    CENTRAL.includes(c.responsavel_tipo ?? "") && mensalidadeDoPortal(c) !== "";
  return {
    prontas: novas.filter(automatica),
    faltaValor: novas.filter((c) => !automatica(c)),
  };
}

/** Quebra o lote no tamanho que a RPC aceita por chamada. */
export function fatiar<T>(itens: T[], tamanho: number = TETO_LOTE): T[][] {
  const fatias: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) fatias.push(itens.slice(i, i + tamanho));
  return fatias;
}

/**
 * O que vai nesta rodada: marcado E completo.
 *
 * É o que faz "importar aos poucos" funcionar na faixa manual — preenche um
 * punhado, manda, e o resto continua na lista. Marcado mas incompleto fica de
 * fora em silêncio seria pior do que recusar: a tela diz quantos ficaram.
 */
export function prontasParaEnviar(
  contas: LinhaRecon[], porConta: Record<string, PorConta>, marcadas: Set<string>,
) {
  return contas.filter((c) => {
    if (!marcadas.has(c.id)) return false;
    const d = porConta[c.id] ?? contaVazia;
    return mensalidadeOk(d.mensalidade) && emailOk(d.email) && zapOk(d.whatsapp);
  });
}

/**
 * Quem saiu da lista porque a RPC confirmou a criação.
 *
 * A RPC identifica o que criou pela RAZÃO SOCIAL, e 14 das 998 contas do
 * espelho têm nome repetido. Com duas homônimas no mesmo envio não há como
 * saber qual entrou — e tirar a errada esconderia da tela uma conta que nunca
 * foi criada, sem aviso nenhum. Nesse caso as duas ficam: a que já entrou é
 * recusada na próxima tentativa, com motivo visível.
 */
export function entraramComCerteza(
  fatia: LinhaRecon[], criados: { conta?: string | null }[],
) {
  const vezesNoLote = new Map<string, number>();
  for (const c of fatia) {
    const n = c.razao_social_hiper ?? "";
    vezesNoLote.set(n, (vezesNoLote.get(n) ?? 0) + 1);
  }
  const nomesCriados = new Set(criados.map((c) => c.conta ?? ""));
  const ids = new Set<string>();
  for (const c of fatia) {
    const n = c.razao_social_hiper ?? "";
    if (vezesNoLote.get(n) === 1 && nomesCriados.has(n)) ids.add(c.id);
  }
  return ids;
}
