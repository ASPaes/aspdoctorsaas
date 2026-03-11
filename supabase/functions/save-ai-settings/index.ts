import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Sem autorização");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) throw new Error("Usuário não autenticado");

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role, is_super_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile || (profile.role !== "admin" && !profile.is_super_admin)) {
      throw new Error("Acesso negado: apenas admins podem configurar IA");
    }

    const { provider, api_key, model, base_url, tenant_id } = await req.json();

    const targetTenantId = profile.is_super_admin && tenant_id
      ? tenant_id
      : profile.tenant_id;

    if (!targetTenantId) throw new Error("tenant_id não encontrado");
    if (!provider) throw new Error("provider é obrigatório");

    const encryptionKey = Deno.env.get("AI_SETTINGS_ENCRYPTION_KEY")!;

    const payload: any = {
      tenant_id: targetTenantId,
      provider,
      model: model || null,
      base_url: base_url || null,
      is_active: true,
    };

    if (api_key && api_key.length > 0 && !api_key.startsWith("****")) {
      const { data: encrypted } = await supabase.rpc("encrypt_api_key", {
        p_key: api_key,
        p_encryption_key: encryptionKey,
      });
      payload.api_key_encrypted = encrypted;
      payload.api_key_hint = "****" + api_key.slice(-4);
    }

    const { error: upsertError } = await supabase
      .from("ai_settings")
      .upsert(payload, { onConflict: "tenant_id" });

    if (upsertError) throw upsertError;

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
