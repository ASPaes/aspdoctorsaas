/**
 * Campos automáticos das macros de e-mail (mockup "Macros de E-mail", aprovado
 * pelo Alexandre em 17/09/2026: "a lista de campos está ótima").
 *
 * Na macro o campo é texto: {{Nome do campo}}, no assunto e no corpo. Quem
 * troca pelo dado é a tela, na hora de usar, com os dados do cliente do chat,
 * do chamado ou da jornada. Campo que não é automático ("Data da visita") é
 * LIVRE: a pessoa completa na prévia antes de inserir.
 *
 * Módulo puro, sem React e sem Supabase: é o que o teste cobre.
 */

export const GRUPOS_CAMPOS = [
  {
    grupo: "Cliente",
    campos: [
      "Nome do contato",
      "Empresa",
      "Razão social",
      "CNPJ",
      "Código do cliente",
      "Cidade e UF",
      "E-mail do cliente",
      "Telefone",
      "Dia de vencimento",
    ],
  },
  {
    grupo: "Atendimento",
    campos: ["Nome do atendente", "Setor", "Número do atendimento", "Número do chamado", "Assunto do chamado"],
  },
  { grupo: "Data", campos: ["Saudação", "Data de hoje", "Data por extenso"] },
] as const;

export type CampoAutomatico = (typeof GRUPOS_CAMPOS)[number]["campos"][number];

export const CAMPOS_AUTOMATICOS: CampoAutomatico[] = GRUPOS_CAMPOS.flatMap((g) => [...g.campos]);

/** o que cada campo quer dizer, para o título do chip na aba Macros */
export const DESCRICAO_CAMPO: Record<CampoAutomatico, string> = {
  "Nome do contato": "Contato do chamado ou do WhatsApp; sem ele, o contato do cadastro",
  Empresa: "Nome fantasia do cliente (ou a razão social, se não tiver)",
  "Razão social": "Razão social do cadastro",
  CNPJ: "CNPJ ou CPF do cadastro, com pontuação",
  "Código do cliente": "Código do cliente no DoctorSaaS",
  "Cidade e UF": "Cidade e estado do cadastro, ex.: Maringá/PR",
  "E-mail do cliente": "E-mail do cadastro do cliente",
  Telefone: "Telefone de contato do cadastro",
  "Dia de vencimento": "Dia do vencimento da mensalidade",
  "Nome do atendente": "Como quem envia assina no chat (Preferências)",
  Setor: "Setor do atendimento ou do chamado",
  "Número do atendimento": "Número do atendimento do chat",
  "Número do chamado": "Número do chamado, ex.: TK-2026-0012",
  "Assunto do chamado": "Assunto do chamado ou da jornada",
  "Saudação": "Bom dia, Boa tarde ou Boa noite, pela hora do envio",
  "Data de hoje": "Data do dia, ex.: 18/09/2026",
  "Data por extenso": "Data do dia por extenso, ex.: 18 de setembro de 2026",
};

