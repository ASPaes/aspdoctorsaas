// Formatos de mensagem do Baileys que a Evolution entrega no `messages.upsert`.
//
// O parser antigo conhecia um punhado de formatos (texto, mídia, contato, enquete,
// localização) e mandava TODO o resto para o rótulo "📎 Mensagem não suportada",
// que era gravado no banco como se fosse o conteúdo da mensagem. Medido em prod
// em 10/08/2026: 388 mensagens em 19 dias, 100% na Evolution.
//
//   buttonsMessage             184 msgs / 7 contatos    tem texto, não aparecia
//   albumMessage                75 msgs / 55 contatos   ruído: as fotos vêm depois
//   templateMessage             46 msgs / 25 contatos   tem texto, não aparecia
//   listMessage                 32 msgs / 9 contatos    tem texto, não aparecia
//   associatedChildMessage      20 msgs / 6 contatos    embrulho de filho de álbum
//   messageHistoryNotice          9 msgs                ruído de sincronização
//   interactiveMessage            8 msgs                tem texto
//   ptvMessage                    4 msgs                vídeo redondo
//   call                          3 msgs                ruído
//   lottieStickerMessage          2 msgs                figurinha animada
//   interactiveResponseMessage    1 msg                 RESPOSTA do cliente à URA
//   groupInviteMessage / pinInChatMessage  1 cada
import { describe, it, expect } from "vitest";
import {
  unwrapMessage,
  getMessageType,
  getMessageContent,
  isIgnorableMessage,
  resolveMediaNode,
} from "./message-shape.ts";

/** Atalho: tipo + conteúdo, do jeito que o index.ts encadeia. */
function parse(message: any) {
  const type = getMessageType(message);
  return { type, content: getMessageContent(message, type) };
}

const UNSUPPORTED = "📎 Mensagem não suportada";

describe("regressão — o que já funcionava continua funcionando", () => {
  it("texto simples", () => {
    expect(parse({ conversation: "oi" })).toEqual({ type: "text", content: "oi" });
  });

  it("texto estendido", () => {
    expect(parse({ extendedTextMessage: { text: "oi" } }))
      .toEqual({ type: "text", content: "oi" });
  });

  it("imagem com legenda", () => {
    expect(parse({ imageMessage: { mimetype: "image/jpeg", caption: "olha isso" } }))
      .toEqual({ type: "image", content: "olha isso" });
  });

  it("imagem sem legenda cai no rótulo de mídia", () => {
    expect(parse({ imageMessage: { mimetype: "image/jpeg" } }))
      .toEqual({ type: "image", content: "📷 Imagem" });
  });

  it("resposta de botão (escolha do cliente na URA)", () => {
    expect(parse({ buttonsResponseMessage: { selectedDisplayText: "1" } }))
      .toEqual({ type: "text", content: "1" });
  });

  it("enquete e localização", () => {
    expect(getMessageContent({ pollCreationMessage: { name: "Qual?" } }, "text"))
      .toBe("📊 Enquete: Qual?");
    expect(getMessageContent({ locationMessage: {} }, "text")).toBe("📍 Localização");
  });

  it("contato", () => {
    expect(parse({ contactMessage: { displayName: "João" } }))
      .toEqual({ type: "contact", content: "João" });
  });

  it("reação", () => {
    expect(parse({ reactionMessage: { text: "👍" } }))
      .toEqual({ type: "reaction", content: "👍" });
  });

  it("formato genuinamente desconhecido continua rotulado", () => {
    expect(getMessageContent({ algumaCoisaQueNinguemViu: {} }, "text")).toBe(UNSUPPORTED);
  });
});

