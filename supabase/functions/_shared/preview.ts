/**
 * Corte do `last_message_preview` — o card da barra lateral.
 *
 * `String.prototype.substring` conta unidades UTF-16, e emoji fora do BMP
 * (📅 😉 💻 …) ocupam DUAS. Quando o corte cai exatamente entre elas, sobra um
 * alto substituto órfão: o `JSON.stringify` do supabase-js manda `\ud83d` no
 * corpo, o Postgres recusa a sequência Unicode e o PostgREST devolve **400**.
 *
 * O UPDATE inteiro morre com ele — inclusive `last_message_at` e
 * `is_last_message_from_me`. Nenhum dos chamadores olhava o erro (uns dentro de
 * `Promise.all`, outros com `.catch(() => {})`), então o cartão simplesmente
 * ficava parado na mensagem anterior até a próxima gravação que desse certo.
 * Medido em produção no DEM-0363: a resposta das 09:37 de 04/09/2026 só apareceu
 * na lista às 13:51, quando o encerramento do atendimento regravou a linha. A
 * mensagem estava salva o tempo todo — quem falhava era o resumo.
 *
 * Combinação partida (ZWJ, seletor de variação) continua possível e é inofensiva:
 * gera glifo separado, não byte inválido. O que não pode sobrar é meio par.
 */
export function previewCut(text: string | null | undefined, max = 200): string {
  const s = text ?? '';
  if (s.length <= max) return s;
  const cortado = s.slice(0, max);
  const ultimo = cortado.charCodeAt(cortado.length - 1);
  return ultimo >= 0xd800 && ultimo <= 0xdbff ? cortado.slice(0, -1) : cortado;
}
