import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

// Purga de mídia do chat — apaga do bucket `whatsapp-media` o que passou do prazo
// de retenção do setor. Chamada pelo pg_cron uma vez por dia, fora do pico.
//
// Só alcança linha de `whatsapp_messages` com media_kind em document/video/image.
// Quem decide é a fn_chat_media_purge_lote, no banco — esta function não sabe
// nada sobre prazo, setor ou tipo, e NÃO varre o bucket. Varrer o Storage
// apagaria junto os anexos de nota interna (whatsapp_conversation_notes), que
// moram no mesmo bucket.
//
// Áudio nunca entra. Anexo de ticket e de contrato estão em outros buckets.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Arquivos por chamada do lote. `storage.remove()` aceita lista, e 200 mantém o
// payload pequeno o bastante para não estourar memória do isolate.
const BATCH_SIZE = 200;
// Teto por execução: 25 × 200 = 5.000 arquivos. O backlog inicial (~27 mil se
// todos os setores forem ligados de uma vez) é consumido em algumas noites, em
// vez de uma execução longa que arrisca bater o limite de tempo da function.
const MAX_BATCHES = 25;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron manda {} ou nada */ }

  const batchSize  = Math.min(Number(body.batch_size) || BATCH_SIZE, 500);
  const maxBatches = Math.min(Number(body.max_batches) || MAX_BATCHES, 100);
  // dry_run mostra o que SERIA apagado sem tocar no Storage nem no banco.
  // É como se confere o primeiro lote de um setor antes de ligar a purga nele.
  const dryRun = body.dry_run === true;

  let runId: string | null = null;
  if (!dryRun) {
    const { data: run } = await supabase
      .from('chat_media_purge_runs')
      .insert({ started_at: new Date().toISOString() })
      .select('id').maybeSingle();
    runId = run?.id ?? null;
  }

  let arquivos = 0;
  let bytes = 0;
  let erros = 0;
  const detalhes: string[] = [];
  const amostra: unknown[] = [];

  try {
    for (let i = 0; i < maxBatches; i++) {
      const { data: lote, error: loteError } = await supabase
        .rpc('fn_chat_media_purge_lote', { p_limit: batchSize });

      if (loteError) {
        erros++;
        detalhes.push(`lote: ${loteError.message}`);
        break;
      }
      if (!lote || lote.length === 0) break;

      if (dryRun) {
        arquivos += lote.length;
        bytes += lote.reduce((s: number, r: any) => s + (r.media_size_bytes || 0), 0);
        if (amostra.length < 20) amostra.push(...lote.slice(0, 20 - amostra.length));
        // Sem confirmar, o mesmo lote voltaria para sempre — uma passada basta.
        break;
      }

      const paths = lote.map((r: any) => r.media_path).filter(Boolean);
      const { error: rmError } = await supabase.storage.from('whatsapp-media').remove(paths);

      if (rmError) {
        // Erro do Storage inteiro (rede, permissão): não confirma nada e para.
        // Confirmar sem ter apagado marcaria a mensagem como purgada com o
        // arquivo ainda ocupando espaço — o pior dos dois mundos.
        erros++;
        detalhes.push(`storage.remove: ${rmError.message}`);
        break;
      }

      // Confirma o lote INTEIRO, e não só o que o Storage devolveu como removido.
      // Objeto que já não existia volta do remove() sem constar na lista, e ele
      // também precisa sair do candidato: senão as mesmas linhas reaparecem no
      // topo do ORDER BY todo dia, ocupam o lote e a purga nunca avança.
      const ids = lote.map((r: any) => r.message_id);
      const { data: conf, error: confError } = await supabase
        .rpc('fn_chat_media_purge_confirmar', { p_ids: ids });

      if (confError) {
        erros++;
        detalhes.push(`confirmar: ${confError.message}`);
        break;
      }

      const linha = Array.isArray(conf) ? conf[0] : conf;
      arquivos += linha?.arquivos ?? 0;
      bytes += Number(linha?.bytes ?? 0);

      // Lote incompleto = acabaram os candidatos.
      if (lote.length < batchSize) break;
    }
  } catch (err) {
    erros++;
    detalhes.push(`exceção: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (runId) {
    await supabase.from('chat_media_purge_runs').update({
      finished_at: new Date().toISOString(),
      arquivos, bytes, erros,
      detalhe: detalhes.length ? detalhes.join(' | ') : null,
    }).eq('id', runId);
  }

  console.log(`[purge-chat-media] dry_run=${dryRun} arquivos=${arquivos} bytes=${bytes} erros=${erros}`);

  return new Response(JSON.stringify({
    dry_run: dryRun, arquivos, bytes,
    bytes_label: formatBytes(bytes),
    erros, detalhe: detalhes, amostra: dryRun ? amostra : undefined,
  }), {
    status: erros > 0 ? 500 : 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
