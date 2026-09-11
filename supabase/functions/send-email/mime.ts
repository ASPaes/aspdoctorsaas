/**
 * Montagem da mensagem (RFC 5322 + MIME), sem biblioteca.
 *
 * O cuidado que justifica o arquivo: cabeçalho com acento. No DoctorDev o
 * denomailer re-codificava o assunto e quebrava a linha com `=\r\n`, o que
 * encerra o cabeçalho e joga From/To para dentro do corpo — dois dias de e-mail
 * quebrado sem ninguém notar. Aqui o assunto vira palavras codificadas
 * (RFC 2047, base64) de no máximo 64 caracteres, dobradas com CRLF + espaço, e
 * cada pedaço é cortado por caractere, nunca no meio de um byte UTF-8.
 */

const enc = new TextEncoder();

function b64Bytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** base64 em linhas de 76 colunas, como o MIME pede no corpo */
const b64Corpo = (texto: string) => (b64Bytes(enc.encode(texto)).match(/.{1,76}/g) ?? [""]).join("\r\n");

/** tira CR/LF: sem isso, um assunto com quebra de linha injeta cabeçalho */
export const semQuebra = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

const soAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/**
 * 39 bytes viram 52 caracteres de base64; com o envelope `=?UTF-8?B?…?=` dá 64.
 * "Subject: " + 64 = 73, dentro das 76 colunas que a RFC 2047 exige para linha
 * de cabeçalho com palavra codificada.
 */
const BYTES_POR_PALAVRA = 39;

export function codificarCabecalho(texto: string): string {
  const t = semQuebra(texto);
  if (soAscii(t)) return t;

  const palavras: string[] = [];
  let atual: number[] = [];
  // for…of anda por code point: emoji (par surrogate) nunca é partido
  for (const ch of t) {
    const bytes = enc.encode(ch);
    if (atual.length + bytes.length > BYTES_POR_PALAVRA) {
      palavras.push(b64Bytes(Uint8Array.from(atual)));
      atual = [];
    }
    atual.push(...bytes);
  }
  if (atual.length) palavras.push(b64Bytes(Uint8Array.from(atual)));

  // espaço entre palavras codificadas vizinhas é ignorado por quem decodifica
  return palavras.map((p) => `=?UTF-8?B?${p}?=`).join("\r\n ");
}

const ENDERECO = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;
export const enderecoValido = (e: string) => ENDERECO.test(e);

/** `Nome <email>`: ASCII vai entre aspas, com acento vai codificado (palavra codificada não pode ficar entre aspas) */
export function formatarEndereco(email: string, nome?: string | null): string {
  const n = semQuebra(nome ?? "");
  if (!n) return email;
  const nomeFormatado = soAscii(n) ? `"${n.replace(/(["\\])/g, "\\$1")}"` : codificarCabecalho(n);
  return `${nomeFormatado} <${email}>`;
}

/** texto puro a partir do HTML, para o leitor que não mostra HTML */
export function htmlParaTexto(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** data no formato RFC 5322, em UTC */
const dataRfc = (d: Date) => d.toUTCString().replace(/GMT$/, "+0000");

export interface MensagemEntrada {
  de: { email: string; nome?: string | null };
  para: string[];
  cc?: string[];
  responderPara?: string | null;
  assunto: string;
  html?: string | null;
  texto?: string | null;
  agora?: Date;
}

export interface MensagemMontada {
  bruta: string;
  messageId: string;
}

export function montarMensagem(m: MensagemEntrada): MensagemMontada {
  const dominio = m.de.email.split("@")[1] ?? "doctorsaas.com.br";
  const messageId = `<${crypto.randomUUID()}@${dominio}>`;
  const fronteira = `=_ds_${crypto.randomUUID().replace(/-/g, "")}`;
  // CRLF em tudo: SMTP não aceita LF solto
  const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");
  const html = m.html ? crlf(m.html) : null;
  const texto = crlf(m.texto ?? (m.html ? htmlParaTexto(m.html) : ""));

  const cabecalhos = [
    `From: ${formatarEndereco(m.de.email, m.de.nome)}`,
    `To: ${m.para.join(", ")}`,
    ...(m.cc && m.cc.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    ...(m.responderPara ? [`Reply-To: ${m.responderPara}`] : []),
    `Subject: ${codificarCabecalho(m.assunto)}`,
    `Date: ${dataRfc(m.agora ?? new Date())}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ];

  const parteTexto = [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Corpo(texto),
  ].join("\r\n");

  let corpo: string[];
  if (html) {
    const parteHtml = [
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64Corpo(html),
    ].join("\r\n");
    corpo = [
      `Content-Type: multipart/alternative; boundary="${fronteira}"`,
      "",
      `--${fronteira}`,
      parteTexto,
      `--${fronteira}`,
      parteHtml,
      `--${fronteira}--`,
    ];
  } else {
    corpo = [parteTexto];
  }

  return { bruta: [...cabecalhos, ...corpo].join("\r\n"), messageId };
}
