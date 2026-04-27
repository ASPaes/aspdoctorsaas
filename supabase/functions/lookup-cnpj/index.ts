import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCTION_NAME = "cnpj_lookup";
const FETCH_TIMEOUT_MS = 8000;

type NormalizedCnpj = {
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  email: string | null;
  ddd_telefone_1: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  uf: string | null;
  municipio: string | null;
  cep: string | null;
};

async function checkRateLimit(
  supabase: any,
  tenantId: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  try {
    const { data: configs } = await supabase
      .from("ai_rate_limit_config")
      .select("max_calls, window_seconds, tenant_id")
      .eq("function_name", FUNCTION_NAME)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order("tenant_id", { ascending: false, nullsFirst: false })
      .limit(2);

    const config = configs?.[0] ?? { max_calls: 50, window_seconds: 3600 };
    const windowStart = new Date(Date.now() - config.window_seconds * 1000).toISOString();

    const { count } = await supabase
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("function_name", FUNCTION_NAME)
      .gte("called_at", windowStart);

    if ((count ?? 0) >= config.max_calls) {
      return { allowed: false, retryAfterSeconds: config.window_seconds };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

async function logUsage(supabase: any, tenantId: string, source: string) {
  try {
    await supabase.from("ai_usage_log").insert({
      tenant_id: tenantId,
      function_name: FUNCTION_NAME,
      model: "cnpj-lookup",
      provider: source,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
    });
  } catch (err) {
    console.error("[lookup-cnpj] logUsage error:", err);
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function normalizeBrasilApi(d: any): NormalizedCnpj {
  return {
    cnpj: String(d.cnpj ?? "").replace(/\D/g, ""),
    razao_social: d.razao_social ?? null,
    nome_fantasia: d.nome_fantasia ?? null,
    email: d.email ?? null,
    ddd_telefone_1: d.ddd_telefone_1 ?? null,
    logradouro: d.logradouro ?? null,
    numero: d.numero ?? null,
    bairro: d.bairro ?? null,
    uf: d.uf ?? null,
    municipio: d.municipio ?? null,
    cep: d.cep ? String(d.cep).replace(/\D/g, "") : null,
  };
}

function normalizeReceitaWs(d: any): NormalizedCnpj {
  const tel = d.telefone ? String(d.telefone).split("/")[0].trim() : null;
  return {
    cnpj: String(d.cnpj ?? "").replace(/\D/g, ""),
    razao_social: d.nome ?? null,
    nome_fantasia: d.fantasia ?? null,
    email: d.email ?? null,
    ddd_telefone_1: tel,
    logradouro: d.logradouro ?? null,
    numero: d.numero ?? null,
    bairro: d.bairro ?? null,
    uf: d.uf ?? null,
    municipio: d.municipio ?? null,
    cep: d.cep ? String(d.cep).replace(/\D/g, "") : null,
  };
}

async function tryBrasilApi(cnpj: string): Promise<NormalizedCnpj | null> {
  try {
    const res = await fetchWithTimeout(
      `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
      FETCH_TIMEOUT_MS
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(`[lookup-cnpj] BrasilAPI status ${res.status}`);
      throw new Error(`brasilapi_status_${res.status}`);
    }
    const data = await res.json();
    return normalizeBrasilApi(data);
  } catch (err) {
    console.warn("[lookup-cnpj] BrasilAPI failed:", err instanceof Error ? err.message : err);
    throw err;
  }
}

async function tryReceitaWs(cnpj: string): Promise<NormalizedCnpj | null> {
  try {
    const res = await fetchWithTimeout(
      `https://receitaws.com.br/v1/cnpj/${cnpj}`,
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      console.warn(`[lookup-cnpj] ReceitaWS status ${res.status}`);
      throw new Error(`receitaws_status_${res.status}`);
    }
    const data = await res.json();
    if (data.status === "ERROR") {
      if (String(data.message ?? "").toLowerCase().includes("não existe") ||
          String(data.message ?? "").toLowerCase().includes("inválido")) {
        return null;
      }
      throw new Error(`receitaws_error_${data.message}`);
    }
    return normalizeReceitaWs(data);
  } catch (err) {
    console.warn("[lookup-cnpj] ReceitaWS failed:", err instanceof Error ? err.message : err);
    throw err;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const correlationId = crypto.randomUUID();
  const log = (msg: string, extra?: any) =>
    console.log(`[lookup-cnpj][${correlationId}] ${msg}`, extra ?? "");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "unauthorized", message: "Não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ success: false, error: "unauthorized", message: "Sessão inválida" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!profile?.tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: "no_tenant", message: "Tenant não identificado" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const tenantId = profile.tenant_id;

    const body = await req.json().catch(() => ({}));
    const rawCnpj = String(body?.cnpj ?? "");
    const cnpj = rawCnpj.replace(/\D/g, "");
    if (cnpj.length !== 14) {
      return new Response(
        JSON.stringify({ success: false, error: "invalid_cnpj", message: "CNPJ deve ter 14 dígitos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: cached } = await supabase
      .from("cnpj_cache")
      .select("cnpj, payload, source, expires_at")
      .eq("cnpj", cnpj)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached) {
      log("cache hit", { cnpj });
      return new Response(
        JSON.stringify({ success: true, source: "cache", data: cached.payload }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rl = await checkRateLimit(supabase, tenantId);
    if (!rl.allowed) {
      log("rate limited", { tenantId });
      return new Response(
        JSON.stringify({
          success: false,
          error: "rate_limit_exceeded",
          message: `Limite de consultas CNPJ atingido. Tente novamente em ${Math.round((rl.retryAfterSeconds ?? 3600) / 60)} minutos.`,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result: NormalizedCnpj | null = null;
    let usedSource: "brasilapi" | "receitaws" | null = null;
    let lastError: unknown = null;

    try {
      result = await tryBrasilApi(cnpj);
      if (result) {
        usedSource = "brasilapi";
        log("brasilapi success");
      } else {
        log("brasilapi 404 — cnpj não encontrado");
      }
    } catch (err) {
      lastError = err;
    }

    if (!result && lastError) {
      try {
        result = await tryReceitaWs(cnpj);
        if (result) {
          usedSource = "receitaws";
          log("receitaws success (fallback)");
        }
      } catch (err) {
        lastError = err;
      }
    }

    await logUsage(supabase, tenantId, usedSource ?? "external_error");

    if (!result && !lastError) {
      return new Response(
        JSON.stringify({ success: false, error: "cnpj_not_found", message: "CNPJ não encontrado na Receita Federal" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!result) {
      console.error(`[lookup-cnpj][${correlationId}] all providers failed:`, lastError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "providers_unavailable",
          message: "Serviços de consulta CNPJ temporariamente indisponíveis. Tente novamente em alguns minutos ou preencha os dados manualmente.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase
      .from("cnpj_cache")
      .upsert(
        {
          cnpj,
          payload: result,
          source: usedSource!,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "cnpj" }
      );

    return new Response(
      JSON.stringify({ success: true, source: usedSource, data: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[lookup-cnpj][${correlationId}] fatal:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "internal_error",
        message: error instanceof Error ? error.message : "Erro interno",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
