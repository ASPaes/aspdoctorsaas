/**
 * Sotaque do e-mail (16/09/2026): reescreve o corpo com o jeito de falar de um
 * estado. Diferencial pedido pelo Alexandre; o mockup aprovado tem Leve e Raiz.
 *
 * As dicas por estado só orientam a IA para expressões conhecidas. Onde a dica
 * é curta, é de propósito: pedir expressão que a gente não tem certeza que
 * existe faz a IA inventar gíria, e gíria inventada é pior que nenhuma.
 */

export type Intensidade = "leve" | "raiz";

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

export const ufValida = (uf: unknown): uf is string => typeof uf === "string" && uf.toUpperCase() in ESTADOS;

export function promptSotaque(uf: string, intensidade: Intensidade): string {
  const estado = ESTADOS[uf.toUpperCase()];
  const dose =
    intensidade === "raiz"
      ? "Intensidade RAIZ: carregue no jeito de falar do estado, com várias expressões típicas ao longo do texto, como uma pessoa de lá escreveria para um cliente conhecido."
      : "Intensidade LEVE: use só duas ou três expressões típicas, bem colocadas. O e-mail continua sério e profissional.";

  return `Você reescreve e-mails de uma empresa de software para clientes, em português do Brasil, com o sotaque e as expressões de ${estado.nome} (${uf.toUpperCase()}).

Expressões típicas para se inspirar: ${estado.dicas}. Use só expressões reais e conhecidas desse estado; se não tiver certeza de uma, não use.

${dose}

Regras:
- Mantenha exatamente os mesmos fatos, pedidos, prazos, números, datas, valores, nomes de pessoas, nomes de sistemas e links. Não acrescente nem remova informação.
- Respeitoso e simpático: nada que soe como deboche, caricatura ou preconceito sobre o estado ou as pessoas de lá. Sem palavrão.
- O texto vem em HTML. Preserve as tags e atributos (parágrafos, negrito, listas, links, cores, alinhamento); reescreva só as palavras entre as tags. O atributo href dos links fica igual.
- Mantenha a despedida e o nome de quem assina, se houver.
- Não use travessão (—).

Responda chamando a função devolver_texto_reescrito. Se não puder usar a função, responda apenas com JSON {"html": "..."}.`;
}
