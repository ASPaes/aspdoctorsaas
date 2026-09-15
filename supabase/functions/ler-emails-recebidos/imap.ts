/**
 * Cliente IMAP mínimo para LER a caixa, e o parsing do que vem dela.
 *
 * Regras que o desenho impõe, e que estão no código de propósito:
 *  - abre com EXAMINE, nunca SELECT: é caixa de gente, robô não marca como lido;
 *  - anda por marca d'água de UID, nunca por \Seen;
 *  - baixa CABEÇALHO de todo mundo e CORPO só de quem interessa, para não
 *    trafegar (nem guardar) o resto da caixa.
 *
 * Sem biblioteca: as que existem em Deno para IMAP são grandes e o que se usa
 * aqui é um punhado de comandos. O que dá trabalho é literal (`{123}`), e isso
 * está isolado em `lerResposta`.
 */

export type SegurancaImap = "ssl" | "starttls" | "none";

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });
const TIMEOUT_MS = 20_000;

/** 1 caractere por byte, sem interpretar: só assim o `{N}` do IMAP, que conta bytes, bate */
export function paraBinario(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
}

/** do binário de volta para texto UTF-8, que é o que o parser de e-mail espera */
function binarioParaTexto(s: string): string {
  return dec.decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
}

function comPrazo<T>(p: Promise<T>, etapa: string, ms = TIMEOUT_MS): Promise<T> {
  let timer: number;
  const relogio = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`TIMEOUT na etapa ${etapa}`)), ms);
  });
  return Promise.race([p, relogio]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export interface CaixaInfo {
  uidValidity: number;
  uidNext: number;
  existem: number;
}

export class ClienteImap {
  private conn: Deno.Conn | null = null;
  /** bytes crus, 1 caractere por byte (ver `paraBinario`) */
  private buffer = "";
  private contador = 0;

  constructor(private host: string, private port: number, private seguranca: SegurancaImap) {}

  async conectar(usuario: string, senha: string): Promise<void> {
    this.conn = this.seguranca === "ssl"
      ? await comPrazo(Deno.connectTls({ hostname: this.host, port: this.port }), "conexão")
      : await comPrazo(Deno.connect({ hostname: this.host, port: this.port }), "conexão");

    const saudacao = await this.lerAte((t) => /\r\n/.test(t), "saudação");
    if (!/^\* (OK|PREAUTH)/.test(saudacao)) throw new Error(`saudação: ${saudacao.trim()}`);

    if (this.seguranca === "starttls") {
      await this.comando("STARTTLS");
      this.conn = await comPrazo(Deno.startTls(this.conn as Deno.TcpConn, { hostname: this.host }), "STARTTLS");
    }

    await this.comando(`LOGIN ${this.citar(usuario)} ${this.citar(senha)}`);
  }

  /** aspas e barra invertida escapadas, como o IMAP pede em string literal */
  private citar(v: string) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  private async escrever(texto: string) {
    const bytes = enc.encode(texto);
    let enviados = 0;
    while (enviados < bytes.length) {
      enviados += await comPrazo(this.conn!.write(bytes.subarray(enviados)), "escrita");
    }
  }

  private async encher(): Promise<void> {
    const pedaco = new Uint8Array(64 * 1024);
    const n = await comPrazo(this.conn!.read(pedaco), "leitura");
    if (n === null) throw new Error("Conexão encerrada pelo servidor");
    this.buffer += paraBinario(pedaco.subarray(0, n));
  }

  private async lerAte(pronto: (texto: string) => boolean, etapa: string): Promise<string> {
    while (!pronto(this.buffer)) await this.encher();
    const texto = this.buffer;
    this.buffer = "";
    return texto;
  }

  /**
   * Lê a resposta de um comando até a linha com a etiqueta, andando linha a
   * linha. O nó do problema: `{123}` no fim de uma linha avisa que vêm 123
   * BYTES crus, que podem ter quebra de linha (e até algo parecido com a
   * etiqueta). Eles são pulados inteiros, sem olhar dentro.
   */
  private async lerResposta(etiqueta: string, etapa: string): Promise<string> {
    let pos = 0;
    while (true) {
      const fim = this.buffer.indexOf("\r\n", pos);
      if (fim < 0) {
        await this.encher();
        continue;
      }
      const linha = this.buffer.slice(pos, fim);
      const literal = linha.match(/\{(\d+)\}$/);
      if (literal) {
        const depois = fim + 2 + Number(literal[1]);
        if (this.buffer.length < depois) {
          await this.encher();
          continue;
        }
        pos = depois;
        continue;
      }
      if (linha.startsWith(`${etiqueta} `)) {
        if (!/^\S+ OK/.test(linha)) throw new Error(`${etapa}: ${linha.trim()}`);
        const texto = this.buffer.slice(0, fim + 2);
        this.buffer = this.buffer.slice(fim + 2);
        return texto;
      }
      pos = fim + 2;
    }
  }

  private async comando(cmd: string): Promise<string> {
    const etiqueta = `a${++this.contador}`;
    await this.escrever(`${etiqueta} ${cmd}\r\n`);
    return await this.lerResposta(etiqueta, cmd.split(" ")[0]);
  }

  /** EXAMINE: abre a caixa SEM direito de escrita, então nada vira lido */
  async examinar(caixa = "INBOX"): Promise<CaixaInfo> {
    const r = await this.comando(`EXAMINE ${this.citar(caixa)}`);
    const num = (re: RegExp) => Number(r.match(re)?.[1] ?? 0);
    return {
      uidValidity: num(/UIDVALIDITY (\d+)/i),
      uidNext: num(/UIDNEXT (\d+)/i),
      existem: num(/\* (\d+) EXISTS/i),
    };
  }

  /** cabeçalhos de tudo que chegou depois da marca d'água */
  async cabecalhosDesde(ultimoUid: number, limite: number): Promise<{ uid: number; cabecalho: string }[]> {
    const campos =
      "FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES DELIVERED-TO X-ORIGINAL-TO " +
      "AUTO-SUBMITTED PRECEDENCE LIST-UNSUBSCRIBE X-AUTO-RESPONSE-SUPPRESS RETURN-PATH";
    const bruto = await this.comando(`UID FETCH ${ultimoUid + 1}:* (UID BODY.PEEK[HEADER.FIELDS (${campos})])`);
    return novosDesde(separarFetch(bruto), ultimoUid).slice(0, limite);
  }

  /** corpo inteiro de uma mensagem, só para quem passou no filtro */
  async mensagem(uid: number): Promise<string> {
    const bruto = await this.comando(`UID FETCH ${uid} (BODY.PEEK[])`);
    return separarFetch(bruto)[0]?.cabecalho ?? "";
  }

  /**
   * A mesma mensagem nas duas formas, com um download só: texto (UTF-8, para
   * extrairTexto) e binário (1 caractere por byte, para os anexos, cujos bytes
   * não sobrevivem à conversão para UTF-8).
   */
  async mensagemCompleta(uid: number): Promise<{ texto: string; binario: string }> {
    const bruto = await this.comando(`UID FETCH ${uid} (BODY.PEEK[])`);
    const binario = separarFetch(bruto, true)[0]?.cabecalho ?? "";
    return { texto: binarioParaTexto(binario), binario };
  }

  async encerrar(): Promise<void> {
    try {
      await this.comando("LOGOUT");
    } catch {
      // servidor já foi embora; não interessa
    }
    try {
      this.conn?.close();
    } catch {
      // idem
    }
  }
}

/**
 * Separa a resposta de um FETCH em (uid, conteúdo do literal).
 *
 * Recebe o binário (1 caractere por byte) porque `{N}` conta BYTES: cortar por
 * caractere desalinha no primeiro acento cru e engole a mensagem seguinte.
 * O UID pode vir antes ou depois do literal; a ordem dos itens é do servidor,
 * que não precisa seguir a ordem pedida.
 */
export function separarFetch(bruto: string, manterBinario = false): { uid: number; cabecalho: string }[] {
  const saida: { uid: number; cabecalho: string }[] = [];
  const re = /\* \d+ FETCH \(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto)) !== null) {
    const fimLinha = bruto.indexOf("\r\n", m.index);
    if (fimLinha < 0) break;
    const linha = bruto.slice(m.index, fimLinha);
    const literal = linha.match(/\{(\d+)\}$/);
    if (!literal) {
      // item sem conteúdo (FLAGS avulso, por exemplo): nada a separar
      re.lastIndex = fimLinha;
      continue;
    }
    const inicio = fimLinha + 2;
    const fimConteudo = inicio + Number(literal[1]);
    let fimItem = bruto.indexOf("\r\n", fimConteudo);
    if (fimItem < 0) fimItem = bruto.length;
    const resto = bruto.slice(fimConteudo, fimItem);
    const uid = Number(`${linha} ${resto}`.match(/\bUID (\d+)/)?.[1] ?? 0);
    const conteudo = bruto.slice(inicio, fimConteudo);
    saida.push({ uid, cabecalho: manterBinario ? conteudo : binarioParaTexto(conteudo) });
    re.lastIndex = fimItem;
  }
  return saida;
}

