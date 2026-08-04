import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const OMIE_BASE = "https://app.omie.com.br/api/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
async function omieCall(endpoint, call, param, creds) {
  const res = await fetch(`${OMIE_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      call,
      app_key: creds.app_key,
      app_secret: creds.app_secret,
      param: [
        param
      ]
    })
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch  {
    parsed = {
      raw: text
    };
  }
  if (!res.ok || parsed?.faultstring) {
    const msg = parsed?.faultstring ?? `Omie ${call} HTTP ${res.status}: ${text.slice(0, 500)}`;
    throw new Error(msg);
  }
  return parsed;
}
async function paginar(endpoint, call, arrayKey, creds, maxPages = 100) {
  const todos = [];
  let pagina = 1;
  let total = 1;
  while(pagina <= Math.min(total, maxPages)){
    const data = await omieCall(endpoint, call, {
      pagina,
      registros_por_pagina: 200
    }, creds);
    total = Number(data?.total_de_paginas ?? 1);
    const arr = data?.[arrayKey] ?? [];
    if (!Array.isArray(arr) || arr.length === 0) break;
    todos.push(...arr);
    pagina++;
  }
  return todos;
}
// Pagina\u00e7\u00e3o para endpoints que usam nPagina/nRegPorPagina (ex: ListarCadastroServico)
async function paginarN(endpoint, call, arrayKey, creds, extraParam = {}, maxPages = 100) {
  const todos = [];
  let pagina = 1;
  let total = 1;
  while(pagina <= Math.min(total, maxPages)){
    const data = await omieCall(endpoint, call, {
      nPagina: pagina,
      nRegPorPagina: 200,
      ...extraParam
    }, creds);
    total = Number(data?.nTotPaginas ?? data?.total_de_paginas ?? 1);
    const arr = data?.[arrayKey] ?? [];
    if (!Array.isArray(arr) || arr.length === 0) break;
    todos.push(...arr);
    pagina++;
  }
  return todos;
}
function dedupe(rows, key) {
  const m = new Map();
  for (const r of rows)m.set(String(r[key]), r);
  return [
    ...m.values()
  ];
}
function json(b, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  let body = null;
  try {
    try {
      body = await req.json();
    } catch  {
      return json({
        ok: false,
        error: "JSON inv\u00e1lido"
      }, 400);
    }
    const { tenant_id } = body ?? {};
    if (!tenant_id) return json({
      ok: false,
      error: "tenant_id \u00e9 obrigat\u00f3rio"
    }, 400);
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({
      ok: false,
      error: "N\u00e3o autenticado"
    }, 401);
    const { data: membership } = await userClient.from("tenant_users").select("id").eq("tenant_id", tenant_id).maybeSingle();
    if (!membership) return json({
      ok: false,
      error: "Sem acesso ao tenant"
    }, 403);
    const { data: cred } = await supa.from("tenant_credentials").select("omie_app_key, omie_app_secret").eq("tenant_id", tenant_id).maybeSingle();
    if (!cred?.omie_app_key || !cred?.omie_app_secret) return json({
      ok: false,
      error: "Credenciais Omie ausentes"
    }, 400);
    const creds = {
      app_key: cred.omie_app_key,
      app_secret: cred.omie_app_secret
    };
    const now = new Date().toISOString();
    const erros = [];
    const counts = {};
    // 1) Contas correntes
    try {
      const contas = await paginar("/geral/contacorrente/", "ListarContasCorrentes", "ListarContasCorrentes", creds);
      const rows = dedupe(contas.filter((c)=>c?.nCodCC).map((c)=>({
          tenant_id,
          codigo: c.nCodCC,
          descricao: c.descricao ?? null,
          tipo: c.cCodTipo ?? c.tipo ?? null,
          raw: c,
          synced_at: now
        })), "codigo");
      if (rows.length) {
        const { error } = await supa.from("omie_contas_correntes").upsert(rows, {
          onConflict: "tenant_id,codigo"
        });
        if (error) throw new Error(error.message);
      }
      counts.contas = rows.length;
    } catch (e) {
      erros.push("contas: " + e.message);
      console.error("ERRO_CONTAS:", e.message);
    }
    // 2) Categorias
    try {
      const cats = await paginar("/geral/categorias/", "ListarCategorias", "categoria_cadastro", creds);
      const rows = dedupe(cats.filter((c)=>c?.codigo && c?.descricao && !String(c.descricao).includes("<Dispon\u00edvel>")).map((c)=>({
          tenant_id,
          codigo: String(c.codigo),
          descricao: c.descricao ?? null,
          raw: c,
          synced_at: now
        })), "codigo");
      if (rows.length) {
        const { error } = await supa.from("omie_categorias").upsert(rows, {
          onConflict: "tenant_id,codigo"
        });
        if (error) throw new Error(error.message);
      }
      counts.categorias = rows.length;
    } catch (e) {
      erros.push("categorias: " + e.message);
      console.error("ERRO_CATEGORIAS:", e.message);
    }
    // 3) Vendedores
    try {
      const vends = await paginar("/geral/vendedores/", "ListarVendedores", "cadastro", creds);
      const rows = dedupe(vends.filter((v)=>v?.codigo).map((v)=>({
          tenant_id,
          codigo: v.codigo,
          nome: v.nome ?? null,
          raw: v,
          synced_at: now
        })), "codigo");
      if (rows.length) {
        const { error } = await supa.from("omie_vendedores").upsert(rows, {
          onConflict: "tenant_id,codigo"
        });
        if (error) throw new Error(error.message);
      }
      counts.vendedores = rows.length;
    } catch (e) {
      erros.push("vendedores: " + e.message);
      console.error("ERRO_VENDEDORES:", e.message);
    }
    // 4) Servi\u00e7os cadastrados (ListarCadastroServico). Estrutura real confirmada:
    //    item.intListar.nCodServ (c\u00f3digo), item.cabecalho.{cCodLC116,cCodServMun,cDescricao,cCodigo,cCodCateg}
    try {
      const servs = await paginarN("/servicos/servico/", "ListarCadastroServico", "cadastros", creds, {
        inativo: "N"
      });
      const rows = dedupe(servs.map((s)=>{
        const cab = s?.cabecalho ?? {};
        const codigo = s?.intListar?.nCodServ ?? null;
        return {
          tenant_id,
          codigo,
          descricao: cab?.cDescricao ?? null,
          cod_lc116: cab?.cCodLC116 ? String(cab.cCodLC116) : null,
          cod_municipal: cab?.cCodServMun ? String(cab.cCodServMun) : null,
          raw: s,
          synced_at: now
        };
      }).filter((r)=>r.codigo), "codigo");
      if (rows.length) {
        const { error } = await supa.from("omie_servicos").upsert(rows, {
          onConflict: "tenant_id,codigo"
        });
        if (error) throw new Error(error.message);
      }
      counts.servicos = rows.length;
    } catch (e) {
      erros.push("servicos: " + e.message);
      console.error("ERRO_SERVICOS:", e.message);
    }
    // status respeitando o CHECK (sucesso | erro | ignorado). Parcial conta como erro (vis\u00edvel pra auditoria).
    const status = erros.length === 0 ? "sucesso" : "erro";
    await supa.from("integrations_log").insert({
      tenant_id,
      evento: "atualizar",
      status,
      entidade: "listas",
      response: counts,
      error_message: erros.length ? erros.join(" | ") : null
    });
    return json({
      ok: erros.length === 0,
      counts,
      erros: erros.length ? erros : undefined
    });
  } catch (e) {
    const msg = e.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    try {
      if (body?.tenant_id) await supa.from("integrations_log").insert({
        tenant_id: body.tenant_id,
        evento: "atualizar",
        status: "erro",
        entidade: "listas",
        error_message: msg
      });
    } catch (_) {}
    return json({
      ok: false,
      error: msg
    }, 500);
  }
});