describe("mensagens de robô — o texto tem que aparecer", () => {
  // O caso do print: cliente-robô mandou templateMessage e o chat mostrou
  // "📎 Mensagem não suportada" três vezes seguidas.
  it("templateMessage / hydratedTemplate", () => {
    const msg = {
      templateMessage: {
        hydratedTemplate: {
          hydratedTitleText: "Cobrança",
          hydratedContentText: "Sua fatura vence hoje.",
          hydratedFooterText: "Equipe Financeiro",
        },
      },
      messageContextInfo: {},
    };
    expect(parse(msg)).toEqual({ type: "text", content: "Sua fatura vence hoje." });
  });

  it("templateMessage / hydratedFourRowTemplate", () => {
    const msg = {
      templateMessage: {
        hydratedFourRowTemplate: { hydratedContentText: "Escolha uma opção" },
      },
    };
    expect(parse(msg).content).toBe("Escolha uma opção");
  });

  it("templateMessage / fourRowTemplate (formato antigo, texto aninhado)", () => {
    const msg = {
      templateMessage: { fourRowTemplate: { content: { text: "Confirma?" }, title: { text: "Pedido" } } },
    };
    expect(parse(msg).content).toBe("Confirma?");
  });

  it("templateMessage só com título usa o título", () => {
    expect(getMessageContent({ templateMessage: { hydratedTemplate: { hydratedTitleText: "Aviso" } } }, "text"))
      .toBe("Aviso");
  });

  it("buttonsMessage usa contentText", () => {
    const msg = {
      buttonsMessage: {
        contentText: "Deseja continuar?",
        footerText: "Responda abaixo",
        buttons: [{ buttonId: "sim", buttonText: { displayText: "Sim" } }],
      },
    };
    expect(parse(msg)).toEqual({ type: "text", content: "Deseja continuar?" });
  });

  it("buttonsMessage sem contentText cai no header text", () => {
    expect(getMessageContent({ buttonsMessage: { text: "Menu principal" } }, "text"))
      .toBe("Menu principal");
  });

  it("listMessage usa description e cai para title", () => {
    expect(getMessageContent({ listMessage: { title: "Menu", description: "Escolha um setor" } }, "text"))
      .toBe("Escolha um setor");
    expect(getMessageContent({ listMessage: { title: "Menu" } }, "text")).toBe("Menu");
  });

  it("interactiveMessage usa body.text", () => {
    const msg = {
      interactiveMessage: {
        header: { title: "Atendimento" },
        body: { text: "Como podemos ajudar?" },
        footer: { text: "rodapé" },
      },
    };
    expect(parse(msg)).toEqual({ type: "text", content: "Como podemos ajudar?" });
  });

  it("groupInviteMessage vira convite legível", () => {
    expect(getMessageContent({ groupInviteMessage: { groupName: "Suporte ACME" } }, "text"))
      .toBe('👥 Convite para o grupo "Suporte ACME"');
  });
});

describe("resposta do cliente a menu interativo — a URA precisa do texto", () => {
  it("interactiveResponseMessage com body.text", () => {
    const msg = { interactiveResponseMessage: { body: { text: "1" } } };
    expect(parse(msg)).toEqual({ type: "text", content: "1" });
  });

  it("interactiveResponseMessage sem body usa o paramsJson do nativeFlow", () => {
    const msg = {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          name: "quick_reply",
          paramsJson: JSON.stringify({ id: "opt_suporte", description: "Suporte" }),
        },
      },
    };
    expect(getMessageContent(msg, "text")).toBe("Suporte");
  });

  it("paramsJson quebrado não derruba o parser", () => {
    const msg = {
      interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: "{{{" } },
    };
    expect(() => getMessageContent(msg, "text")).not.toThrow();
  });
});

