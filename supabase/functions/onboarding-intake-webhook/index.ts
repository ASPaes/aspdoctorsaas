// onboarding-intake-webhook — recebe demandas externas de onboarding
// e cria jornada via RPC create_onboarding_journey.
// Autenticação: header x-webhook-secret comparado a ONBOARDING_INTAKE_SECRET (env).
// TODO: mover para secret por tenant (coluna em tenants ou tabela de config).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function onlyDigits(v: any): string {
  return String(v ?? '').replace(/\D/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const expected = Deno.env.get('ONBOARDING_INTAKE_SECRET');
  const received = req.headers.get('x-webhook-secret') || '';
  if (!expected || received !== expected) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const {
    tenant_id,
    cliente_id: cliente_id_in,
    cliente_doc,
    assunto,
    produto_id,
    data_inicio_planejado,
    go_live_previsto,
    implantador_user_id,
    descricao,
  } = body ?? {};

  if (!tenant_id || typeof tenant_id !== 'string') {
    return json({ ok: false, error: 'tenant_id_required' }, 400);
  }
  if (!assunto || typeof assunto !== 'string' || !assunto.trim()) {
    return json({ ok: false, error: 'assunto_required' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // Valida tenant
    const { data: tenant, error: terr } = await supabase
      .from('tenants')
      .select('id')
      .eq('id', tenant_id)
      .maybeSingle();
    if (terr) throw terr;
    if (!tenant) return json({ ok: false, error: 'tenant_not_found' }, 404);

    // Resolve cliente
    let cliente_id: string | null = cliente_id_in ?? null;
    if (!cliente_id && cliente_doc) {
      const doc = onlyDigits(cliente_doc);
      if (doc.length < 11) {
        return json({ ok: false, error: 'cliente_doc_invalido' }, 422);
      }
      const { data: cliente, error: cerr } = await supabase
        .from('clientes')
        .select('id')
        .eq('tenant_id', tenant_id)
        .eq('cnpj', doc)
        .maybeSingle();
      if (cerr) throw cerr;
      if (!cliente) {
        return json({
          ok: false,
          error: 'cliente_nao_encontrado',
          detail: `Nenhum cliente com documento ${doc} no tenant informado. Cadastre o cliente antes de abrir a jornada.`,
        }, 422);
      }
      cliente_id = cliente.id;
    }

    if (!cliente_id) {
      return json({ ok: false, error: 'cliente_id_ou_cliente_doc_required' }, 400);
    }

    // Chama RPC
    const { data: journeyId, error: rerr } = await supabase.rpc('create_onboarding_journey', {
      p_tenant_id: tenant_id,
      p_cliente_id: cliente_id,
      p_assunto: assunto.trim(),
      p_produto_id: produto_id ?? null,
      p_data_inicio_planejado: data_inicio_planejado ?? null,
      p_go_live_previsto: go_live_previsto ?? null,
      p_implantador_user_id: implantador_user_id ?? null,
      p_descricao: descricao ?? null,
    });

    if (rerr) {
      console.error('[onboarding-intake-webhook] RPC error:', rerr);
      return json({ ok: false, error: 'create_journey_failed', detail: rerr.message }, 500);
    }

    console.log('[onboarding-intake-webhook] created journey:', journeyId);
    return json({ ok: true, journey_id: journeyId });
  } catch (e: any) {
    console.error('[onboarding-intake-webhook] fatal:', e);
    return json({ ok: false, error: 'internal_error', detail: e?.message }, 500);
  }
});
