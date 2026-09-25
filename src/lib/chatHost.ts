/**
 * mobile.doctorsaas.com.br é um subdomínio apontado para a MESMA pasta do
 * app.doctorsaas.com.br (hPanel → Domínios → Subdomínios, pasta /public_html/app).
 * Não existe build separado: o mesmo dist/ que a Action publica atende os dois
 * endereços, e quem decide se a pessoa vê o sistema inteiro ou a versão de
 * telefone é o hostname lido aqui.
 *
 * Consequência prática: qualquer mudança neste repo vale para os dois endereços
 * no mesmo deploy — o que quebrar no mobile quebra no app também.
 *
 * ⚠️ Nasceu como `chat.` em 22/09/2026 e virou `mobile.` em 24/09, quando a
 * versão de telefone deixou de ser só o chat e ganhou tela inicial com os
 * módulos. O prefixo antigo continua reconhecido de propósito: app instalado
 * guarda o endereço da instalação, e quem instalou pelo `chat.` continuaria
 * abrindo por ele até reinstalar.
 */

const PREFIXOS = ["mobile.", "chat."];
const OVERRIDE_KEY = "ds_chat_host";

/** Para onde mandar quem entrou pelo endereço de telefone mas não tem acesso. */
export const APP_HOST_URL = "https://app.doctorsaas.com.br";

/**
 * `?chat=1` liga e `?chat=0` desliga o modo telefone no localhost, onde o
 * hostname nunca começa com "mobile.". Fica no sessionStorage para sobreviver à
 * navegação interna sem sujar a URL — e morre ao fechar a aba, então não vaza
 * para o uso real em produção.
 */
export function isChatHost(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const param = new URLSearchParams(window.location.search).get("chat");
    if (param === "1" || param === "0") {
      sessionStorage.setItem(OVERRIDE_KEY, param);
    }
    const saved = sessionStorage.getItem(OVERRIDE_KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {
    // sessionStorage bloqueado (aba privada, cookies negados): o hostname decide.
  }

  const host = window.location.hostname.toLowerCase();
  return PREFIXOS.some((prefixo) => host.startsWith(prefixo));
}
