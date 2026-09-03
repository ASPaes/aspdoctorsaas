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

// ---------------------------------------------------------------- contrato
//
// O anexo do contrato tem destino proprio: a tabela contrato_anexos, 1 por
// contrato, no bucket contrato-anexos — nao e a aba de Anexos do ticket. E o
// campo "Anexo do contrato" da tela do produto.
//
// O rotulo e um acordo com o sistema de propostas: campo_label exatamente
// "Contrato assinado" (comparado sem acento, sem caixa e sem espaco nas bordas).
// Qualquer outro rotulo continua indo para o ticket, como sempre foi.
const ROTULO_CONTRATO = 'contrato assinado';

// Limites do destino, mais estreitos que os do anexo de ticket. Sao os mesmos
// que a tela usa (ContratoAnexoSection): errar aqui grava linha que a tela nao
// consegue abrir.
const CONTRATO_MAX_BYTES = 10 * 1024 * 1024;
const CONTRATO_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']);
const NOME_OMIE_REGEX = /^[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{1,10}$/;

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const ehRotuloContrato = (label: unknown) =>
  typeof label === 'string' && semAcento(label).trim().toLowerCase() === ROTULO_CONTRATO;

// Porte fiel do normalizeNomeOmie do frontend. A coluna nome_omie e NOT NULL e
// tem formato fechado; nome que nao normaliza nao pode entrar.
function nomeNormalizado(nomeOriginal: string): string | null {
  const i = nomeOriginal.lastIndexOf('.');
  if (i <= 0) return null;
  const ext = semAcento(nomeOriginal.slice(i + 1))
    .replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10);
  const base = semAcento(nomeOriginal.slice(0, i))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 80);
  if (!base || !ext) return null;
  const nome = `${base}.${ext}`;
  return NOME_OMIE_REGEX.test(nome) ? nome : null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
    .select('id, tenant_id, journey_id, payload, contrato_id, modo')
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
  // Anexo que era o contrato e acabou no ticket, com o motivo. Nao e falha —
  // o arquivo nao se perdeu — mas alguem precisa saber que o campo "Anexo do
  // contrato" continua vazio.
  const desviados: any[] = [];
  let baixados = 0;
  let contrato_anexo_id: string | null = null;

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

      // ------------------------------------------------------------ contrato
      // Rotulo "Contrato assinado" tem destino proprio. Se QUALQUER condicao
      // nao bater, o arquivo nao se perde: cai para o ticket, com o motivo
      // registrado no log.
      if (ehRotuloContrato(a?.campo_label)) {
        let motivo: string | null = null;
        const nomeOmie = nomeNormalizado(nome);

        // A RPC SUBSTITUI o anexo ativo do contrato. Num up-sell isso trocaria
        // o contrato assinado da venda original pelo aditivo — so a venda nova
        // traz contrato proprio.
        if (log.modo !== 'venda_nova') {
          motivo = 'so_venda_nova: aqui o arquivo substituiria o anexo do contrato que o cliente ja tem';
        } else if (!log.contrato_id) {
          motivo = 'sem_contrato: esta venda nao criou contrato';
        } else if (!CONTRATO_MIMES.has(tipo)) {
          motivo = `formato_nao_aceito: ${tipo}. O anexo do contrato aceita PDF, JPG ou PNG`;
        } else if (bytes.byteLength > CONTRATO_MAX_BYTES) {
          motivo = `excede_10mb: ${bytes.byteLength} bytes. O anexo do contrato aceita ate 10 MB`;
        } else if (!nomeOmie) {
          motivo = 'nome_nao_suportado: o nome do arquivo nao normaliza para o formato que a coluna aceita';
        }

        if (!motivo) {
          const ext = nomeOmie!.slice(nomeOmie!.lastIndexOf('.') + 1);
          const cpath = `${log.tenant_id}/${log.contrato_id}/${crypto.randomUUID()}.${ext}`;
          const { error: cUp } = await supabase.storage
            .from('contrato-anexos').upload(cpath, bytes, { contentType: tipo, upsert: false });
          if (cUp) {
            motivo = 'upload: ' + cUp.message;
          } else {
            // A MESMA RPC da tela. Ela baixa o anexo ativo anterior, grava o
            // novo e devolve o id; hash igual devolve o id que ja existia,
            // entao reenviar a proposta nao duplica nem troca o arquivo.
            const { data: anexoId, error: cRpc } = await supabase.rpc('contrato_anexo_substituir', {
              p_contrato_id: log.contrato_id,
              p_storage_path: cpath,
              p_nome_original: nome,
              p_nome_omie: nomeOmie,
              p_mime_type: tipo,
              p_tamanho_bytes: bytes.byteLength,
              p_hash_sha256: await sha256Hex(bytes),
            });
            if (cRpc) {
              // Arquivo sem registro e lixo invisivel no bucket.
              await supabase.storage.from('contrato-anexos').remove([cpath]);
              motivo = 'registro: ' + cRpc.message;
            } else {
              contrato_anexo_id = (anexoId as string) ?? null;
              baixados++;
              continue;   // foi para o contrato; nao vai tambem para o ticket
            }
          }
        }
        desviados.push({ nome, motivo, campo_label: a?.campo_label });
      }

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

  const novos: any[] = [];
  if (falhos.length > 0) {
    novos.push({ campo: 'anexos', aviso: 'anexos_nao_baixados', detalhe: falhos });
  }
  if (desviados.length > 0) {
    novos.push({
      campo: 'anexos',
      aviso: 'contrato_ficou_no_ticket: o arquivo chegou e esta na aba de Anexos do ticket, mas o campo "Anexo do contrato" do produto continua vazio',
      detalhe: desviados,
    });
  }
  if (novos.length > 0) {
    const { data: atual } = await supabase
      .from('onboarding_intake_log').select('avisos').eq('id', log.id).maybeSingle();
    const anteriores = Array.isArray(atual?.avisos) ? atual!.avisos : [];
    await supabase.from('onboarding_intake_log')
      .update({ avisos: [...anteriores, ...novos] })
      .eq('id', log.id);
  }

  console.log('[intake-anexos]', log.id, 'baixados:', baixados,
              'falhos:', falhos.length, 'contrato:', contrato_anexo_id ?? '-');
  return json({ ok: true, baixados, falhos, desviados, contrato_anexo_id });
});
