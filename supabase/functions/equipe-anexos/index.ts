// Equipe DS (chat interno): upload e leitura de arquivos das conversas.
//
// Upload direto do navegador para o Storage não funciona neste projeto: tudo
// passa por aqui, com service_role, DEPOIS de conferir que a pessoa participa
// da conversa (a mesma regra da RLS: fn_equipe_pode_ver, chamada com o JWT dela).
//
//   { acao: "enviar", canalId, arquivos: [{ nome, mime, tamanho }] }
//      -> { arquivos: [{ path, token }] }   (o navegador sobe com uploadToSignedUrl)
//   { acao: "ler", paths: ["<tenant>/<canal>/<uuid>.<ext>", ...] }
//      -> { urls: { [path]: url } }          (link assinado de 1 hora)
//
// "ler" só entrega arquivo que está numa mensagem NÃO apagada da conversa. Quem
// apaga a mensagem corta o acesso ao arquivo na hora, mesmo para quem guardou o
// caminho.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'equipe-anexos';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ARQUIVOS = 10;
const MAX_LEITURA = 60;
const VALIDADE_SEG = 3600;

// executável e script não entram: é chat de trabalho, não pendrive
// html/svg/xml também: o link assinado abriria a página renderizada no domínio do Storage
const EXT_BLOQUEADA = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'mjs', 'jar', 'sh', 'apk', 'dll', 'reg', 'lnk', 'hta',
  'html', 'htm', 'xhtml', 'svg', 'svgz', 'xml', 'mht', 'mhtml']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function extDe(nome: string): string {
  const e = nome.includes('.') ? nome.split('.').pop()!.toLowerCase() : '';
  return /^[a-z0-9]{1,5}$/.test(e) ? e : 'bin';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Não autenticado' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // cliente com o JWT da pessoa: as checagens de acesso rodam como ELA
    const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await comoUsuario.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return json({ error: 'Não autenticado' }, 401);

    const body = await req.json().catch(() => null);
    const acao = body?.acao;

    const podeVer = async (canalId: string) => {
      const { data, error } = await comoUsuario.rpc('fn_equipe_pode_ver', { p_canal_id: canalId });
      return !error && data === true;
    };

    // ------------------------------------------------------------ enviar
    if (acao === 'enviar') {
      const canalId = String(body?.canalId ?? '');
      const arquivos = Array.isArray(body?.arquivos) ? body.arquivos : [];
      if (!UUID.test(canalId)) return json({ error: 'Conversa inválida' }, 400);
      if (arquivos.length === 0 || arquivos.length > MAX_ARQUIVOS) return json({ error: `Envie de 1 a ${MAX_ARQUIVOS} arquivos por vez` }, 400);

      const { data: canal } = await admin.from('equipe_canais').select('tenant_id, arquivado_em').eq('id', canalId).maybeSingle();
      if (!canal || !(await podeVer(canalId))) return json({ error: 'Você não participa desta conversa' }, 403);
      if (canal.arquivado_em) return json({ error: 'Canal arquivado não recebe arquivos' }, 400);

      const saida: { path: string; token: string }[] = [];
      for (const a of arquivos) {
        const nome = String(a?.nome ?? '').slice(0, 200);
        const tamanho = Number(a?.tamanho ?? -1);
        const ext = extDe(nome);
        if (!nome) return json({ error: 'Arquivo sem nome' }, 400);
        if (!(tamanho >= 0 && tamanho <= MAX_BYTES)) return json({ error: `${nome}: o limite é 25 MB por arquivo` }, 400);
        if (EXT_BLOQUEADA.has(ext)) return json({ error: `${nome}: esse tipo de arquivo não é aceito` }, 400);

        const path = `${canal.tenant_id}/${canalId}/${crypto.randomUUID()}.${ext}`;
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error || !data) {
          console.error('[equipe-anexos] createSignedUploadUrl', error);
          return json({ error: 'Não foi possível preparar o envio. Tente de novo.' }, 500);
        }
        // registro do upload: sem ele o banco recusa o anexo, e com ele o mesmo
        // arquivo não pode ir em duas mensagens (nem voltar depois de apagado)
        const { error: regErr } = await admin.from('equipe_uploads').insert({ path, tenant_id: canal.tenant_id, canal_id: canalId, user_id: user.id });
        if (regErr) {
          console.error('[equipe-anexos] registro do upload', regErr);
          return json({ error: 'Não foi possível preparar o envio. Tente de novo.' }, 500);
        }
        saida.push({ path: data.path, token: data.token });
      }
      return json({ arquivos: saida });
    }

    // -------------------------------------------------------------- ler
    if (acao === 'ler') {
      const paths: string[] = Array.isArray(body?.paths) ? [...new Set(body.paths.map(String))].slice(0, MAX_LEITURA) as string[] : [];
      const porCanal = new Map<string, string[]>();
      for (const p of paths) {
        const m = PATH.exec(p);
        if (!m) continue;
        porCanal.set(m[2], [...(porCanal.get(m[2]) ?? []), p]);
      }

      const liberados: string[] = [];
      for (const [canalId, lista] of porCanal) {
        if (!(await podeVer(canalId))) continue;
        // o arquivo tem de estar numa mensagem viva desta conversa
        const { data: vivos, error } = await admin.rpc('fn_equipe_anexos_vivos', { p_canal_id: canalId, p_paths: lista });
        if (error) console.error('[equipe-anexos] fn_equipe_anexos_vivos', error);
        liberados.push(...((vivos ?? []) as string[]));
      }

      const urls: Record<string, string> = {};
      if (liberados.length > 0) {
        const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(liberados, VALIDADE_SEG);
        if (error) {
          console.error('[equipe-anexos] createSignedUrls', error);
          return json({ error: 'Não foi possível abrir os arquivos' }, 500);
        }
        // Devolve só caminho + token: a tela completa com o endereço do Supabase
        // que ela já usa. No local o SUPABASE_URL daqui é "http://kong:8000",
        // que o navegador não resolve.
        for (const d of data ?? []) {
          if (!d.path || !d.signedUrl) continue;
          const u = new URL(d.signedUrl);
          urls[d.path] = u.pathname + u.search;
        }
      }
      return json({ urls });
    }

    return json({ error: 'Ação desconhecida' }, 400);
  } catch (e) {
    console.error('[equipe-anexos] inesperado', e);
    return json({ error: 'Erro interno' }, 500);
  }
});
