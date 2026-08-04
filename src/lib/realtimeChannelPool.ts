import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type StatusListener = (status: string) => void;
type PoolEntry = { channel: RealtimeChannel; refCount: number; listeners: Set<StatusListener> };
const pool = new Map<string, PoolEntry>();

/**
 * Channel Realtime compartilhado com contagem de referencias.
 * Varios componentes podem assinar o MESMO topic; o channel fisico e criado
 * uma unica vez (primeiro assinante) e removido apenas quando o ultimo sai.
 * Evita estourar o limite de 100 channels/conexao e evita que o unmount de
 * um componente derrube a subscription dos demais.
 *
 * O `onStatus` vale para TODOS os assinantes, nao so o primeiro. Antes o
 * callback ia direto no `channel.subscribe()`, que roda uma unica vez — entao o
 * segundo componente a montar o mesmo topic nunca ficava sabendo de
 * CHANNEL_ERROR/TIMED_OUT e perdia a chance de se recuperar em silencio. Como
 * `postgres_changes` NAO tem replay, o que passa durante uma queda nao chega
 * nunca; quem nao escuta o status nao tem como buscar o intervalo perdido.
 *
 * @param topic     Nome estavel do channel (ex.: `att-rt-${tenantId}`).
 * @param configure Roda UMA vez no primeiro assinante para registrar os .on().
 * @param onStatus  Recebe os status do channel. Precisa ser referencia estavel
 *                  dentro do efeito (o cleanup remove por identidade).
 * @returns         Funcao de cleanup — chamar no unmount.
 */
export function subscribeSharedChannel(
  topic: string,
  configure: (channel: RealtimeChannel) => void,
  onStatus?: StatusListener
): () => void {
  let entry = pool.get(topic);
  if (!entry) {
    const channel = supabase.channel(topic);
    const listeners = new Set<StatusListener>();
    configure(channel);
    channel.subscribe(((status: string) => {
      // Copia antes de iterar: um listener pode se remover durante o despacho.
      for (const listener of [...listeners]) {
        try {
          listener(status);
        } catch (err) {
          console.error(`[realtime] listener de status falhou em ${topic}`, err);
        }
      }
    }) as any);
    entry = { channel, refCount: 0, listeners };
    pool.set(topic, entry);
  }
  entry.refCount += 1;
  if (onStatus) entry.listeners.add(onStatus);

  let released = false;
  return () => {
    if (released) return; // guarda contra double-cleanup (StrictMode)
    released = true;
    const e = pool.get(topic);
    if (!e) return;
    if (onStatus) e.listeners.delete(onStatus);
    e.refCount -= 1;
    if (e.refCount <= 0) {
      supabase.removeChannel(e.channel);
      pool.delete(topic);
    }
  };
}
