import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type PoolEntry = { channel: RealtimeChannel; refCount: number };
const pool = new Map<string, PoolEntry>();

/**
 * Channel Realtime compartilhado com contagem de referencias.
 * Varios componentes podem assinar o MESMO topic; o channel fisico e criado
 * uma unica vez (primeiro assinante) e removido apenas quando o ultimo sai.
 * Evita estourar o limite de 100 channels/conexao e evita que o unmount de
 * um componente derrube a subscription dos demais.
 *
 * @param topic     Nome estavel do channel (ex.: `att-rt-${tenantId}`).
 * @param configure Roda UMA vez no primeiro assinante para registrar os .on().
 * @returns         Funcao de cleanup — chamar no unmount.
 */
export function subscribeSharedChannel(
  topic: string,
  configure: (channel: RealtimeChannel) => void,
  onStatus?: (status: string) => void
): () => void {
  let entry = pool.get(topic);
  if (!entry) {
    const channel = supabase.channel(topic);
    configure(channel);
    channel.subscribe(onStatus as any);
    entry = { channel, refCount: 0 };
    pool.set(topic, entry);
  }
  entry.refCount += 1;

  let released = false;
  return () => {
    if (released) return; // guarda contra double-cleanup (StrictMode)
    released = true;
    const e = pool.get(topic);
    if (!e) return;
    e.refCount -= 1;
    if (e.refCount <= 0) {
      supabase.removeChannel(e.channel);
      pool.delete(topic);
    }
  };
}
