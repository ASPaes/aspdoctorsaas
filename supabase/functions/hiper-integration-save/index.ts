import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const DEFAULT_BASE_URL = "https://portalhiper.com.br";

interface Identidade {
  tenant_id: string | null;
  tenant_nome: string | null;
  /** O portal ainda não expõe /me — dá para conectar, mas sem a trava. */
  semMe: boolean;
}

/**
 * Descobre de QUEM é o token antes de guardá-lo.
 *
 * Sem isto, o token de uma revenda colado na tela de outra é aceito e passa a
 * espelhar a carteira errada — sem erro, sem aviso. Com `/me`, a identidade do
 * portal vira dado gravado e o índice único do banco impede o resto.
 */
async function identificar(baseUrl: string, token: string): Promise<Identidade | { erro: string }> {
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/api/integ/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { erro: `Falha de rede ao falar com o PortalHiper: ${(e as Error).message}` };
  }

  if (resp.status === 404) {
    // Portal antigo. Valida o token pelo endpoint que existe desde sempre, para
    // não gravar credencial que não funciona.
    try {
      const r2 = await fetch(`${baseUrl}/api/integ/v1/clientes?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r2.status === 401) return { erro: "PortalHiper recusou: token inválido ou revogado." };
      if (r2.status === 403) return { erro: "PortalHiper recusou: o token não tem escopo de leitura de clientes." };
      if (!r2.ok) return { erro: `PortalHiper recusou (HTTP ${r2.status}).` };
    } catch (e) {
      return { erro: `Falha de rede ao validar o token: ${(e as Error).message}` };
    }
    return { tenant_id: null, tenant_nome: null, semMe: true };
  }

  if (resp.status === 401) return { erro: "PortalHiper recusou: token inválido ou revogado." };
  if (resp.status === 403) return { erro: "PortalHiper recusou: o token não tem escopo de leitura de clientes." };
  if (!resp.ok) return { erro: `PortalHiper recusou (HTTP ${resp.status}).` };

  const body = await resp.json().catch(() => ({}));
  const id = typeof body?.tenant_id === "string" ? body.tenant_id : null;
  if (!id) return { erro: "O PortalHiper respondeu sem identificar o tenant do token." };
  return { tenant_id: id, tenant_nome: body?.tenant_nome ?? null, semMe: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Sem autorização" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) return json({ ok: false, error: "Usuário não autenticado" });

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role, is_super_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile || (profile.role !== "admin" && !profile.is_super_admin)) {
      return json({ ok: false, error: "Acesso negado: apenas admins podem configurar integrações" });
    }

    const { token, tenant_id, base_url } = await req.json();

    // Super admin pode gravar para o tenant simulado; demais, só o próprio.
    const targetTenantId = profile.is_super_admin && tenant_id ? tenant_id : profile.tenant_id;
    if (!targetTenantId) return json({ ok: false, error: "tenant_id não encontrado" });

    const cleanToken = typeof token === "string" ? token.trim() : "";
    if (!cleanToken) return json({ ok: false, error: "Informe o token de integração" });
    if (!cleanToken.startsWith("hig_")) {
      return json({ ok: false, error: "Token inválido: o token do PortalHiper começa com \"hig_\"." });
    }

    const baseUrl = (typeof base_url === "string" && base_url.trim() ? base_url.trim() : DEFAULT_BASE_URL)
      .replace(/\/+$/, "");

    // 1. De quem é o token — ANTES de guardar. Credencial que não funciona, ou
    //    que é de outra revenda, não chega ao Vault.
    const ident = await identificar(baseUrl, cleanToken);
    if ("erro" in ident) return json({ ok: false, error: ident.erro });

    // 2. Um tenant do portal não pode estar em dois tenants do DoctorSaaS. A
    //    checagem aqui existe para dar a mensagem certa; quem garante é o índice
    //    único no banco.
    if (ident.tenant_id) {
      const { data: jaUsado } = await supabase
        .from("hiper_integration")
        .select("tenant_id")
        .eq("portal_tenant_id", ident.tenant_id)
        .neq("tenant_id", targetTenantId)
        .maybeSingle();
      if (jaUsado) {
        return json({
          ok: false,
          error: `Este token é do tenant "${ident.tenant_nome ?? ident.tenant_id}" do PortalHiper, e ele já está conectado a outra empresa aqui. Gere um token próprio no portal para esta empresa.`,
        });
      }
    }

    const { error: rpcError } = await supabase.rpc("hiper_integration_connect", {
      p_tenant_id: targetTenantId,
      p_token: cleanToken,
      p_base_url: baseUrl,
    });
    if (rpcError) return json({ ok: false, error: rpcError.message });

    const { error: identErr } = await supabase
      .from("hiper_integration")
      .update({
        portal_tenant_id: ident.tenant_id,
        portal_tenant_nome: ident.tenant_nome,
        ultimo_status: "ok",
        ultimo_teste_at: new Date().toISOString(),
      })
      .eq("tenant_id", targetTenantId);
    if (identErr) {
      // 23505 = o índice único pegou uma corrida que a checagem acima não viu.
      const dup = (identErr as { code?: string })?.code === "23505";
      return json({
        ok: false,
        error: dup
          ? "Este tenant do PortalHiper já está conectado a outra empresa aqui."
          : identErr.message,
      });
    }

    return json({
      ok: true,
      portal_tenant_nome: ident.tenant_nome,
      aviso: ident.semMe
        ? "Conectado, mas este PortalHiper ainda não expõe /api/integ/v1/me: não dá para provar de qual empresa o token é. Atualize o portal e salve o token de novo para ligar a trava."
        : null,
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error)?.message || "Erro interno" }, 500);
  }
});
