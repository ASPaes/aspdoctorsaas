/**
 * Integração DoctorSaaS ↔ AcessoFast (acesso remoto na máquina do cliente).
 *
 * O contrato com o parceiro é uma URL só: `/conectar?conv=<id>`. O `conv` precisa
 * ser estável entre sessões (o AcessoFast grava o vínculo conversa→cliente na
 * primeira vez) e caber em 200 caracteres.
 *
 * Somos multi-tenant no mesmo banco, então o `conv` carrega o tenant junto:
 * `<tenant_id>:<conversation_id>`. Sem isso, um UUID de conversa chutado faria a
 * função de resolução devolver o CNPJ de cliente de outro assinante. A RPC
 * `acessofast_resolver_conversa` desmonta esse par e exige que os dois casem.
 */

export const ACESSOFAST_PAINEL = "https://app.acessofast.com.br";

/** Nome da janela: mantê-lo constante reaproveita a mesma janelinha a cada clique. */
const JANELA = "acessofast";
const JANELA_FEATURES = "width=520,height=640";

/** Monta o identificador que viaja no `?conv=`. Retorna null se faltar peça. */
export function buildAcessoFastConv(
  tenantId: string | null | undefined,
  conversationId: string | null | undefined,
): string | null {
  if (!tenantId || !conversationId) return null;
  return `${tenantId}:${conversationId}`;
}

export function buildAcessoFastUrl(conv: string): string {
  return `${ACESSOFAST_PAINEL}/conectar?conv=${encodeURIComponent(conv)}`;
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
): Window | null {
  const conv = buildAcessoFastConv(tenantId, conversationId);
  if (!conv) return null;

  // Janela separada, nunca <iframe>: dentro de iframe de outro domínio o
  // navegador isola o storage e o técnico aparece como deslogado no AcessoFast.
  const win = window.open(buildAcessoFastUrl(conv), JANELA, JANELA_FEATURES);
  win?.focus?.();
  return win;
}
