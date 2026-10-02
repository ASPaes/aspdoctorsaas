// Montagem do prompt e regra do alerta de churn. TS puro (sem Deno), para o
// vitest cobrir: é aqui que mora a regra que decide se um WhatsApp de "risco de
// churn" sai para o gestor.
//
// Regra (Alexandre, 01/10/2026): churn é SÓ cancelar/trocar o sistema, o
// contrato, o serviço ou a empresa. "Cancelar a nota/cupom/venda/boleto" é
// suporte operacional. Foi o alerta de 30/09: cliente pedindo para cancelar uma
// venda no PDV ("Então preciso cancelar") e o modelo premium confirmando churn
// 6 vezes, porque o prompt dizia "menção direta a cancelar" sem dizer cancelar
// O QUÊ. Agora a IA classifica o objeto e quem decide o alerta é o código.

export interface MensagemAnalise {
  content: string | null;
  timestamp: string;
  audio_transcription: string | null;
  message_type: string | null;
  is_from_me: boolean;
}

/** Teto de mensagens no prompt. Atendimento de 30 dias: mediana 14, p90 46. */
export const MAX_MENSAGENS = 60;
/** Num atendimento maior que o teto, o começo fica: é onde o cliente diz do que se trata. */
export const MENSAGENS_DO_INICIO = 10;

/** Não é conversa: entra no atendimento mas só polui o contexto. */
const TIPOS_FORA = new Set(["system", "reaction", "revoked", "protocolMessage"]);

const ROTULO_MIDIA: Record<string, string> = {
  image: "imagem", video: "vídeo", document: "documento", sticker: "figurinha",
  audio: "áudio", contacts: "contato", location: "localização",
};

// Texto que o webhook grava quando a mídia não tem legenda.
const PLACEHOLDER_MIDIA = /^(📷 Imagem|🎵 Áudio|🎥 Vídeo|📄 Documento|🎨 Sticker|👤 \d+ contatos?|Sent (image|audio|video|document|sticker))$/;

export function ehConversa(m: Pick<MensagemAnalise, "message_type">): boolean {
  return !TIPOS_FORA.has(m.message_type ?? "");
}

/**
 * Recebe as mensagens do atendimento em ordem cronológica. Tira o que não é
 * conversa e, se passar do teto, mantém o começo e o fim.
 */
export function selecionarMensagens(msgs: MensagemAnalise[]): MensagemAnalise[] {
  const conversa = msgs.filter(ehConversa);
  if (conversa.length <= MAX_MENSAGENS) return conversa;
  return [
    ...conversa.slice(0, MENSAGENS_DO_INICIO),
    ...conversa.slice(conversa.length - (MAX_MENSAGENS - MENSAGENS_DO_INICIO)),
  ];
}

function textoDa(m: MensagemAnalise): string {
  const tipo = m.message_type ?? "text";
  if (tipo === "audio" && m.audio_transcription) return `[áudio transcrito] "${m.audio_transcription}"`;
  const conteudo = (m.content ?? "").trim();
  const rotulo = ROTULO_MIDIA[tipo];
  if (!rotulo) return `"${conteudo}"`;
  if (!conteudo || PLACEHOLDER_MIDIA.test(conteudo)) return `[${rotulo}]`;
  return `[${rotulo}] "${conteudo}"`;
}

