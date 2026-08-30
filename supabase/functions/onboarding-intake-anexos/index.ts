// onboarding-intake-anexos — baixa os anexos que vieram na proposta e guarda no
// ticket de onboarding.
//
// Chamada pela onboarding-intake-webhook DEPOIS da venda estar criada, e de
// proposito fora da transacao: anexo que falha nao pode derrubar um contrato.
// A venda existe; o anexo e complemento.
//
// Upload client-side nunca funcionou neste projeto — todo upload passa por edge
// function com service_role. Segue o mesmo bucket e o mesmo formato de caminho da
// upload-ticket-attachment, senao a tela de Anexos do ticket nao acha o arquivo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_ARQUIVOS = 10;
const MAX_BYTES = 25 * 1024 * 1024;   // 25 MB
const TIMEOUT_MS = 30_000;

const nomeSeguro = (n: string) =>
  n.normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const esperado = Deno.env.get('ONBOARDING_INTAKE_SECRET');
  if (!esperado || (req.headers.get('x-webhook-secret') || '') !== esperado) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
  const logId = body?.intake_log_id;
  if (!logId) return json({ ok: false, error: 'intake_log_id_required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: log } = await supabase
    .from('onboarding_intake_log')
    .select('id, tenant_id, journey_id, payload')
    .eq('id', logId).maybeSingle();
  if (!log?.journey_id) return json({ ok: false, error: 'log_sem_jornada' }, 404);

  const anexos: any[] = Array.isArray(log.payload?.anexos) ? log.payload.anexos : [];
  if (anexos.length === 0) return json({ ok: true, baixados: 0, falhos: [] });

  const { data: jornada } = await supabase
    .from('onboarding_journeys')
    .select('ticket_id, responsavel_user_id')
    .eq('id', log.journey_id).maybeSingle();
  if (!jornada?.ticket_id) return json({ ok: false, error: 'jornada_sem_ticket' }, 404);

  // uploaded_by e NOT NULL e nao existe usuario num import. Atribui ao responsavel
  // da jornada; sem ele, a um admin do tenant. Sem nenhum dos dois nao da para gravar.
  let autor = jornada.responsavel_user_id as string | null;
  if (!autor) {
    const { data: adm } = await supabase
      .from('profiles').select('user_id')
      .eq('tenant_id', log.tenant_id).eq('role', 'admin').limit(1).maybeSingle();
    autor = adm?.user_id ?? null;
  }
  if (!autor) return json({ ok: false, error: 'sem_usuario_para_atribuir' }, 409);

  const falhos: any[] = [];
  let baixados = 0;

  for (const a of anexos.slice(0, MAX_ARQUIVOS)) {
    const nome = a?.nome_arquivo ?? a?.nome ?? 'anexo';
    const url = a?.url;
    if (!url) { falhos.push({ nome, motivo: 'sem_url' }); continue; }

    // O tamanho declarado evita baixar um arquivo que ja se sabe grande demais.
    if (a?.tamanho_bytes && Number(a.tamanho_bytes) > MAX_BYTES) {
      falhos.push({ nome, motivo: 'excede_25mb', tamanho_bytes: a.tamanho_bytes, url });
      continue;
    }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) { falhos.push({ nome, motivo: `http_${res.status}`, url }); continue; }

      const bytes = new Uint8Array(await res.arrayBuffer());
      // O tamanho declarado pode mentir; o real e o que vale.
      if (bytes.byteLength > MAX_BYTES) {
        falhos.push({ nome, motivo: 'excede_25mb', tamanho_bytes: bytes.byteLength, url });
        continue;
      }

      const tipo = a?.content_type ?? a?.tipo ?? res.headers.get('content-type') ?? 'application/octet-stream';
      const path = `${log.tenant_id}/${jornada.ticket_id}/${Date.now()}_${nomeSeguro(nome)}`;

      const { error: upErr } = await supabase.storage
        .from('ticket-attachments').upload(path, bytes, { contentType: tipo, upsert: false });
      if (upErr) { falhos.push({ nome, motivo: 'upload: ' + upErr.message, url }); continue; }

      const { error: insErr } = await supabase.from('support_ticket_attachments').insert({
        tenant_id: log.tenant_id,
        ticket_id: jornada.ticket_id,
        file_name: nome,
        file_path: path,
        file_size: bytes.byteLength,
        file_type: tipo,
        uploaded_by: autor,
        title: a?.campo_label ?? null,
      });
      if (insErr) {
        // Arquivo sem registro e lixo invisivel no bucket.
        await supabase.storage.from('ticket-attachments').remove([path]);
        falhos.push({ nome, motivo: 'registro: ' + insErr.message, url });
        continue;
      }
      baixados++;
    } catch (e: any) {
      const motivo = e?.name === 'AbortError' ? 'timeout_30s' : (e?.message ?? 'erro');
      falhos.push({ nome, motivo, url });
    }
  }

  if (anexos.length > MAX_ARQUIVOS) {
    for (const a of anexos.slice(MAX_ARQUIVOS)) {
      falhos.push({ nome: a?.nome_arquivo ?? a?.nome ?? 'anexo', motivo: 'acima_de_10_arquivos', url: a?.url });
    }
  }

  if (falhos.length > 0) {
    const { data: atual } = await supabase
      .from('onboarding_intake_log').select('avisos').eq('id', log.id).maybeSingle();
    const anteriores = Array.isArray(atual?.avisos) ? atual!.avisos : [];
    await supabase.from('onboarding_intake_log')
      .update({ avisos: [...anteriores, { campo: 'anexos', aviso: 'anexos_nao_baixados', detalhe: falhos }] })
      .eq('id', log.id);
  }

  console.log('[intake-anexos]', log.id, 'baixados:', baixados, 'falhos:', falhos.length);
  return json({ ok: true, baixados, falhos });
});
