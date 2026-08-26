// Despedida depois do encerramento não reabre o chat.
//
// O cliente responde "ok, obrigado", "valeu", "tchau", "👍" alguns minutos
// depois do agente encerrar. Dentro da janela de reabertura
// (`support_reopen_window_minutes`, hoje entre 1 e 29 minutos por tenant) isso
// ressuscitava o atendimento: o chat voltava para a fila, o agente reabria e
// fechava de novo, e no caso de URA o cliente ainda recebia o menu de setores
// de brinde. Medido em produção (30 dias, todos os tenants): 61 de 396
// reaberturas por mensagem do cliente foram só despedida — 15%.
//
// O reconhecimento é por TOKEN, não por frase inteira, porque a variação real é
// grande: "obrigada ☺️", "muito obrigado", "a ta ok entao", "beleza 👍".
// A regra: sobrou pelo menos uma palavra de NÚCLEO (despedida/agradecimento/
// aceite) e nenhuma palavra fora de NÚCLEO ∪ ACESSÓRIAS.
//
// Três decisões que valem mais que a lista:
//
// 1. SAUDAÇÃO SOZINHA NÃO ENTRA. "bom dia", "oi", "boa tarde" continuam
//    reabrindo — pode ser cliente começando assunto novo, e deixar alguém
//    esperando custa mais caro que um chat a mais na fila. Isso não depende de
//    disciplina na lista: como é obrigatório ter uma palavra de NÚCLEO, e
//    dia/tarde/noite/oi/olá são só ACESSÓRIAS, saudação pura nunca casa.
//    O efeito colateral desejado é "bom dia, obrigado!" casar.
// 2. NÚMERO NUNCA É DESPEDIDA. "5" é nota de CSAT e "1" é opção de URA.
// 3. INTERROGAÇÃO NUNCA É DESPEDIDA. "beleza?" e "ok?" são pergunta esperando
//    resposta, não fim de papo.
//
// Emoji sozinho ("👍", "🙏🏻", "🤝") conta como despedida; pontuação sozinha
// ("?", "....") não conta — é cliente chamando atenção.

const NUCLEO = new Set([
  // agradecimento
  'obrigado', 'obrigada', 'obrigados', 'obrigadas', 'obrigadao', 'obrigadinho',
  'obrigadinha', 'brigado', 'brigada', 'brigadao', 'obg', 'obgd', 'obgda', 'obrig',
  'grato', 'grata', 'gratos', 'gratas', 'gratidao', 'agradeco', 'agradecemos',
  'agradecido', 'agradecida', 'tks', 'thanks',
  // despedida
  'tchau', 'tchauzinho', 'xau', 'ate', 'abraco', 'abracos', 'abs', 'flw', 'falou',
  'falow', 'vlw', 'valeu', 'valew', 'tmj',
  // aceite / encerramento de assunto
  'ok', 'okay', 'okey', 'oki', 'blz', 'beleza', 'ta', 'tah', 'tabom', 'certo',
  'certinho', 'correto', 'perfeito', 'otimo', 'otima', 'show', 'top', 'joia',
  'legal', 'bacana', 'maravilha', 'combinado', 'fechado', 'entendi', 'entendido',
  'ciente', 'anotado', 'isso', 'disponha', 'imagina',
]);

const ACESSORIAS = new Set([
  // intensificadores e conectivos
  'muito', 'muita', 'muitos', 'muitas', 'mto', 'mt', 'mta', 'demais', 'mesmo',
  'entao', 'ai', 'ja', 'e', 'a', 'o', 'as', 'os', 'de', 'da', 'do', 'por', 'pra',
  'para', 'pela', 'pelo', 'pelas', 'pelos', 'tudo', 'sua', 'seu',
  // objeto do agradecimento
  'ajuda', 'atencao', 'atendimento', 'retorno', 'resposta', 'suporte', 'apoio',
  'informacao', 'informacoes', 'paciencia', 'gentileza', 'colaboracao', 'forca',
  'tempo', 'servico',
  // a quem
  'voce', 'voces', 'vc', 'vcs', 'time', 'equipe', 'gente', 'pessoal',
  // cauda de "até ..."
  'mais', 'logo', 'breve', 'amanha', 'qualquer', 'coisa', 'proxima',
  // saudação: sozinha nunca casa (falta núcleo), mas pode acompanhar
  'bom', 'boa', 'dia', 'tarde', 'noite', 'oi', 'oii', 'ola', 'opa',
]);

const EMOJI = /[\p{Extended_Pictographic}]/u;
const LIXO_VISUAL = /[\p{Extended_Pictographic}\u200d\ufe0f\u{1f3fb}-\u{1f3ff}]/gu;
const MAX_PALAVRAS = 6;

/**
 * `true` quando a mensagem é SÓ despedida/agradecimento/aceite e não carrega
 * pedido nenhum. Conservador de propósito: na dúvida devolve `false` e o chat
 * reabre como antes.
 */
export function isGoodbyeOnlyMessage(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const original = raw.trim();
  if (!original || original.length > 60) return false;
  if (original.includes('?')) return false;

  const temEmoji = EMOJI.test(original);
  const semAcento = original.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const limpo = semAcento.replace(LIXO_VISUAL, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const palavras = limpo.split(/\s+/).filter(Boolean);

  if (palavras.length === 0) return temEmoji;
  if (palavras.length > MAX_PALAVRAS) return false;
  if (palavras.some((p) => /\d/.test(p))) return false;

  let temNucleo = false;
  for (const p of palavras) {
    if (NUCLEO.has(p)) { temNucleo = true; continue; }
    if (!ACESSORIAS.has(p)) return false;
  }
  return temNucleo;
}
