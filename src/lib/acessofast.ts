/**
 * Integração DoctorSaaS ↔ AcessoFast (acesso remoto na máquina do cliente).
 *
 * Todo o contrato cabe numa URL: `/conectar?conv=<id>&cnpj=<14 dígitos>&nome=<empresa>`.
 * Com o CNPJ em mãos a janelinha acha o cliente sozinha e abre direto nas máquinas;
 * sem ele, cai na escolha manual, que é o comportamento antigo. Não há chamada de
 * API, não há credencial: a janelinha roda na sessão do próprio técnico, e é o
 * controle de acesso do AcessoFast que recorta o que ele enxerga.
 *
 * O `conv` carrega o tenant (`<tenant_id>:<conversation_id>`) e precisa ser estável
 * entre sessões — o AcessoFast usa esse valor como chave do vínculo da conversa.
 */

export const ACESSOFAST_PAINEL = "https://app.acessofast.com.br";

/** Origem exata do painel. O listener do postMessage compara contra isto. */
export const ACESSOFAST_ORIGIN = "https://app.acessofast.com.br";

const JANELA = "acessofast";
const JANELA_FEATURES = "width=520,height=680";

/** Limite do contrato para o `nome`. */
const NOME_MAX = 120;

export interface AcessoFastEmpresa {
  /** CNPJ em qualquer formato; só vai se sobrarem exatamente 14 dígitos. */
  cnpj?: string | null;
  /** Nome da empresa (ou do contato, quando não há cliente vinculado). */
  nome?: string | null;
}

/** Monta o identificador que viaja no `?conv=`. Retorna null se faltar peça. */
export function buildAcessoFastConv(
  tenantId: string | null | undefined,
  conversationId: string | null | undefined,
): string | null {
  if (!tenantId || !conversationId) return null;
  return `${tenantId}:${conversationId}`;
}

export function buildAcessoFastUrl(conv: string, empresa: AcessoFastEmpresa = {}): string {
  const params = new URLSearchParams({ conv });

  // Eles exigem 14 dígitos e recusam com `cnpj_invalido`. Mandar algo que não é
  // CNPJ só produziria a escolha manual com um erro no meio do caminho.
  const digits = (empresa.cnpj ?? "").replace(/\D/g, "");
  if (digits.length === 14) params.set("cnpj", digits);

  const nome = (empresa.nome ?? "").trim();
  if (nome) params.set("nome", nome.slice(0, NOME_MAX));

  return `${ACESSOFAST_PAINEL}/conectar?${params.toString()}`;
}

/**
 * Referência da janelinha aberta. O listener do postMessage exige que o evento
 * tenha vindo DESTA janela — `e.origin` sozinho não basta, porque qualquer aba do
 * mesmo domínio passaria.
 */
let janelaAberta: Window | null = null;
export function getAcessoFastWindow(): Window | null {
  return janelaAberta;
}

/**
 * Abre a janelinha do AcessoFast.
 *
 * ⚠️ SÍNCRONA DE PROPÓSITO. O navegador só libera `window.open` como resposta
 * imediata ao clique — qualquer `await` antes daqui e o popup é bloqueado.
 * Se precisar registrar/salvar algo, faça DEPOIS de chamar esta função.
 */
export function openAcessoFast(
  tenantId: string | null | undefined,
  conversationId: string | null | undefined,
  empresa: AcessoFastEmpresa = {},
): Window | null {
  const conv = buildAcessoFastConv(tenantId, conversationId);
  if (!conv) return null;

  // Janela separada, nunca <iframe>: dentro de iframe de outro domínio o
  // navegador isola o storage e o técnico aparece como deslogado no AcessoFast.
  const win = window.open(buildAcessoFastUrl(conv, empresa), JANELA, JANELA_FEATURES);
  win?.focus?.();
  janelaAberta = win;
  return win;
}
