// As mensagens deste arquivo são reais: saíram das 172 reaberturas que
// aconteceram dentro da janela do CSAT em 60 dias (`support_attendances`
// reopened_at entre `support_csat.asked_at` e asked_at + 60 min, casadas com a
// última mensagem inbound antes do `reopened_at`). Os casos de "não é nota" são
// os que provaram precisar continuar seguindo o fluxo normal.
import { describe, it, expect } from "vitest";
import { extractCsatScore, isReopenKeyword } from "./csat-score.ts";

// Escala padrão do projeto (support_csat_score_min/max).
const nota = (msg: string) => extractCsatScore(msg, 0, 5);

describe("extractCsatScore — a nota dentro da frase", () => {
  const casos: Array<[string, number]> = [
    // o que já funcionava antes
    ["5", 5],
    ["0", 0],
    ["5!", 5],
    [" 4 ", 4],
    // o caso do DEM-0414: a avaliação que reabriu o atendimento avaliado
    ["Nota 5, atendimento excelente", 5],
    // variações de cortesia em volta do número
    ["nota 5", 5],
    ["Nota 5", 5],
    ["muito obrigado, nota 5", 5],
    ["5, obrigado", 5],
    ["obrigada, nota 5 😊", 5],
    ["dou 5", 5],
    ["dou nota 5", 5],
    ["minha nota e 5", 5],
    ["nota 5 pelo atendimento", 5],
    ["5 excelente atendimento", 5],
    ["ok, nota 5", 5],
    ["nota 3", 3],
  ];
  for (const [msg, esperado] of casos) {
    it(`"${msg}" -> ${esperado}`, () => expect(nota(msg)).toBe(esperado));
  }

  it("respeita a escala do tenant", () => {
    expect(extractCsatScore("nota 10", 0, 10)).toBe(10);
    expect(extractCsatScore("nota 10", 0, 5)).toBeNull();
    expect(extractCsatScore("7", 0, 5)).toBeNull();
  });
});

describe("extractCsatScore — o que NÃO pode virar nota", () => {
  const naoEhNota = [
    // dois números: pode ser qualquer coisa
    "5/5 não precisamos reabrir",
    // número longo não é escala
    "3126", "123456", "31 99999-8888",
    // pedido real com número no meio
    "preciso de 5 licenças",
    "tem 2 notas fiscais em aberto",
    "nota 5, mas ainda está dando erro",
    "me manda a nota 5 vezes",
    // "nota" sem número é nota fiscal
    "Fiz uma venda conta assinatura e não saiu a nota",
    "não saiu a nota",
    // demanda nova
    "Desbroqueia o sistema",
    "o computador não deixa eu executar arquivos na pasta c",
    "Ao finalizar uma comanda",
    "Amanhã vou chamar para a impressora tá",
    // pergunta nunca é nota
    "5?", "nota 5?",
    // palavra-chave de reabertura
    "Reabrir", "reabrir",
    // cortesia sem número: é despedida, quem trata é o goodbye.ts
    "Muito obrigado", "Obrigada, igualmente", "Maravilhoso", "Ok obg",
    // saudação
    "Oi", "Bom dia", "Olá",
    // placeholder de mídia
    "🎵 Áudio", "📷 Imagem", "🎨 Sticker",
    // emoji sozinho
    "🙏", "🤝",
    // vazio
    "", "   ",
  ];
  for (const msg of naoEhNota) {
    it(`ignora "${msg}"`, () => expect(nota(msg)).toBeNull());
  }

  it("ignora null e undefined", () => {
    expect(nota(null as unknown as string)).toBeNull();
    expect(nota(undefined as unknown as string)).toBeNull();
  });

  it("não engole texto longo com número", () => {
    expect(nota("obrigado pela ajuda de ontem, o erro 5 voltou hoje na emissão")).toBeNull();
  });
});

describe("isReopenKeyword — o cliente pediu para reabrir", () => {
  for (const msg of ["Reabrir", "reabrir", "REABRIR", "quero reabrir", "*Sue Ellen:*\nreabrir", "reabrir por favor"]) {
    it(`reconhece "${msg}"`, () => expect(isReopenKeyword(msg)).toBe(true));
  }
  for (const msg of ["5", "Nota 5, atendimento excelente", "obrigado", "", "reabertura do caixa"]) {
    it(`não confunde "${msg}"`, () => expect(isReopenKeyword(msg)).toBe(false));
  }
});
