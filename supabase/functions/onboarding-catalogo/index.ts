// onboarding-catalogo — devolve os catálogos de um tenant para o sistema comercial
// externo montar os selects do vendedor.
//
// 03/09/2026: entraram areas_atuacao, fornecedores, modelos_contrato e a lista
// de recorrencias. Eram os quatro selects que faltavam para o cadastro do
// cliente e do contrato chegar completo pela integração.
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

// Espelha o enum recorrencia_tipo (mensal, anual, semestral, semanal). Ver o
// comentário na resposta: quem valida de verdade é a fn_intake_proposta.
const RECORRENCIAS = [
  { valor: 'mensal',    nome: 'Mensal' },
  { valor: 'anual',     nome: 'Anual' },
  { valor: 'semestral', nome: 'Semestral' },
  { valor: 'semanal',   nome: 'Semanal' },
];

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
      areas_atuacao, fornecedores, modelos_contrato,
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
      // Os três abaixo entraram em 03/09/2026. Sem eles o sistema de propostas
      // não tinha ID para mandar em area_atuacao_id, fornecedor_id e
      // modelo_contrato_id — e nome no lugar do ID é recusado pela
      // fn_intake_proposta. Nenhuma das três tem coluna de ativo/inativo.
      fetchAll(t('areas_atuacao', 'id, nome')),
      fetchAll(t('fornecedores', 'id, nome')),
      fetchAll(t('modelos_contrato', 'id, nome')),
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
      areas_atuacao,
      fornecedores,
      modelos_contrato,
      // recorrencia NÃO é cadastro: é o enum recorrencia_tipo do Postgres, e
      // pg_catalog não é exposto pelo PostgREST. Vai como lista fixa, e a
      // fn_intake_proposta valida contra o enum de verdade — se um valor novo
      // for criado no banco, o pior que acontece é ele faltar neste select,
      // nunca uma gravação errada.
      // Não tem `id`: o payload manda o próprio texto em produtos[].recorrencia.
      recorrencias: RECORRENCIAS,
    });
  } catch (e: any) {
    console.error('[onboarding-catalogo] fatal:', e);
    return json({ ok: false, error: 'internal_error', detail: e?.message }, 500);
  }
});
