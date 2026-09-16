// Nota de CSAT que vem dentro de uma frase curta, e a palavra-chave de reabertura.
//
// O parser antigo da nota tardia exigia que a mensagem fosse SÓ o número
// (`trimmed.length <= 4 && /^[0-9]+$/`). Quem escrevia "Nota 5, atendimento
// excelente" não era reconhecido: a mensagem seguia o fluxo comum, caía na
// janela de reabertura e ressuscitava o atendimento que estava sendo avaliado —
// e aí a guarda de "já existe atendimento ativo" descartava o "5" que vinha
// logo atrás. O cliente avaliou, a nota se perdeu e o chat voltou para o agente.
//
// Medido em produção (60 dias, todos os tenants): 172 das 903 reaberturas
// aconteceram dentro da janela do CSAT e 59 delas terminaram com a avaliação
// expirada sem nota.
//
// A régua é a mesma do goodbye.ts: sobrou UM token numérico dentro da escala e
// nenhuma palavra fora do vocabulário de cortesia/avaliação. Conservador de
// propósito — nota perdida custa menos que demanda de cliente engolida.
//
// Três decisões que valem mais que a lista:
//
// 1. UM número só. "5/5 não precisamos reabrir" vira dois tokens numéricos e é
//    recusado, mesmo sendo obviamente nota 5. Duas ocorrências abrem espaço
//    para número de nota fiscal, série e telefone entrarem como avaliação.
// 2. NO MÁXIMO 2 DÍGITOS. Escala vai até 10; "3126" e "123456" são outra coisa.
// 3. INTERROGAÇÃO NUNCA É NOTA — mesma razão do goodbye: é pergunta esperando
//    resposta.

import { isFillerWord } from './goodbye.ts';

// Vocabulário específico de avaliação, somado ao de cortesia do goodbye.ts.
// "nota" está aqui e é o token mais arriscado da lista (nota fiscal). Ele só
// passa acompanhado de um número e de mais nada fora do vocabulário: o caso real
// "Fiz uma venda conta assinatura e não saiu a nota" morre em 'venda'/'saiu'.
const PALAVRAS_AVALIACAO = new Set([
  'nota', 'notas', 'avaliacao', 'avaliacoes', 'pontos', 'ponto', 'nivel', 'score',
  'estrela', 'estrelas', 'dou', 'daria', 'dei', 'coloco', 'marco', 'merece',
  'um', 'uma', 'meu', 'minha', 'conceito',
  // elogio que costuma vir colado na nota
  'excelente', 'excelentes', 'maravilhoso', 'maravilhosa', 'nenhuma', 'reclamacao',
]);

const EMOJI_E_MODIFICADORES = /[\p{Extended_Pictographic}‍️\u{1f3fb}-\u{1f3ff}]/gu;
const MAX_PALAVRAS = 8;
const MAX_CARACTERES = 60;

/**
 * A nota quando a mensagem é essencialmente uma avaliação, `null` quando não é.
 *
 * `min`/`max` são a escala do tenant (`support_csat_score_min/max`): número fora
 * dela não é nota e segue o fluxo normal.
 */
export function extractCsatScore(raw: string | null | undefined, min: number, max: number): number | null {
  if (!raw) return null;
  const original = raw.trim();
  if (!original || original.length > MAX_CARACTERES) return null;
  if (original.includes('?')) return null;

  const semAcento = original.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const limpo = semAcento.replace(EMOJI_E_MODIFICADORES, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const palavras = limpo.split(/\s+/).filter(Boolean);

  if (palavras.length === 0 || palavras.length > MAX_PALAVRAS) return null;

  let score: number | null = null;
  for (const p of palavras) {
    if (/^\d+$/.test(p)) {
      if (score !== null) return null;   // dois números: não é nota
      if (p.length > 2) return null;     // 3+ dígitos: não é escala
      score = parseInt(p, 10);
      continue;
    }
    // Palavra com dígito grudado ("r$5", "nf5") não é vocabulário de avaliação.
    if (/\d/.test(p)) return null;
    if (!isFillerWord(p) && !PALAVRAS_AVALIACAO.has(p)) return null;
  }

  if (score === null || score < min || score > max) return null;
  return score;
}

/**
 * O cliente pediu explicitamente para reabrir.
 *
 * É a opção que as próprias mensagens de CSAT oferecem ("digite *Reabrir*") e o
 * maior grupo isolado de reaberturas dentro da janela da pesquisa: 48 em 60
 * dias. Nenhuma guarda de pós-encerramento pode barrar esta palavra.
 */
export function isReopenKeyword(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /\breabrir\b/i.test(raw);
}