/** "  nome do  CLIENTE " e "Nome do cliente" são o mesmo campo */
export function normalizarCampo(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const POR_NOME = new Map<string, CampoAutomatico>(CAMPOS_AUTOMATICOS.map((c) => [normalizarCampo(c), c]));

// nomes que as macros do WhatsApp já usam: quem copiar uma de lá não perde o campo
const APELIDOS: Record<string, CampoAutomatico> = {
  "nome do cliente": "Nome do contato",
  cliente: "Nome do contato",
  contato: "Nome do contato",
  "nome do atendente": "Nome do atendente",
  atendente: "Nome do atendente",
  "nome do tecnico": "Nome do atendente",
  tecnico: "Nome do atendente",
  "nome fantasia": "Empresa",
  "codigo": "Código do cliente",
  "data": "Data de hoje",
  saudacao: "Saudação",
};

export function campoAutomatico(nome: string): CampoAutomatico | null {
  const n = normalizarCampo(nome);
  return POR_NOME.get(n) ?? APELIDOS[n] ?? null;
}

export const PADRAO_CAMPO = /\{\{\s*([^{}]{1,60}?)\s*\}\}/g;

/** os campos citados no texto, na ordem, sem repetir (pelo nome normalizado) */
export function camposDoTexto(...textos: (string | null | undefined)[]): string[] {
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (const texto of textos) {
    for (const m of (texto ?? "").matchAll(PADRAO_CAMPO)) {
      const nome = m[1].trim();
      const chave = normalizarCampo(nome);
      if (!chave || vistos.has(chave)) continue;
      vistos.add(chave);
      lista.push(nome);
    }
  }
  return lista;
}

// ── valores ──────────────────────────────────────────────────────────────────

export interface DadosDaMacro {
  contatoNome?: string | null;
  nomeFantasia?: string | null;
  razaoSocial?: string | null;
  cnpj?: string | null;
  codigoCliente?: number | string | null;
  cidade?: string | null;
  uf?: string | null;
  emailCliente?: string | null;
  telefone?: string | null;
  diaVencimento?: number | string | null;
  atendente?: string | null;
  setor?: string | null;
  numeroAtendimento?: string | number | null;
  numeroChamado?: string | null;
  assuntoChamado?: string | null;
}

export type ValoresMacro = Partial<Record<CampoAutomatico, string>>;

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** hora, dia, mês e ano em São Paulo, qualquer que seja o fuso do navegador */
function partesSP(agora: Date) {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  return { ano: v("year"), mes: v("month"), dia: v("day"), hora: v("hour") };
}

export function saudacaoPelaHora(hora: number): string {
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

export function formatarDocumento(doc: string | null | undefined): string | null {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return (doc ?? "").trim() || null;
}

export function formatarTelefone(tel: string | null | undefined): string | null {
  let d = (tel ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return (tel ?? "").trim() || null;
}

const limpo = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  return s || null;
};

export function montarValores(dados: DadosDaMacro, agora: Date = new Date()): ValoresMacro {
  const { ano, mes, dia, hora } = partesSP(agora);
  const dd = String(dia).padStart(2, "0");
  const mm = String(mes).padStart(2, "0");
  const cidadeUf = [limpo(dados.cidade), limpo(dados.uf)].filter(Boolean).join("/");

  const brutos: Record<CampoAutomatico, string | null> = {
    "Nome do contato": limpo(dados.contatoNome),
    Empresa: limpo(dados.nomeFantasia) ?? limpo(dados.razaoSocial),
    "Razão social": limpo(dados.razaoSocial),
    CNPJ: formatarDocumento(dados.cnpj),
    "Código do cliente": limpo(dados.codigoCliente),
    "Cidade e UF": cidadeUf || null,
    // o cadastro guarda vários separados por vírgula ou ponto e vírgula: vale o primeiro
    "E-mail do cliente": limpo((dados.emailCliente ?? "").split(/[;,\s]+/).find(Boolean)),
    Telefone: formatarTelefone(dados.telefone),
    "Dia de vencimento": limpo(dados.diaVencimento),
    "Nome do atendente": limpo(dados.atendente),
    Setor: limpo(dados.setor),
    "Número do atendimento": limpo(dados.numeroAtendimento),
    "Número do chamado": limpo(dados.numeroChamado),
    "Assunto do chamado": limpo(dados.assuntoChamado),
    "Saudação": saudacaoPelaHora(hora),
    "Data de hoje": `${dd}/${mm}/${ano}`,
    "Data por extenso": `${dia} de ${MESES[mes - 1]} de ${ano}`,
  };

  const valores: ValoresMacro = {};
  for (const c of CAMPOS_AUTOMATICOS) if (brutos[c]) valores[c] = brutos[c]!;
  return valores;
}

// ── preencher ────────────────────────────────────────────────────────────────

export function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface OpcoesPreencher {
  /** o texto é HTML: o valor entra escapado */
  html?: boolean;
  /**
   * prévia: o que foi preenchido volta dentro de <mark data-campo="ok"> e o que
   * falta dentro de <mark data-campo="falta">, para a tela pintar de verde e
   * amarelo. Só com html.
   */
  marcar?: boolean;
}

/**
 * Troca cada {{campo}} pelo valor: primeiro o automático, depois o que a
 * pessoa digitou para ele (livres, pelo nome normalizado). O que não tem valor
 * fica como {{campo}}, e a tela não deixa enviar assim.
 */
export function preencher(
  texto: string,
  valores: ValoresMacro,
  livres: Record<string, string> = {},
  opcoes: OpcoesPreencher = {},
): { texto: string; faltando: string[] } {
  const faltando: string[] = [];
  const marcar = opcoes.marcar && opcoes.html;
  const resultado = texto.replace(PADRAO_CAMPO, (inteiro, bruto: string) => {
    const nome = bruto.trim();
    const auto = campoAutomatico(nome);
    const digitado = limpo(livres[normalizarCampo(nome)]);
    const valor = (auto ? valores[auto] : null) ?? digitado;
    if (valor) {
      const v = opcoes.html ? escaparHtml(valor) : valor;
      return marcar ? `<mark data-campo="ok">${v}</mark>` : v;
    }
    if (!faltando.some((f) => normalizarCampo(f) === normalizarCampo(nome))) faltando.push(nome);
    return marcar ? `<mark data-campo="falta">${escaparHtml(nome)}</mark>` : inteiro;
  });
  return { texto: resultado, faltando };
}

/**
 * "Salvar este e-mail como macro": o que é dado DESTE cliente volta a ser
 * campo, para a macro servir aos outros. Só mexe no texto entre as tags, e do
 * valor mais longo para o mais curto (a razão social antes do nome fantasia que
 * está dentro dela). Valor muito curto (até 2 letras) fica: trocaria pedaço de
 * palavra.
 */
export function trocarDadosPorCampos(texto: string, valores: ValoresMacro, opcoes: { html?: boolean } = {}): string {
  const pares = (Object.entries(valores) as [CampoAutomatico, string][])
    .filter(([, v]) => v && v.trim().length >= 3)
    .map(([campo, v]) => [campo, opcoes.html ? escaparHtml(v.trim()) : v.trim()] as const)
    .sort((a, b) => b[1].length - a[1].length);
  if (pares.length === 0) return texto;

  // campo já trocado não é mexido de novo: "Setor" não pode morder o {{Razão social}}
  const trocar = (trecho: string) => {
    let s = trecho;
    for (const [campo, valor] of pares) {
      s = s
        .split(/(\{\{[^{}]*\}\})/g)
        .map((parte) => (parte.startsWith("{{") ? parte : parte.split(valor).join(`{{${campo}}}`)))
        .join("");
    }
    return s;
  };
  if (!opcoes.html) return trocar(texto);
  // tag fica intacta: só o texto entre elas é trocado
  return texto
    .split(/(<[^>]*>)/g)
    .map((parte) => (parte.startsWith("<") ? parte : trocar(parte)))
    .join("");
}
