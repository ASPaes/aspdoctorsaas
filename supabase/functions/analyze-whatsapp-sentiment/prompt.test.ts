import { describe, expect, it } from "vitest";
import {
  ehAlertaChurn, ehAlertaCancelamentoIndefinido, ehCandidatoChurn, ehCandidatoIrritacao, ehRecorrente, ocorrenciasDe, formatarMensagens, montarPrompt, selecionarMensagens,
  MAX_MENSAGENS, MENSAGENS_DO_INICIO, type MensagemAnalise,
} from "./prompt";

const msg = (content: string, extra: Partial<MensagemAnalise> = {}): MensagemAnalise => ({
  content, timestamp: "2026-09-30T19:18:56Z", audio_transcription: null, message_type: "text", is_from_me: false, ...extra,
});

describe("seleção das mensagens", () => {
  it("tira sistema, reação e mensagem apagada", () => {
    const r = selecionarMensagens([
      msg("✅ Atendimento 09603/26 aberto com sucesso.", { message_type: "system" }),
      msg("👍", { message_type: "reaction" }),
      msg("", { message_type: "revoked" }),
      msg("Pode me ajudar"),
    ]);
    expect(r.map((m) => m.content)).toEqual(["Pode me ajudar"]);
  });

  it("atendimento longo mantém o começo e o fim", () => {
    const todas = Array.from({ length: 100 }, (_, i) => msg(`m${i}`));
    const r = selecionarMensagens(todas);
    expect(r).toHaveLength(MAX_MENSAGENS);
    expect(r[0].content).toBe("m0");
    expect(r[MENSAGENS_DO_INICIO - 1].content).toBe(`m${MENSAGENS_DO_INICIO - 1}`);
    expect(r[r.length - 1].content).toBe("m99");
  });
});

describe("formatação", () => {
  it("mídia sem legenda vira rótulo, com legenda mantém o texto", () => {
    const t = formatarMensagens([
      msg("📷 Imagem", { message_type: "image" }),
      msg("Sent image", { message_type: "image", is_from_me: true }),
      msg("Sem boleto pfv", { message_type: "image" }),
      msg("🎵 Áudio", { message_type: "audio", audio_transcription: "quero cancelar a nota" }),
    ]);
    expect(t).toContain('[Cliente] [30/09/2026, 16:18:56]: [imagem]');
    expect(t).toContain("[Atendente]");
    expect(t).toContain('[imagem] "Sem boleto pfv"');
    expect(t).toContain('[áudio transcrito] "quero cancelar a nota"');
    expect(t).not.toContain("📷");
  });

  it("avisa quando o meio foi cortado", () => {
    const t = formatarMensagens(Array.from({ length: 12 }, (_, i) => msg(`m${i}`)), 40);
    expect(t.split("\n")[MENSAGENS_DO_INICIO]).toBe("(... 40 mensagens do meio do atendimento omitidas ...)");
  });

  it("o prompt separa cancelar documento de cancelar contrato", () => {
    const p = montarPrompt("x");
    expect(p).toContain("documento_operacao");
    expect(p).toContain("contrato_servico");
    expect(p).toContain("nunca churn");
  });
});

describe("regra do alerta", () => {
  const base = { sentiment: "neutral", confidence: 0.9, needs_cs_ticket: true, churn_evidence: "Então preciso cancelar" };

  it("caso de 30/09: cancelar a venda no PDV não alerta, mesmo com needs_cs_ticket", () => {
    expect(ehAlertaChurn({ ...base, cancel_target: "documento_operacao" })).toBe(false);
    expect(ehCandidatoChurn({ ...base, cancel_target: "documento_operacao" })).toBe(false);
  });

  it("indefinido não alerta", () => {
    expect(ehAlertaChurn({ ...base, cancel_target: "indefinido" })).toBe(false);
  });

  it("cancelar o contrato alerta, mesmo dito com educação", () => {
    expect(ehAlertaChurn({ ...base, cancel_target: "contrato_servico", churn_evidence: "quero cancelar o sistema" })).toBe(true);
  });

  it("sem frase literal ou com confiança baixa não alerta", () => {
    expect(ehAlertaChurn({ ...base, cancel_target: "contrato_servico", churn_evidence: " " })).toBe(false);
    expect(ehAlertaChurn({ ...base, cancel_target: "contrato_servico", confidence: 0.7 })).toBe(false);
    expect(ehCandidatoChurn({ ...base, cancel_target: "contrato_servico", confidence: 0.7 })).toBe(true);
  });

  it("reclamação sem cancelamento não alerta mais por aqui", () => {
    expect(ehAlertaChurn({ sentiment: "negative", confidence: 0.95, needs_cs_ticket: true, cancel_target: "nenhum", churn_evidence: "sempre a mesma coisa" })).toBe(false);
  });
});