describe("mídia que não era reconhecida", () => {
  it("ptvMessage (vídeo redondo) é vídeo", () => {
    const msg = { ptvMessage: { mimetype: "video/mp4", fileLength: 1234 } };
    expect(getMessageType(msg)).toBe("video");
    expect(getMessageContent(msg, "video")).toBe("🎥 Vídeo");
    expect(resolveMediaNode(msg, "video")).toEqual(msg.ptvMessage);
  });

  it("ptvMessage com legenda mostra a legenda", () => {
    expect(getMessageContent({ ptvMessage: { mimetype: "video/mp4", caption: "ó" } }, "video")).toBe("ó");
  });

  it("lottieStickerMessage é sticker", () => {
    const msg = { lottieStickerMessage: { message: { stickerMessage: { mimetype: "application/was" } } } };
    expect(getMessageType(msg)).toBe("sticker");
    expect(resolveMediaNode(msg, "sticker")).toEqual({ mimetype: "application/was" });
  });

  it("resolveMediaNode mantém o caminho normal de imagem/áudio/documento", () => {
    expect(resolveMediaNode({ imageMessage: { mimetype: "image/png" } }, "image"))
      .toEqual({ mimetype: "image/png" });
    expect(resolveMediaNode({ audioMessage: { mimetype: "audio/ogg" } }, "audio"))
      .toEqual({ mimetype: "audio/ogg" });
    expect(resolveMediaNode({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf" } } } }, "document"))
      .toEqual({ mimetype: "application/pdf" });
  });

  it("associatedChildMessage é embrulho: desembrulha para a mídia de dentro", () => {
    const msg = { associatedChildMessage: { message: { imageMessage: { mimetype: "image/jpeg", caption: "foto" } } } };
    expect(unwrapMessage(msg)).toEqual({ imageMessage: { mimetype: "image/jpeg", caption: "foto" } });
    expect(parse(msg)).toEqual({ type: "image", content: "foto" });
  });

  it("os embrulhos que já existiam continuam desembrulhando", () => {
    expect(unwrapMessage({ ephemeralMessage: { message: { conversation: "oi" } } }))
      .toEqual({ conversation: "oi" });
    expect(unwrapMessage({ viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } }))
      .toEqual({ imageMessage: { mimetype: "image/jpeg" } });
  });
});

describe("ruído — não pode virar mensagem no chat", () => {
  it("albumMessage é só o cabeçalho do álbum; as fotos chegam separadas", () => {
    expect(isIgnorableMessage({ messageContextInfo: {}, albumMessage: { expectedImageCount: 3 } }))
      .toBe("albumMessage");
  });

  it("messageHistoryNotice, com ou sem senderKey junto", () => {
    expect(isIgnorableMessage({ messageContextInfo: {}, messageHistoryNotice: {} })).toBe("messageHistoryNotice");
    expect(isIgnorableMessage({
      senderKeyDistributionMessage: {}, messageContextInfo: {}, messageHistoryNotice: {},
    })).toBe("messageHistoryNotice");
  });

  it("chamada e fixar-mensagem", () => {
    expect(isIgnorableMessage({ call: { callKey: "x" } })).toBe("call");
    expect(isIgnorableMessage({ pinInChatMessage: {} })).toBe("pinInChatMessage");
  });

  it("envelope sem nenhum conteúdo dentro", () => {
    expect(isIgnorableMessage({ messageContextInfo: {} })).toBe("vazio");
    expect(isIgnorableMessage({ senderKeyDistributionMessage: {} })).toBe("vazio");
    expect(isIgnorableMessage({})).toBe("vazio");
    expect(isIgnorableMessage(null)).toBe("vazio");
  });

  it("mensagem de verdade NUNCA é descartada", () => {
    expect(isIgnorableMessage({ messageContextInfo: {}, conversation: "oi" })).toBe(false);
    expect(isIgnorableMessage({ senderKeyDistributionMessage: {}, imageMessage: { mimetype: "image/jpeg" } })).toBe(false);
    expect(isIgnorableMessage({ templateMessage: {}, messageContextInfo: {} })).toBe(false);
    // texto vazio ainda é uma mensagem: quem decide é o processor, não o descarte
    expect(isIgnorableMessage({ conversation: "" })).toBe(false);
  });

  it("álbum embrulhado em ephemeral também é ruído", () => {
    expect(isIgnorableMessage({ ephemeralMessage: { message: { albumMessage: {} } } })).toBe("albumMessage");
  });
});

// Card de produto do catálogo do WhatsApp Business. Chegou depois do fix de
// 10/08 e continuava virando rótulo: 3 msgs desde 12/08 (unsupportedKeys
// ["productMessage","messageContextInfo"]). As chaves de fora vieram do banco;
// os campos de dentro (title, priceAmount1000, currencyCode) vieram do proto.
describe("card de produto do catálogo", () => {
  it("mostra título e preço", () => {
    expect(parse({
      productMessage: {
        businessOwnerJid: "555597209965@s.whatsapp.net",
        product: {
          productId: "123",
          title: "Tele entrega Centro",
          description: "Bairro Centro",
          currencyCode: "BRL",
          priceAmount1000: "5000",
          productImage: { mimetype: "image/jpeg" },
        },
      },
      messageContextInfo: {},
    })).toEqual({ type: "text", content: "🛍️ Tele entrega Centro — R$ 5,00" });
  });

  it("preço vem como número também", () => {
    expect(parse({ productMessage: { product: { title: "X", priceAmount1000: 1500, currencyCode: "BRL" } } }))
      .toEqual({ type: "text", content: "🛍️ X — R$ 1,50" });
  });

  it("sem preço mostra só o título", () => {
    expect(parse({ productMessage: { product: { title: "Combo 1" } } }))
      .toEqual({ type: "text", content: "🛍️ Combo 1" });
  });

  it("sem título cai na descrição", () => {
    expect(parse({ productMessage: { product: { description: "Entrega Bairro Alto" } } }))
      .toEqual({ type: "text", content: "🛍️ Entrega Bairro Alto" });
  });

  it("produto vazio nunca volta para o rótulo de não suportada", () => {
    expect(parse({ productMessage: {} }))
      .toEqual({ type: "text", content: "🛍️ Produto do catálogo" });
    expect(parse({ productMessage: { product: { priceAmount1000: "0", currencyCode: "ZZZ" } } }))
      .toEqual({ type: "text", content: "🛍️ Produto do catálogo" });
  });

  it("card de produto não é ruído: tem que virar mensagem no chat", () => {
    expect(isIgnorableMessage({ productMessage: { product: { title: "X" } }, messageContextInfo: {} }))
      .toBe(false);
  });
});
