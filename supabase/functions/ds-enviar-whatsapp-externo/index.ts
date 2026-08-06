// ds-enviar-whatsapp-externo — envia UMA mensagem de texto por WhatsApp a pedido
// de um sistema parceiro (hoje: DoctorDev / devflow-hub).
//
// Autenticação: HMAC-SHA256 sobre o payload inteiro, com o segredo compartilhado
// DEVFLOW_WA_SECRET. Mesmo padrão do SSO que já existe entre os dois projetos —
// por isso `verify_jwt = false` no config.toml: quem chama não tem JWT daqui.
//
// A mensagem viaja DENTRO do payload assinado: sem a assinatura correta não dá
// para trocar o texto nem o destinatário.
//
// NÃO respeita quiet hours de propósito: isto é disparado por um humano que
// clicou "enviar", igual a um operador respondendo no chat — não é notificação
// automática. Se um dia virar automático, tem que passar por is_wa_quiet_hours().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';
import { normalizeBRPhone } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Tenant ASP (definido em supabase/migrations/20260225173128_…sql).
const TENANT_ASP_PADRAO = 'a0000000-0000-0000-0000-000000000001';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function assinaturaConfere(
  payloadB64: string,
  assinatura: string,
  segredo: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  const esperada = btoa(String.fromCharCode(...new Uint8Array(sig)));
  // Comparação de tempo constante
  if (esperada.length !== assinatura.length) return false;
  let diff = 0;
  for (let i = 0; i < esperada.length; i++) {
    diff |= esperada.charCodeAt(i) ^ assinatura.charCodeAt(i);
  }
  return diff === 0;
}

// Preferência pela instância "Financeiro" (mesmo critério do onboarding-send-welcome).
async function escolherInstancia(supabase: any, tenantId: string) {
  const { data: rows } = await supabase
    .from('whatsapp_instances')
    .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id, ativo')
    .eq('tenant_id', tenantId)
    .eq('ativo', true);
  if (!rows || rows.length === 0) return null;
  const financeiro = rows.find((r: any) =>
    (r.instance_name || '').toLowerCase().includes('financeiro'),
  );
  return financeiro ?? rows[0];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    const segredo = Deno.env.get('DEVFLOW_WA_SECRET');
    if (!segredo) {
      console.error('[ds-enviar-whatsapp-externo] DEVFLOW_WA_SECRET ausente');
      return json({ ok: false, error: 'secret_nao_configurado' }, 500);
    }

    const body = await req.json().catch(() => null);
    const token: string | undefined = body?.token;
    if (!token || typeof token !== 'string') {
      return json({ ok: false, error: 'token_ausente' }, 400);
    }

    const [payloadB64, assinatura] = token.split('.');
    if (!payloadB64 || !assinatura) return json({ ok: false, error: 'token_malformado' }, 400);

    if (!(await assinaturaConfere(payloadB64, assinatura, segredo))) {
      return json({ ok: false, error: 'assinatura_invalida' }, 401);
    }

    let payload: any;
    try {
      payload = JSON.parse(base64ToUtf8(payloadB64));
    } catch {
      return json({ ok: false, error: 'payload_invalido' }, 400);
    }

    const agora = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < agora) {
      return json({ ok: false, error: 'token_expirado' }, 401);
    }

    const mensagem: string = typeof payload.mensagem === 'string' ? payload.mensagem.trim() : '';
    const telefoneBruto: string = String(payload.telefone ?? '');
    if (!mensagem) return json({ ok: false, error: 'mensagem_vazia' }, 400);
    if (!telefoneBruto) return json({ ok: false, error: 'telefone_ausente' }, 400);

    const normalizado = normalizeBRPhone(telefoneBruto);
    if (!normalizado.phone) return json({ ok: false, error: 'telefone_invalido' }, 422);
    if (normalizado.isGroup) return json({ ok: false, error: 'destino_e_grupo' }, 422);
    // 55 + DDD + 8/9 dígitos. Fora disso é LID, grupo (120363…) ou lixo — não é telefone.
    if (
      !normalizado.phone.startsWith('55') ||
      normalizado.phone.length < 12 ||
      normalizado.phone.length > 13
    ) {
      return json({ ok: false, error: 'telefone_fora_do_padrao_br' }, 422);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const tenantId = Deno.env.get('DEVFLOW_WA_TENANT_ID') || TENANT_ASP_PADRAO;
    const instancia = await escolherInstancia(supabase, tenantId);
    if (!instancia) return json({ ok: false, error: 'nenhuma_instancia_ativa' }, 422);

    const secrets = await getInstanceSecrets(supabase, instancia.id);
    const adapter = getAdapter(instancia.provider_type || 'self_hosted');

    const resultado = await adapter.send(secrets, instancia, {
      to: normalizado.phone,
      messageType: 'text',
      content: mensagem,
    });

    const messageId = (resultado as any)?.messageId ?? null;
    console.log('[ds-enviar-whatsapp-externo] enviado', {
      origem: payload.origem ?? null,
      referencia: payload.referencia ?? null,
      instancia: instancia.instance_name,
      messageId,
    });

    return json({ ok: true, messageId, instancia: instancia.instance_name });
  } catch (e: any) {
    console.error('[ds-enviar-whatsapp-externo] fatal:', e);
    return json({ ok: false, error: 'internal_error', detail: e?.message }, 500);
  }
});