describe("irritação: candidata a ocorrência", () => {
  const irr = { sentiment: "negative", confidence: 0.9, cancel_target: "nenhum", needs_cs_ticket: false };

  it("contra o atendimento ou o produto é candidata", () => {
    expect(ehCandidatoIrritacao({ ...irr, irritation_target: "atendimento", irritation_evidence: "já deu mais de um mês e ninguém me retornou" })).toBe(true);
    expect(ehCandidatoIrritacao({ ...irr, irritation_target: "produto", irritation_evidence: "todo dia aparece algo novo" })).toBe(true);
  });

  it("externo, sem frase ou sem tom negativo não é", () => {
    expect(ehCandidatoIrritacao({ ...irr, irritation_target: "externo", irritation_evidence: "a SEFAZ caiu de novo" })).toBe(false);
    expect(ehCandidatoIrritacao({ ...irr, irritation_target: "atendimento", irritation_evidence: "" })).toBe(false);
    expect(ehCandidatoIrritacao({ ...irr, sentiment: "neutral", irritation_target: "atendimento", irritation_evidence: "x" })).toBe(false);
  });
});

describe("pedido de cancelamento sem objeto", () => {
  const ind = { sentiment: "neutral", confidence: 0.92, cancel_target: "indefinido", needs_cs_ticket: false, churn_evidence: "gostaria de solicitar o cancelamento" };

  it("avisa como possível cancelamento e não como churn", () => {
    expect(ehAlertaCancelamentoIndefinido(ind)).toBe(true);
    expect(ehAlertaChurn(ind)).toBe(false);
  });

  it("sem frase ou com confiança baixa não avisa", () => {
    expect(ehAlertaCancelamentoIndefinido({ ...ind, churn_evidence: "" })).toBe(false);
    expect(ehAlertaCancelamentoIndefinido({ ...ind, confidence: 0.7 })).toBe(false);
  });

  it("vira ocorrência de churn com alvo indefinido", () => {
    expect(ocorrenciasDe(ind)).toEqual([{ tipo: "churn", alvo: "indefinido", trecho: "gostaria de solicitar o cancelamento" }]);
  });
});

describe("recorrência", () => {
  it("avisa a partir de 3 atendimentos", () => {
    expect(ehRecorrente(2)).toBe(false);
    expect(ehRecorrente(3)).toBe(true);
    expect(ehRecorrente(5)).toBe(true);
  });
});

describe("ocorrências registradas", () => {
  it("churn e irritação no mesmo resultado viram duas", () => {
    expect(ocorrenciasDe({ sentiment: "negative", confidence: 0.9, cancel_target: "contrato_servico", needs_cs_ticket: true, churn_evidence: " vou cancelar ", irritation_target: "atendimento", irritation_evidence: "vocês demoram" }))
      .toEqual([{ tipo: "churn", alvo: "contrato", trecho: "vou cancelar" }, { tipo: "irritacao", alvo: "atendimento", trecho: "vocês demoram" }]);
  });

  it("irritação externa fica no histórico", () => {
    expect(ocorrenciasDe({ sentiment: "negative", confidence: 0.9, cancel_target: "nenhum", irritation_target: "externo", irritation_evidence: "a SEFAZ caiu" }))
      .toEqual([{ tipo: "irritacao", alvo: "externo", trecho: "a SEFAZ caiu" }]);
  });

  it("sem frase, sem tom negativo ou abaixo da confiança, nada", () => {
    const base = { sentiment: "negative", confidence: 0.9, cancel_target: "nenhum", irritation_target: "atendimento", irritation_evidence: "x" };
    expect(ocorrenciasDe({ ...base, irritation_evidence: "" })).toEqual([]);
    expect(ocorrenciasDe({ ...base, sentiment: "neutral" })).toEqual([]);
    expect(ocorrenciasDe({ ...base, confidence: 0.8 })).toEqual([]);
    expect(ocorrenciasDe({ ...base, irritation_target: "nenhum" })).toEqual([]);
  });
});
