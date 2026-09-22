/**
 * chat.doctorsaas.com.br é um subdomínio apontado para a MESMA pasta do
 * app.doctorsaas.com.br (hPanel → Domínios → Subdomínios, pasta /public_html/app).
 * Não existe build separado: o mesmo dist/ que a Action publica atende os dois
 * endereços, e quem decide se a pessoa vê o app inteiro ou só o chat é o
 * hostname lido aqui.
 *
 * Consequência prática: qualquer mudança neste repo vale para os dois endereços
 * no mesmo deploy — o que quebrar no chat quebra no app também.
 */

const CHAT_PREFIX = "chat.";
const OVERRIDE_KEY = "ds_chat_host";

/** Para onde mandar quem entrou pelo endereço do chat mas não usa o chat. */
export const APP_HOST_URL = "https://app.doctorsaas.com.br";

/**
 * `?chat=1` liga e `?chat=0` desliga o modo chat no localhost, onde o hostname
 * nunca começa com "chat.". Fica no sessionStorage para sobreviver à navegação
 * interna sem sujar a URL — e morre ao fechar a aba, então não vaza para o uso
 * real em produção.
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

  return window.location.hostname.toLowerCase().startsWith(CHAT_PREFIX);
}
