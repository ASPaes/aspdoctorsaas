import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FUNCTION_NAME = "test-ai-config";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders, status: 204 });

  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${FUNCTION_NAME}][${requestId}] Início`);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Sem autorização");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Usuário não autenticado");

    // Get profile & check admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role, is_super_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile || (profile.role !== "admin" && !profile.is_super_admin)) {
      throw new Error("Acesso negado: apenas admins podem testar IA");
    }

    const tenantId = profile.tenant_id;

    // Load AI settings
    const { data: settings, error: settingsErr } = await supabase
      .from("ai_settings")
      .select(
        "id, provider, model, base_url, api_key_encrypted, system_prompt"
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (settingsErr || !settings)
      throw new Error("Configuração de IA não encontrada");

    if (!settings.api_key_encrypted)
      throw new Error("Chave de API não configurada");

    // Decrypt key
    const encryptionKey = Deno.env.get("AI_SETTINGS_ENCRYPTION_KEY")!;
    const { data: apiKey, error: decryptErr } = await supabase.rpc(
      "decrypt_api_key",
      {
        p_encrypted: settings.api_key_encrypted,
        p_encryption_key: encryptionKey,
      }
    );
    if (decryptErr || !apiKey) throw new Error("Falha ao recuperar chave");

    const provider = settings.provider;
    const model = settings.model || "gpt-5.4";
    const baseUrl = settings.base_url;

    // Run a minimal test
    const testPrompt = "Responda apenas com a palavra OK.";
    const start = Date.now();
    let testOk = false;
    let testError: string | null = null;
    let modelUsed = model;

    try {
      if (provider === "openai" || provider === "custom") {
        const url =
          provider === "custom" && baseUrl
            ? `${baseUrl}/chat/completions`
            : "https://api.openai.com/v1/chat/completions";

        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: testPrompt }],
            max_completion_tokens: 10,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }
        const data = await res.json();
        modelUsed = data.model || model;
        testOk = true;
      } else if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 10,
            messages: [{ role: "user", content: testPrompt }],
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }
        const data = await res.json();
        modelUsed = data.model || model;
        testOk = true;
      } else if (provider === "gemini") {
        const cleanModel = model.replace(/^models\//, "");
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                { role: "user", parts: [{ text: testPrompt }] },
              ],
            }),
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }
        await res.json();
        testOk = true;
      } else {
        throw new Error(`Provider desconhecido: ${provider}`);
      }
    } catch (e: any) {
      testError = (e.message || "Erro desconhecido").slice(0, 500);
      testOk = false;
    }

    const latencyMs = Date.now() - start;

    console.log(
      `[${FUNCTION_NAME}][${requestId}] Resultado: ok=${testOk}, latency=${latencyMs}ms`
    );

    // Update ai_settings with test results
    await supabase
      .from("ai_settings")
      .update({
        last_tested_at: new Date().toISOString(),
        last_test_ok: testOk,
        last_test_error: testError,
      })
      .eq("id", settings.id);

    // Audit event
    await supabase.from("audit_events").insert({
      tenant_id: tenantId,
      actor_user_id: user.id,
      event_type: "ai_config_tested",
      metadata: {
        provider,
        model: modelUsed,
        test_ok: testOk,
        latency_ms: latencyMs,
        error_summary: testError ? testError.slice(0, 100) : null,
      },
    });

    return new Response(
      JSON.stringify({
        ok: testOk,
        latency_ms: latencyMs,
        model_used: modelUsed,
        provider_used: provider,
        error_message: testOk ? null : "Falha ao conectar com o provedor. Verifique suas credenciais e modelo.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Erro:`, err.message);
    return new Response(
      JSON.stringify({ ok: false, error_message: err.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
