/**
 * Reescrita do corpo do e-mail: Sotaque (etapa 1) e Ajustar, com Idioma e
 * Tamanho (etapa 2), mockups aprovados pelo Alexandre em 16/09/2026.
 *
 * Tudo sai numa chamada só e sempre a partir do texto original, para as
 * combinações não se acumularem (espanhol + mais curto, sotaque + mais curto).
 * Idioma e sotaque não se misturam: sotaque é jeito de falar do português.
 *
 * As dicas por estado só orientam a IA para expressões conhecidas. Onde a dica
 * é curta, é de propósito: pedir expressão que a gente não tem certeza que
 * existe faz a IA inventar gíria, e gíria inventada é pior que nenhuma.
 */

export type Intensidade = "leve" | "raiz";
export type Idioma = "en" | "es";
export type Tamanho = "curto" | "detalhado";

export interface Reescrita {
  sotaque: { uf: string; intensidade: Intensidade } | null;
  idioma: Idioma | null;
  tamanho: Tamanho | null;
}

export const ESTADOS: Record<string, { nome: string; dicas: string }> = {
  AC: { nome: "Acre", dicas: "jeito nortista de falar, acolhedor" },
  AL: { nome: "Alagoas", dicas: "oxe, vixe, arretado" },
  AM: { nome: "Amazonas", dicas: "mano, maninho, égua, pai d'égua" },
  AP: { nome: "Amapá", dicas: "égua, maninho" },
  BA: { nome: "Bahia", dicas: "oxe, massa, barril, véi, meu rei" },
  CE: { nome: "Ceará", dicas: "macho, arretado, pai d'égua, mah" },
  DF: { nome: "Distrito Federal", dicas: "véi, top, massa" },
  ES: { nome: "Espírito Santo", dicas: "jeito capixaba, próximo do mineiro: uai com moderação" },
  GO: { nome: "Goiás", dicas: "uai, trem, cê, sô" },
  MA: { nome: "Maranhão", dicas: "égua, rapaz, é massa" },
  MG: { nome: "Minas Gerais", dicas: "uai, trem, sô, bão, cê" },
  MS: { nome: "Mato Grosso do Sul", dicas: "jeito sul-mato-grossense, com tchê usado com moderação" },
  MT: { nome: "Mato Grosso", dicas: "pau rodado, tchá por Deus, xô" },
  PA: { nome: "Pará", dicas: "égua, pai d'égua, maninho, de rocha" },
  PB: { nome: "Paraíba", dicas: "oxe, arretado, visse" },
  PE: { nome: "Pernambuco", dicas: "oxente, massa, arretado, visse, painho" },
  PI: { nome: "Piauí", dicas: "oxe, rapaz, massa" },
  PR: { nome: "Paraná", dicas: "piá, daí, capaz" },
  RJ: { nome: "Rio de Janeiro", dicas: "mermão, caraca, maneiro, sinistro" },
  RN: { nome: "Rio Grande do Norte", dicas: "oxe, massa, arretado" },
  RO: { nome: "Rondônia", dicas: "jeito nortista, acolhedor" },
  RR: { nome: "Roraima", dicas: "jeito nortista, égua com moderação" },
  RS: { nome: "Rio Grande do Sul", dicas: "bah, tchê, tri, capaz, guri" },
  SC: { nome: "Santa Catarina", dicas: "bah, ó, tás tolo" },
  SE: { nome: "Sergipe", dicas: "oxe, vixe, massa" },
  SP: { nome: "São Paulo", dicas: "meu, mano, da hora, suave" },
  TO: { nome: "Tocantins", dicas: "uai, trem, égua" },
};

const IDIOMAS: Record<Idioma, string> = { en: "inglês", es: "espanhol" };

export const ufValida = (uf: unknown): uf is string =>
  typeof uf === "string" && Object.prototype.hasOwnProperty.call(ESTADOS, uf.toUpperCase());

/** lê o pedido da tela; devolve null quando não há nada para reescrever ou é inválido */
export function lerReescrita(body: Record<string, unknown>): Reescrita | null {
  const s = body.sotaque as { uf?: unknown; intensidade?: unknown } | null | undefined;
  const sotaque = s && ufValida(s.uf)
    ? { uf: String(s.uf).toUpperCase(), intensidade: (s.intensidade === "raiz" ? "raiz" : "leve") as Intensidade }
    : null;
  const idioma = body.idioma === "en" || body.idioma === "es" ? body.idioma : null;
  const tamanho = body.tamanho === "curto" || body.tamanho === "detalhado" ? body.tamanho : null;
  if (s && !sotaque) return null;
  if (sotaque && idioma) return null;
  if (!sotaque && !idioma && !tamanho) return null;
  return { sotaque, idioma, tamanho };
}

export function promptReescrita(r: Reescrita): string {
  const pedidos: string[] = [];

  if (r.sotaque) {
    const estado = ESTADOS[r.sotaque.uf];
    pedidos.push(
      `SOTAQUE: escreva com o sotaque e as expressões de ${estado.nome} (${r.sotaque.uf}). Expressões típicas para se inspirar: ${estado.dicas}. Use só expressões reais e conhecidas desse estado; se não tiver certeza de uma, não use.`,
      r.sotaque.intensidade === "raiz"
        ? "Intensidade RAIZ: carregue no jeito de falar do estado, com várias expressões típicas ao longo do texto, como uma pessoa de lá escreveria para um cliente conhecido."
        : "Intensidade LEVE: use só duas ou três expressões típicas, bem colocadas. O e-mail continua sério e profissional.",
      "Respeitoso e simpático: nada que soe como deboche, caricatura ou preconceito sobre o estado ou as pessoas de lá. Sem palavrão.",
    );
  }
  if (r.idioma) {
    pedidos.push(
      `IDIOMA: traduza o e-mail inteiro para ${IDIOMAS[r.idioma]}, natural e profissional, como escreveria um nativo. Nomes de pessoas, empresas e sistemas não se traduzem.`,
    );
  }
  if (r.tamanho === "curto") {
    pedidos.push("TAMANHO: deixe o e-mail mais curto e direto, cortando repetição e rodeio. Mantenha todas as informações importantes, pedidos e próximos passos.");
  } else if (r.tamanho === "detalhado") {
    pedidos.push("TAMANHO: deixe o e-mail mais detalhado e explicativo, desenvolvendo melhor o que já está escrito. Não invente fatos, passos ou promessas que não estejam no texto.");
  }

  const lingua = r.idioma ? IDIOMAS[r.idioma] : "português do Brasil";

  return `Você reescreve e-mails de uma empresa de software para clientes. O texto final deve estar em ${lingua}.

${pedidos.join("\n\n")}

Regras:
- Mantenha exatamente os mesmos fatos, pedidos, prazos, números, datas, valores, nomes de pessoas, nomes de sistemas e links. Não acrescente informação nova.
- O texto vem em HTML. Preserve as tags e atributos (parágrafos, negrito, listas, links, cores, alinhamento); reescreva só as palavras entre as tags. O atributo href dos links fica igual.
- Mantenha a despedida e o nome de quem assina, se houver.
- Se vier um assunto, devolva o assunto reescrito com as mesmas regras (sem código de atendimento, até 90 caracteres).
- Não use travessão (—).

Responda chamando a função devolver_texto_reescrito. Se não puder usar a função, responda apenas com JSON {"html": "...", "assunto": "..."}.`;
}
