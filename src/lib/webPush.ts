import { supabase } from "@/integrations/supabase/client";

/**
 * Web Push: o aviso que chega com o app FECHADO.
 *
 * O que já existia antes disto só funcionava com o chat aberto — a notificação
 * era criada pela própria página, então página fechada, nenhum aviso. Aqui o
 * aparelho se inscreve no serviço do próprio navegador (Google, Mozilla, Apple)
 * e passa a receber mesmo sem o app rodando.
 *
 * Três coisas que não são óbvias:
 *
 * 1. **A assinatura é por APARELHO, não por pessoa.** O mesmo atendente no
 *    celular e no computador gera dois endpoints diferentes, e os dois precisam
 *    receber.
 * 2. **O endpoint muda sozinho.** O navegador renova a assinatura quando quer;
 *    por isso gravamos por `endpoint` (chave única) e reenviamos a cada carga do
 *    app, em vez de guardar uma vez e confiar.
 * 3. **`userVisibleOnly: true` é obrigatório** no Chrome: quem se inscreve
 *    promete mostrar algo visível a cada push. Push silencioso não existe aqui.
 */

const CHAVE_PUBLICA = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/** base64url → Uint8Array, formato que o `applicationServerKey` exige. */
function chaveParaBytes(base64url: string): Uint8Array {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const bruto = atob(base64);
  const bytes = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

function paraBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function webPushDisponivel(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    !!CHAVE_PUBLICA
  );
}

/**
 * Inscreve este aparelho e grava a assinatura. Silencioso de propósito: é
 * chamado no carregamento do app, e falhar aqui não pode atrapalhar o
 * atendimento — o pior caso é continuar sem aviso com o app fechado.
 */
export async function inscreverAparelho(tenantId: string | null, userId: string | null) {
  if (!webPushDisponivel() || !tenantId || !userId) return;
  if (Notification.permission !== "granted") return;

  try {
    const registro = await navigator.serviceWorker.ready;
    let assinatura = await registro.pushManager.getSubscription();

    if (!assinatura) {
      assinatura = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(CHAVE_PUBLICA!),
      });
    }

    const dados = assinatura.toJSON();
    const p256dh = paraBase64Url(assinatura.getKey("p256dh"));
    const auth = paraBase64Url(assinatura.getKey("auth"));
    if (!dados.endpoint || !p256dh || !auth) return;

    // Regrava sempre: o endpoint é a chave, então reenviar é barato e mantém o
    // `last_used_at` como sinal de aparelho vivo.
    await (supabase.from("push_subscriptions" as any) as any).upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        endpoint: dados.endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent.slice(0, 300),
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );
  } catch (err) {
    console.warn("[push] não foi possível inscrever este aparelho", err);
  }
}

/** Usado ao sair: o aparelho não deve continuar recebendo aviso de quem saiu. */
export async function cancelarInscricaoDoAparelho() {
  if (!webPushDisponivel()) return;
  try {
    const registro = await navigator.serviceWorker.ready;
    const assinatura = await registro.pushManager.getSubscription();
    if (!assinatura) return;
    const endpoint = assinatura.endpoint;
    await assinatura.unsubscribe();
    await (supabase.from("push_subscriptions" as any) as any).delete().eq("endpoint", endpoint);
  } catch (err) {
    console.warn("[push] não foi possível cancelar a inscrição", err);
  }
}