export function formatarMensagens(msgs: MensagemAnalise[], omitidas = 0): string {
  const linhas = msgs.map((m) => {
    const quem = m.is_from_me ? "[Atendente]" : "[Cliente]";
    const quando = new Date(m.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return `${quem} [${quando}]: ${textoDa(m)}`;
  });
  if (omitidas > 0) linhas.splice(MENSAGENS_DO_INICIO, 0, `(... ${omitidas} mensagens do meio do atendimento omitidas ...)`);
  return linhas.join("\n");
}

export const ALVOS_CANCELAMENTO = ["contrato_servico", "documento_operacao", "indefinido", "nenhum"] as const;
export type AlvoCancelamento = typeof ALVOS_CANCELAMENTO[number];

export const ALVOS_IRRITACAO = ["atendimento", "produto", "externo", "nenhum"] as const;
export type AlvoIrritacao = typeof ALVOS_IRRITACAO[number];

export function montarPrompt(mensagens: string): string {
  return `Voce le um atendimento de suporte por WhatsApp de uma empresa de software (ERP, PDV, emissor de notas) e responde tres coisas: o sentimento do CLIENTE, se ele quer cancelar o CONTRATO e contra quem e a irritacao dele.

Atendimento completo (mais antigas para mais recentes):
${mensagens}

1) SENTIMENTO do cliente (use as respostas do atendente como contexto):
- positive: satisfeito, agradecido, elogiando.
- neutral: tom profissional, duvidas, relato de erro do sistema SEM insatisfacao com o atendimento ou com a empresa. Relatar problema tecnico e NORMAL e NAO e negativo, mesmo nao resolvido.
- negative: insatisfacao dirigida ao ATENDIMENTO ou a EMPRESA (demora, descaso, "de novo isso", "sempre a mesma coisa"), tom hostil.

2) CANCELAMENTO — leia o atendimento INTEIRO para saber O QUE o cliente quer cancelar. A palavra "cancelar" sozinha NAO diz nada: neste suporte o cliente cancela documentos o dia inteiro.
- "contrato_servico": quer cancelar/encerrar/rescindir o contrato, o sistema, a assinatura ou o servico, trocar de fornecedor/sistema, ou parar de ser cliente. Ex.: "quero cancelar o sistema", "vou trocar de sistema", "pode encerrar meu contrato", "nao quero mais usar".
- "documento_operacao": quer cancelar algo DENTRO do sistema — nota fiscal, NF-e, NFC-e, cupom, venda, pedido, orcamento, boleto, titulo, lancamento, pagamento, operacao do PDV, um valor passado errado. Ex.: "preciso cancelar a nota", "como cancelo essa venda", "cancelar o cupom", "passei errado, preciso cancelar". Isto e SUPORTE, nunca churn.
- "indefinido": fala em cancelar e o atendimento nao deixa claro o que.
- "nenhum": nao fala em cancelar nada.

Responda needs_cs_ticket = true SOMENTE se cancel_target = "contrato_servico". Nesse caso churn_evidence e a frase LITERAL (copiada) do cliente que mostra a intencao de cancelar o contrato/servico. Sem frase literal, needs_cs_ticket = false.

3) IRRITACAO — se o cliente demonstra irritacao, impaciencia ou insatisfacao, CONTRA QUEM ela e dirigida:
- "atendimento": a nossa equipe ou empresa — demora para responder, falta de retorno, promessa nao cumprida, ter que repetir, ser transferido, descaso, "ninguem resolve". Ex.: "ja deu mais de um mes e ninguem me retornou", "voces demoram demais".
- "produto": o nosso sistema — erro que se repete, instabilidade, falta de recurso, atualizacao que atrapalhou. Ex.: "todo dia aparece um erro novo", "de novo esse problema".
- "externo": algo fora da nossa empresa — SEFAZ/prefeitura fora do ar, banco, internet, maquininha, contador, cliente dele, o dia dele. Ex.: "a SEFAZ caiu de novo", "meu contador nao manda nada".
- "nenhum": sem irritacao (duvida, relato calmo de problema, agradecimento).
Se nao for "nenhum", irritation_evidence e a frase LITERAL (copiada) do cliente. Relatar um problema com calma NAO e irritacao.`;
}

export const FERRAMENTA_ANALISE = {
  type: "function",
  function: {
    name: "analyze_sentiment",
    description: "Analisa o sentimento do cliente e a intencao de cancelar o contrato",
    parameters: {
      type: "object",
      properties: {
        sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
        confidence: { type: "number" },
        summary: { type: "string" },
        keywords: { type: "array", items: { type: "string" } },
        cancel_target: { type: "string", enum: [...ALVOS_CANCELAMENTO], description: "O que o cliente quer cancelar" },
        irritation_target: { type: "string", enum: [...ALVOS_IRRITACAO], description: "Contra quem e a irritacao do cliente" },
        irritation_evidence: { type: "string", description: "Citacao literal do cliente que mostra a irritacao" },
        needs_cs_ticket: { type: "boolean" },
        cs_ticket_reason: { type: "string" },
        churn_evidence: { type: "string", description: "Citacao literal do cliente mostrando intencao de cancelar o contrato/servico" },
      },
      required: ["sentiment", "confidence", "summary", "cancel_target", "irritation_target", "needs_cs_ticket"],
    },
  },
};

/**
 * Candidato a churn: a IA diz que o cliente quer cancelar o CONTRATO e cita a
 * frase. É o que decide escalar para o modelo premium e, com confiança, o alerta.
 * Não depende de `sentiment`: "quero cancelar o sistema" dito com educação é
 * churn do mesmo jeito.
 */
export function ehCandidatoChurn(r: any): boolean {
  return r?.cancel_target === "contrato_servico" &&
    r?.needs_cs_ticket === true &&
    typeof r?.churn_evidence === "string" && r.churn_evidence.trim().length > 0;
}

/**
 * Irritacao com a gente (atendimento ou produto), com a frase que comprova.
 * Externo nao conta: cliente bravo com a SEFAZ nao e problema nosso.
 */
export function ehCandidatoIrritacao(r: any): boolean {
  return (r?.irritation_target === "atendimento" || r?.irritation_target === "produto") &&
    r?.sentiment === "negative" &&
    typeof r?.irritation_evidence === "string" && r.irritation_evidence.trim().length > 0;
}

export const CONFIANCA_MINIMA_ALERTA = 0.85;

export function ehAlertaChurn(r: any): boolean {
  return ehCandidatoChurn(r) && Number(r?.confidence) >= CONFIANCA_MINIMA_ALERTA;
}

/**
 * TRANSICAO (01/10/2026): ate existir o aviso por recorrencia (3+ irritacoes em
 * 30 dias), a irritacao continua avisando na hora, como o alerta antigo fazia
 * com reclamacao — senao ela some sem registro. Sai quando a recorrencia entrar.
 */
export function ehAlertaIrritacao(r: any): boolean {
  return !ehCandidatoChurn(r) && ehCandidatoIrritacao(r) && Number(r?.confidence) >= CONFIANCA_MINIMA_ALERTA;
}

export interface Ocorrencia {
  tipo: "churn" | "irritacao";
  alvo: "contrato" | "atendimento" | "produto" | "externo";
  trecho: string;
}

/**
 * O que fica registrado em `atendimento_ocorrencias` (historico da Visao 360 e
 * base da recorrencia). Mesma regua de confianca do alerta. Irritacao externa
 * tambem fica — e historico, so nao conta contra a empresa nem avisa.
 */
export function ocorrenciasDe(r: any): Ocorrencia[] {
  const out: Ocorrencia[] = [];
  if (ehAlertaChurn(r)) out.push({ tipo: "churn", alvo: "contrato", trecho: String(r.churn_evidence).trim() });
  const alvo = r?.irritation_target;
  const evid = typeof r?.irritation_evidence === "string" ? r.irritation_evidence.trim() : "";
  if ((alvo === "atendimento" || alvo === "produto" || alvo === "externo") &&
      r?.sentiment === "negative" && evid.length > 0 && Number(r?.confidence) >= CONFIANCA_MINIMA_ALERTA) {
    out.push({ tipo: "irritacao", alvo, trecho: evid });
  }
  return out;
}
