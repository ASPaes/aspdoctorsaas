// ============================================================================
// oem-variacao-mensal — por que o custo de cada filial mudou no último mês
// fechado (DEM-0517). Ponte para a função de mesmo nome no DoctorOEM.
//
// A conta é feita lá: o DoctorOEM puxa o faturamento dos dois meses na
// Tablet Cloud e separa a variação módulo a módulo em upsell, downsell,
// reajuste e consumo. Conferido em 01/10/2026 contra a planilha "Reajustes"
// do portal: 78 de 78 lojas com os mesmos valores.
//
// Aqui só se confere QUEM pede e se busca a chave no Vault. A chave do
// DoctorOEM nunca chega ao navegador. Mesmo desenho da `oem-licenca-estado`.
//
// Leitura pura: não grava nada no DS nem no OEM. Também não guarda o
// resultado: o faturamento do mês fechado não muda, e a tela consulta quando
// abre a aba (a resposta leva ~2,5 s).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const ds = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, mensagem: "Sem token de autenticação." }, 401);

    const comoUsuario = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
    );
    const { data: u, error: errU } = await comoUsuario.auth.getUser();
    if (errU || !u?.user) return json({ ok: false, mensagem: "Token inválido." }, 401);

    const corpo = await req.json().catch(() => ({} as Record<string, unknown>));
    const contaId = String(corpo.conta_id ?? "");
    if (!contaId) return json({ ok: false, mensagem: "Informe conta_id." }, 400);

    const { data: conta } = await ds
      .from("oem_integration")
      .select("id, tenant_id, api_url, ativo")
      .eq("id", contaId)
      .maybeSingle();
    if (!conta || !conta.ativo) return json({ ok: false, mensagem: "Conta do OEM não encontrada." }, 404);

    // O tenant da conta tem que ser o da pessoa. Super admin passa: é ele que
    // simula outro tenant pela tela.
    const { data: perfil } = await ds
      .from("profiles")
      .select("tenant_id, is_super_admin")
      .eq("user_id", u.user.id)
      .maybeSingle();
    if (perfil?.is_super_admin !== true && perfil?.tenant_id !== conta.tenant_id) {
      return json({ ok: false, mensagem: "Sem acesso a esta conta do OEM." }, 403);
    }

    const { data: chave, error: errK } = await ds.rpc("obter_chave_oem_por_conta", {
      p_integration_id: conta.id,
    });
    if (errK || !chave) return json({ ok: false, mensagem: "Chave do OEM não encontrada no Vault." }, 409);

    const resp = await fetch(`${String(conta.api_url).replace(/\/+$/, "")}/oem-variacao-mensal`, {
      method: "POST",
      headers: { "x-api-key": String(chave), "Content-Type": "application/json" },
      // Sem mês: o DoctorOEM usa o último mês fechado. Competência aberta vem
      // zerada da Tablet Cloud e faria toda filial parecer cancelada.
      body: JSON.stringify(corpo.mes && corpo.ano ? { mes: corpo.mes, ano: corpo.ano } : {}),
    });
    const r = await resp.json().catch(() => null);
    if (!resp.ok || !r?.ok) {
      return json({ ok: false, mensagem: r?.mensagem ?? `DoctorOEM respondeu HTTP ${resp.status}.` }, 502);
    }
    return json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oem-variacao-mensal]", msg);
    return json({ ok: false, mensagem: msg }, 500);
  }
});
