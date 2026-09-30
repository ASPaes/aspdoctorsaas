// Nome que entra no lugar de {nome_cliente} no envio em lote (DEM-0492).
//
// Grupo de WhatsApp costuma se chamar "Conta Hábil x Padaria Bom Pão". Colado
// direto, a mensagem sairia "Olá, Conta Hábil x Padaria Bom Pão". A sugestão
// tira o nome da própria empresa (o tenant) e os separadores que sobram. A
// pessoa ainda edita linha a linha, e o que ela escolher fica guardado em
// `whatsapp_contacts.nome_na_mensagem`, que vence esta sugestão da próxima vez.

// O "x" só conta como separador quando está sozinho ("Conta Hábil x Padaria");
// "Xavier" não perde a letra.
const SEPARADORES = /^(?:[\s|·•:\-–—/]|[xX](?=\s))+|(?:[\s|·•:\-–—/]|(?<=\s)[xX])+$/g;

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pedaços do nome da empresa que devem sumir do nome do grupo: o nome inteiro
 * e as duas primeiras palavras ("Conta Hábil Contabilidade" → "Conta Hábil"),
 * que é como o nome costuma aparecer abreviado nos grupos.
 */
function trechosDaEmpresa(nomeEmpresa: string | null | undefined): string[] {
  const nome = (nomeEmpresa || "").trim();
  if (!nome) return [];
  const palavras = nome.split(/\s+/);
  const trechos = [nome];
  if (palavras.length > 2) trechos.push(palavras.slice(0, 2).join(" "));
  return trechos;
}

export function sugerirNomeNaMensagem(opts: {
  nomeContato: string | null | undefined;
  ehGrupo: boolean;
  nomeEmpresa?: string | null;
  nomeGuardado?: string | null;
}): string {
  const guardado = (opts.nomeGuardado || "").trim();
  if (guardado) return guardado;

  const original = (opts.nomeContato || "").trim();
  if (!original) return "";

  // Contato individual: primeiro nome, como se fala no WhatsApp.
  if (!opts.ehGrupo) return original.split(/\s+/)[0];

  // Compara sem acento, mas corta no texto original. Tirar o acento de texto
  // NFC (o que o WhatsApp manda) mantém as posições: "á" vira "a", 1 por 1.
  const nfc = original.normalize("NFC");
  let resultado = nfc;
  for (const trecho of trechosDaEmpresa(opts.nomeEmpresa)) {
    const alvo = semAcento(trecho).toLowerCase();
    const re = new RegExp(escaparRegex(alvo).replace(/\s+/g, "\\s+"), "i");
    const base = semAcento(resultado).toLowerCase();
    const m = base.match(re);
    if (m && m.index !== undefined) {
      resultado = resultado.slice(0, m.index) + " " + resultado.slice(m.index + m[0].length);
    }
  }

  // "Contábil"/"Contabilidade" solto no fim ou no começo também é da empresa.
  resultado = resultado.replace(/(^|[\s|·•:\-–—/])cont[aá]bil(idade)?(?=$|[\s|·•:\-–—/])/gi, " ");
  // Separador que ficou no meio: "Padaria  x  Bom" não acontece, mas " | " sim.
  resultado = resultado.replace(/\s+[|·•:–—/]\s+/g, " ").replace(/\s+[xX]\s+/g, " ");
  resultado = resultado.replace(/\s{2,}/g, " ").replace(SEPARADORES, "").trim();

  return resultado || original;
}

/** Troca {nome_cliente} pelo nome escolhido, igual ao que a RPC faz no banco. */
export function aplicarNome(texto: string, nome: string): string {
  return texto.split("{nome_cliente}").join(nome || "cliente");
}
