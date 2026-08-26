// As mensagens deste arquivo são reais: saíram das 396 reaberturas por mensagem
// do cliente registradas em produção em 60 dias (`support_attendances`
// reopened_from='customer', casadas com a última mensagem inbound antes do
// `reopened_at`). Os casos de "reabre" são os que provaram valer a pena manter
// reabrindo — número de CSAT, saudação sozinha, pergunta e mídia.
import { describe, it, expect } from "vitest";
import { isGoodbyeOnlyMessage } from "./goodbye.ts";

describe("isGoodbyeOnlyMessage — despedida não reabre", () => {
  const despedidas = [
    "ok", "OK", "Ok!", "blz", "beleza", "certo", "show", "valeu", "vlw", "flw",
    "obrigado", "obrigada", "Obrigado!", "obg", "muito obrigada", "muito obrigado",
    "ok obrigado", "ok, obrigado!", "obrigada ☺️", "okey obrigada", "a ta ok entao",
    "beleza 👍", "tchau", "até mais", "até logo", "abraço", "abraços",
    "obrigado pela ajuda", "obrigado pela atenção", "grato pela atenção",
    "agradeço o retorno", "disponha", "tmj", "perfeito", "entendi", "combinado",
    "bom dia, obrigado 🙂", "boa tarde, obrigado!",
  ];
  for (const msg of despedidas) {
    it(`ignora "${msg}"`, () => expect(isGoodbyeOnlyMessage(msg)).toBe(true));
  }

  it("ignora emoji sozinho", () => {
    for (const msg of ["👍", "🙏", "👍🏻", "🤝", "👍🏻🙏🏻", "🥰", "🫡", "👍👏🏻👏🏻"]) {
      expect(isGoodbyeOnlyMessage(msg), msg).toBe(true);
    }
  });
});

describe("isGoodbyeOnlyMessage — o que TEM que continuar reabrindo", () => {
  const reabre = [
    // saudação sozinha: pode ser assunto novo
    "bom dia", "Boa tarde", "boa noite", "oi", "oii", "olá", "opa", "bom dia Luiz",
    // número: nota de CSAT e opção de URA
    "5", "1", "0", "3126", "123456",
    // pergunta é pergunta, mesmo curta
    "?", "?????", "ok?", "beleza?", "tudo bem?", "algum retorno kadu ?",
    // pontuação sozinha é cliente chamando atenção
    ".", "...",
    // palavra de núcleo dentro de frase com pedido
    "obrigado, mas ainda está dando erro",
    "ok vou testar aqui e te falo",
    "beleza, me manda o boleto",
    "até agora não resolveu",
    // resposta objetiva
    "sim", "não", "ainda não", "agora consigo falar",
    // placeholder de mídia
    "🎵 Áudio", "📷 Imagem", "📄 Documento", "🎨 Sticker",
    // palavra-chave explícita de reabertura
    "reabrir", "Reabrir",
    // vazio
    "", "   ",
  ];
  for (const msg of reabre) {
    it(`reabre com "${msg}"`, () => expect(isGoodbyeOnlyMessage(msg)).toBe(false));
  }

  it("não engole texto longo que começa com agradecimento", () => {
    expect(isGoodbyeOnlyMessage("obrigado pela ajuda de ontem, hoje voltou o mesmo erro na emissão")).toBe(false);
  });

  it("tolera nulo", () => {
    expect(isGoodbyeOnlyMessage(null)).toBe(false);
    expect(isGoodbyeOnlyMessage(undefined)).toBe(false);
  });
});
