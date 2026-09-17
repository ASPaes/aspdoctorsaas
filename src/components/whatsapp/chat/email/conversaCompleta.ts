/**
 * "Incluir a conversa completa" (16/09/2026, mockup aprovado pelo Alexandre).
 *
 * Monta, a partir das mensagens que a `gerar-email-chat` devolve no modo
 * conversa, o bloco que vai no e-mail depois da assinatura. Sem IA: o que o
 * cliente lê é exatamente o que foi trocado. Nota interna mora em outra tabela
 * e nunca chega aqui; mensagem apagada já vem filtrada do servidor.
 *
 * HTML com estilo inline e tabela simples, que é o que Gmail e Outlook desenham
 * igual. Todo texto do banco passa por `escapar`: mensagem de cliente é
 * conteúdo não confiável e não pode virar tag no e-mail.
 */

export interface MensagemConversa {
  content: string | null;
  timestamp: string;
  is_from_me: boolean;
  sender_name: string | null;
  message_type: string | null;
  audio_transcription: string | null;
  media_filename: string | null;
}

export interface BlocoConversa {
  codigo: string | number | null;
  aberto_em: string;
  encerrado_em: string | null;
  mensagens: MensagemConversa[];
}

export interface ConversaMontada {
  html: string;
  texto: string;
  mensagens: number;
  /** tamanho do HTML em bytes, para o aviso do corte do Gmail */
  bytes: number;
}

/**
 * O Gmail esconde o fim de e-mails com mais de ~102 KB de HTML atrás de "Ver
 * mensagem inteira". Resumo e assinatura também contam, então o aviso vem antes.
 */
export const LIMITE_AVISO_GMAIL_BYTES = 90_000;

const FUSO = "America/Sao_Paulo";

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO });
const horaMin = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

const MIDIA: Record<string, string> = {
  image: "imagem",
  video: "vídeo",
  audio: "áudio",
  document: "documento",
  sticker: "figurinha",
  location: "localização",
};

/** o que aparece no lugar da mensagem: texto, ou a marcação da mídia com legenda/transcrição */
export function conteudoDaMensagem(m: MensagemConversa): { marca: string | null; texto: string } | null {
  const texto = (m.content ?? "").trim();
  const tipo = m.message_type ?? "text";
  const rotulo = MIDIA[tipo];
  if (!rotulo) return texto ? { marca: null, texto } : null;

  if (tipo === "audio") {
    const transcricao = (m.audio_transcription ?? "").trim();
    return { marca: "[áudio]", texto: transcricao || texto };
  }
  const marca = tipo === "document" && m.media_filename ? `[documento: ${m.media_filename}]` : `[${rotulo}]`;
  // a legenda de foto e vídeo às vezes vem igual ao nome do arquivo: não repete
  return { marca, texto: texto && texto !== m.media_filename ? texto : "" };
}

function quem(m: MensagemConversa, contatoNome: string | null): string {
  const nome = (m.sender_name ?? "").trim();
  if (m.is_from_me) return nome ? `${nome} (atendente)` : "Atendente";
  return `${nome || contatoNome || "Cliente"} (cliente)`;
}

function titulo(b: BlocoConversa, mensagens: MensagemConversa[]): string {
  const inicio = mensagens[0]?.timestamp ?? b.aberto_em;
  const fim = mensagens[mensagens.length - 1]?.timestamp ?? b.encerrado_em ?? b.aberto_em;
  const periodo =
    dia(inicio) === dia(fim)
      ? `${dia(inicio)}, das ${horaMin(inicio)} às ${horaMin(fim)}`
      : `de ${dia(inicio)} ${horaMin(inicio)} a ${dia(fim)} ${horaMin(fim)}`;
  const nome = b.codigo != null ? `Conversa completa do atendimento #${b.codigo}` : "Conversa completa";
  return `${nome} · WhatsApp · ${periodo}`;
}

export function montarConversaCompleta(blocos: BlocoConversa[], contatoNome: string | null): ConversaMontada {
  const partesHtml: string[] = [];
  const partesTexto: string[] = [];
  let total = 0;

  for (const b of blocos) {
    const linhas = b.mensagens
      .map((m) => ({ m, c: conteudoDaMensagem(m) }))
      .filter((x): x is { m: MensagemConversa; c: { marca: string | null; texto: string } } => x.c !== null);
    if (linhas.length === 0) continue;
    total += linhas.length;

    const msgs = linhas.map((x) => x.m);
    const cabecalho = titulo(b, msgs);
    const variosDias = dia(msgs[0].timestamp) !== dia(msgs[msgs.length - 1].timestamp);
    const quando = (iso: string) => (variosDias ? `${dia(iso).slice(0, 5)} ${horaMin(iso)}` : horaMin(iso));

    const trs = linhas
      .map(({ m, c }) => {
        const cor = m.is_from_me ? "#15803D" : "#0369A1";
        const marca = c.marca ? `<span style="color:#64748B;font-style:italic">${escapar(c.marca)}</span>${c.texto ? " " : ""}` : "";
        const texto = escapar(c.texto).replace(/\r?\n/g, "<br>");
        return (
          `<tr>` +
          `<td style="padding:5px 8px 5px 0;vertical-align:top;color:#64748B;font-size:12px;white-space:nowrap">${escapar(quando(m.timestamp))}</td>` +
          `<td style="padding:5px 8px;vertical-align:top;font-weight:bold;color:${cor};white-space:nowrap">${escapar(quem(m, contatoNome))}</td>` +
          `<td style="padding:5px 0;vertical-align:top">${marca}${texto}</td>` +
          `</tr>`
        );
      })
      .join("");

    partesHtml.push(
      `<div style="margin-top:22px;border-top:1px dashed #CBD5E1;padding-top:12px">` +
        `<p style="margin:0 0 10px;font-size:12px;color:#64748B"><b style="color:#0F172A">${escapar(cabecalho)}</b></p>` +
        `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;line-height:1.45;color:#1E293B">${trs}</table>` +
        `</div>`,
    );

    partesTexto.push(
      [
        `---------- ${cabecalho} ----------`,
        ...linhas.map(({ m, c }) => `[${quando(m.timestamp)}] ${quem(m, contatoNome)}: ${[c.marca, c.texto].filter(Boolean).join(" ")}`),
      ].join("\n"),
    );
  }

  if (total === 0) return { html: "", texto: "", mensagens: 0, bytes: 0 };

  const html = `<div style="font-family:Arial,Helvetica,sans-serif">${partesHtml.join("")}</div>`;
  return {
    html,
    texto: partesTexto.join("\n\n"),
    mensagens: total,
    bytes: new TextEncoder().encode(html).length,
  };
}