/** `UID FETCH n:*` devolve a última mensagem mesmo quando ela é anterior a n (RFC 3501) */
export function novosDesde<T extends { uid: number }>(partes: T[], ultimoUid: number): T[] {
  return partes.filter((p) => p.uid > ultimoUid);
}

// ─────────────────────────── parsing de e-mail ───────────────────────────

/** cabeçalhos em minúsculo, já desdobrados (linha que continua com espaço) */
export function lerCabecalhos(bruto: string): Record<string, string> {
  const fim = bruto.search(/\r?\n\r?\n/);
  const cabecalho = fim >= 0 ? bruto.slice(0, fim) : bruto;
  const linhas = cabecalho.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  const saida: Record<string, string> = {};
  for (const linha of linhas) {
    const i = linha.indexOf(":");
    if (i <= 0) continue;
    const nome = linha.slice(0, i).trim().toLowerCase();
    const valor = linha.slice(i + 1).trim();
    saida[nome] = saida[nome] ? `${saida[nome]}, ${valor}` : valor;
  }
  return saida;
}

const base64ParaBytes = (b64: string) =>
  Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));

export function decodificarQuotedPrintable(texto: string): Uint8Array {
  const limpo = texto.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < limpo.length; i++) {
    if (limpo[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(limpo.slice(i + 1, i + 3))) {
      bytes.push(parseInt(limpo.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(limpo.charCodeAt(i) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/** desfaz =?UTF-8?B?…?= e =?ISO-8859-1?Q?…?= de assunto e nome */
export function decodificarCabecalho(valor: string): string {
  if (!valor) return "";
  return valor
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, tipo, dados) => {
      try {
        const bytes = tipo.toUpperCase() === "B"
          ? base64ParaBytes(dados)
          : decodificarQuotedPrintable(String(dados).replace(/_/g, " "));
        return new TextDecoder(String(charset).toLowerCase(), { fatal: false }).decode(bytes);
      } catch {
        return dados;
      }
    });
}

/** `Nome <a@b.com>` ou `a@b.com` */
export function extrairEndereco(valor: string): { nome: string; email: string } {
  const comNome = valor.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (comNome) return { nome: decodificarCabecalho(comNome[1]).replace(/^"|"$/g, ""), email: comNome[2].trim().toLowerCase() };
  return { nome: "", email: valor.trim().toLowerCase() };
}

/**
 * Texto legível da mensagem: prefere text/plain; se só houver HTML, tira as
 * tags. Percorre multipart procurando a primeira parte de texto.
 */
export function extrairTexto(bruto: string): string {
  const cab = lerCabecalhos(bruto);
  const corpoInteiro = bruto.slice(bruto.search(/\r?\n\r?\n/) + 2).replace(/^\r?\n/, "");
  const tipoBruto = cab["content-type"] ?? "text/plain";
  const tipo = tipoBruto.toLowerCase();

  const decodificarParte = (parteBruta: string): string => {
    const c = lerCabecalhos(parteBruta);
    const corpo = parteBruta.slice(parteBruta.search(/\r?\n\r?\n/) + 2).replace(/^\r?\n/, "");
    const codificacao = (c["content-transfer-encoding"] ?? "").toLowerCase();
    const charset = (c["content-type"] ?? "").match(/charset="?([^";\s]+)"?/i)?.[1] ?? "utf-8";
    const bytes = codificacao.includes("base64")
      ? base64ParaBytes(corpo)
      : codificacao.includes("quoted-printable")
        ? decodificarQuotedPrintable(corpo)
        : enc.encode(corpo);
    const texto = new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
    return (c["content-type"] ?? "").toLowerCase().includes("text/html") ? htmlParaTexto(texto) : texto;
  };

  if (tipo.startsWith("multipart/")) {
    // do bruto: minúsculo estraga a fronteira, que diferencia maiúscula
    const fronteira = tipoBruto.match(/boundary="?([^";]+)"?/i)?.[1];
    if (fronteira) {
      // Escolhe pelo Content-Type DA PRÓPRIA parte. Procurar "text/plain" no
      // conteúdo inteiro achava a parte multipart/alternative (que contém um
      // text/plain dentro) e devolvia ela crua, com fronteiras: foi o que
      // aconteceu no primeiro e-mail com anexo, em 14/09/2026.
      const partes = corpoInteiro
        .split(`--${fronteira}`)
        .slice(1, -1)
        .map((p) => p.replace(/^\r?\n/, ""))
        .map((p) => {
          const c = lerCabecalhos(p);
          return {
            p,
            tipo: (c["content-type"] ?? "text/plain").toLowerCase(),
            anexo: /attachment/i.test(c["content-disposition"] ?? ""),
          };
        });
      const plana = partes.find((x) => x.tipo.startsWith("text/plain") && !x.anexo);
      const html = partes.find((x) => x.tipo.startsWith("text/html") && !x.anexo);
      const aninhadas = partes.filter((x) => x.tipo.startsWith("multipart/"));
      if (plana) return decodificarParte(plana.p);
      for (const x of aninhadas) {
        const texto = extrairTexto(x.p);
        if (texto) return texto;
      }
      if (html) return decodificarParte(html.p);
    }
    return "";
  }
  return decodificarParte(bruto);
}

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
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Corta a citação do e-mail anterior. O Gmail dobra a linha de atribuição e
 * deixa o "escreveu:" sozinho embaixo, então o corte olha as duas formas.
 */
export function cortarCitacao(texto: string): string {
  const linhas = texto.split(/\r?\n/);
  const corte = linhas.findIndex((l, i) => {
    const linha = l.trim();
    if (/^>/.test(linha)) return true;
    if (/^-{2,}\s*(mensagem original|forwarded message|original message)/i.test(linha)) return true;
    // atribuição "Em <data>, <nome> <e-mail> escreveu:". O Gmail dobra essa linha
    // onde quiser, até dentro do <e-mail> (visto em 12/09/2026), então junta até
    // 3 linhas. Terminar em "escreveu:" é o que impede cortar um "Em breve…".
    if (/^(em|on)\s+/i.test(linha)) {
      let junta = linha;
      for (let k = 0; k < 3; k++) {
        if (k > 0) junta += (junta.endsWith("<") ? "" : " ") + (linhas[i + k] ?? "").trim();
        if (/^(em|on)\s+.{6,}(escreveu|wrote)\s*:?\s*$/i.test(junta)) return true;
      }
    }
    if (/^_{5,}$/.test(linha)) return true;
    return false;
  });
  const util = corte >= 0 ? linhas.slice(0, corte) : linhas;
  return util.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Acha a identificação do envio: no endereço com sufixo (`caixa+TOKEN@`) de
 * qualquer destinatário, ou no `[#TOKEN]` do assunto.
 */
export function acharToken(cab: Record<string, string>): string | null {
  const destinos = [cab["to"], cab["cc"], cab["delivered-to"], cab["x-original-to"], cab["reply-to"]]
    .filter(Boolean)
    .join(", ");
  const noEndereco = destinos.match(/\+([A-HJ-NP-Z2-9]{10})@/i);
  if (noEndereco) return noEndereco[1].toUpperCase();
  const noAssunto = decodificarCabecalho(cab["subject"] ?? "").match(/\[#([A-HJ-NP-Z2-9]{10})\]/i);
  return noAssunto ? noAssunto[1].toUpperCase() : null;
}

/** propaganda, boletim e resposta automática se entregam nos próprios cabeçalhos */
export function ehAutomatico(cab: Record<string, string>): boolean {
  if (cab["list-unsubscribe"] || cab["list-id"]) return true;
  if (/^(bulk|list|junk)$/i.test((cab["precedence"] ?? "").trim())) return true;
  const auto = (cab["auto-submitted"] ?? "").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (cab["x-auto-response-suppress"]) return true;
  const de = extrairEndereco(cab["from"] ?? "").email;
  if (/^(no-?reply|nao-?responda|mailer-daemon|postmaster|bounce)/i.test(de)) return true;
  return false;
}
