// onboarding-catalogo — devolve os catálogos de um tenant para o sistema comercial
// externo montar os selects do vendedor.
//
// Só leitura. Nunca escreve.
//
// Existe porque o sistema de propostas precisa mandar ID, não texto: dos 3 itens do
// resumo de implantação da Digi Office, NENHUM casa por nome com produto_modulos
// ("Essencial (Cloud + 1 PDV)" são dois módulos separados aqui; "Servidor Nuvem"
// chama-se "Servidor Legal"). Casar por texto acertaria 0 de 3.
//
// Autenticação: x-webhook-secret comparado a ONBOARDING_INTAKE_SECRET — o MESMO
// segredo da onboarding-intake-webhook, de propósito: é o mesmo parceiro.
// verify_jwt=false declarado no config.toml; quem chama é servidor de terceiro,
// sem sessão do projeto.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// PostgREST corta em 1000 linhas e o .limit() do client não sobrescreve isso.
// Hoje o maior catálogo tem ~205 linhas e caberia numa página — pagina desde já
// para o bug não aparecer quando o cadastro crescer.
const PAGE = 1000;
const MAX_PAGES = 20;

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  console.warn('[onboarding-catalogo] MAX_PAGES atingido, resultado pode estar truncado');
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const expected = Deno.env.get('ONBOARDING_INTAKE_SECRET');
  const received = req.headers.get('x-webhook-secret') || '';
  if (!expected || received !== expected) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const tenantId = new URL(req.url).searchParams.get('tenant_id');
  if (!tenantId) return json({ ok: false, error: 'tenant_id_required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { data: tenant, error: terr } = await supabase
      .from('tenants').select('id').eq('id', tenantId).maybeSingle();
    if (terr) throw terr;
    if (!tenant) return json({ ok: false, error: 'tenant_not_found' }, 404);

    const t = (table: string, cols: string) =>
      (from: number, to: number) =>
        supabase.from(table).select(cols).eq('tenant_id', tenantId).order('nome').range(from, to);

    const tAtivo = (table: string, cols: string, flag: string) =>
      (from: number, to: number) =>
        supabase.from(table).select(cols).eq('tenant_id', tenantId).eq(flag, true).order('nome').range(from, to);

    const [
      produtos, modulos, segmentos, origens_venda,
      formas_pagamento, vendedores, unidades_base, demand_types,
    ] = await Promise.all([
      fetchAll(t('produtos', 'id, nome')),
      // produto_id junto: o módulo só vale dentro do produto a que pertence.
      fetchAll(tAtivo('produto_modulos', 'id, nome, produto_id', 'ativo')),
      fetchAll(t('segmentos', 'id, nome')),
      fetchAll(t('origens_venda', 'id, nome')),
      fetchAll(t('formas_pagamento', 'id, nome')),
      fetchAll(tAtivo('funcionarios', 'id, nome', 'ativo')),
      // unidades_base usa is_active, não ativo. Errar a coluna devolve lista vazia
      // sem erro, e o vendedor fica sem select.
      fetchAll(tAtivo('unidades_base', 'id, nome', 'is_active')),
      fetchAll(tAtivo('onboarding_demand_types', 'id, nome', 'ativo')),
    ]);

    return json({
      ok: true,
      tenant_id: tenantId,
      gerado_em: new Date().toISOString(),
      produtos,
      modulos,
      segmentos,
      origens_venda,
      formas_pagamento,
      vendedores,
      unidades_base,
      demand_types,
    });
  } catch (e: any) {
    console.error('[onboarding-catalogo] fatal:', e);
    return json({ ok: false, error: 'internal_error', detail: e?.message }, 500);
  }
});
