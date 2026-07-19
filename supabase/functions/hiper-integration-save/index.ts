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

    const { error: rpcError } = await supabase.rpc("hiper_integration_connect", {
      p_tenant_id: targetTenantId,
      p_token: cleanToken,
      p_base_url: typeof base_url === "string" && base_url.trim() ? base_url.trim() : DEFAULT_BASE_URL,
    });
    if (rpcError) return json({ ok: false, error: rpcError.message });

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: (err as Error)?.message || "Erro interno" }, 500);
  }
});
