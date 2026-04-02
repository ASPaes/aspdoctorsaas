import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig } from "../_shared/ai-client.ts";

const FUNCTION_NAME = "transcribe-whatsapp-audio";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function checkRateLimit(
  supabase: any,
  tenantId: string,
  functionName: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  try {
    const { data: configs } = await supabase
      .from('ai_rate_limit_config')
      .select('max_calls, window_seconds, tenant_id')
      .eq('function_name', functionName)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('tenant_id', { ascending: false, nullsFirst: false })
      .limit(2);

    const config = configs?.[0] ?? { max_calls: 10, window_seconds: 60 };
    const windowSeconds = config.window_seconds;
    const maxCalls = config.max_calls;
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

    const { count } = await supabase
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('function_name', functionName)
      .gte('called_at', windowStart);

    if ((count ?? 0) >= maxCalls) {
      return { allowed: false, retryAfterSeconds: windowSeconds };
    }

    supabase
      .from('ai_usage_log')
      .insert({ tenant_id: tenantId, function_name: functionName })
      .then(() => {});

    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { messageId } = await req.json();
    if (!messageId) {
      return new Response(JSON.stringify({ error: "messageId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("whatsapp_messages").update({ transcription_status: "processing" }).eq("id", messageId);

    const { data: message, error: msgError } = await supabase
      .from("whatsapp_messages")
      .select("id, media_url, media_mimetype, message_type, conversation_id")
      .eq("id", messageId)
      .single();

    if (msgError || !message) {
      return new Response(JSON.stringify({ error: "Message not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (message.message_type !== "audio") {
      return new Response(JSON.stringify({ message: "Not an audio message" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!message.media_url) {
      await supabase.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", messageId);
      return new Response(JSON.stringify({ error: "No media URL" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: convData } = await supabase
      .from("whatsapp_conversations")
      .select("tenant_id")
      .eq("id", message.conversation_id)
      .single();

    if (!convData?.tenant_id) {
      await supabase.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", messageId);
      return new Response(JSON.stringify({ error: "Tenant não encontrado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiConfig = await getAIConfig(convData.tenant_id, supabase);
    if (!aiConfig) {
      await supabase.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", messageId);
      return new Response(
        JSON.stringify({
          error: "ai_not_configured",
          message: "Nenhuma IA configurada. Acesse Configurações > Inteligência Artificial.",
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (aiConfig.provider === "anthropic" || aiConfig.provider === "custom") {
      await supabase.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", messageId);
      return new Response(
        JSON.stringify({ error: "provider_not_supported", message: "Transcrição de áudio requer provedor OpenAI ou Gemini." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("whatsapp-media")
      .download(message.media_url);

    if (downloadError || !fileData) {
      await supabase.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", messageId);
      return new Response(JSON.stringify({ error: "Failed to download audio" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const mimetype = message.media_mimetype || "audio/ogg";
    let transcription = "";

    if (aiConfig.provider === "openai") {
      const formData = new FormData();
      const blob = new Blob([bytes], { type: mimetype });
      const ext = mimetype.includes("ogg") ? "ogg" : mimetype.includes("mp3") ? "mp3" : mimetype.includes("wav") ? "wav" : "ogg";
      formData.append("file", blob, `audio.${ext}`);
      formData.append("model", "whisper-1");
      formData.append("language", "pt");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${aiConfig.apiKey}` },
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[${FUNCTION_NAME}][${requestId}] Whisper error:`, errText);
        await supabase.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", messageId);
        if (res.status === 401) {
          return new Response(JSON.stringify({ error: "ai_key_invalid", message: "Chave OpenAI inválida." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ error: "Transcription failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const data = await res.json();
      transcription = data.text || "";

    } else if (aiConfig.provider === "gemini") {
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64Audio = btoa(binary);
      const cleanModel = aiConfig.model.replace(/^models\//, "");

      const body = {
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: mimetype, data: base64Audio } },
            { text: "Transcreva este áudio. Retorne APENAS o texto transcrito, sem formatação." },
          ],
        }],
        systemInstruction: { parts: [{ text: "Você é um transcritor de áudio. Se o áudio estiver inaudível retorne [áudio inaudível]." }] },
      };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${aiConfig.apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[${FUNCTION_NAME}][${requestId}] Gemini error:`, errText);
        await supabase.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", messageId);
        return new Response(JSON.stringify({ error: "Transcription failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const data = await res.json();
      transcription = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    }

    if (!transcription) {
      await supabase.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", messageId);
      return new Response(JSON.stringify({ error: "Empty transcription" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateError } = await supabase
      .from("whatsapp_messages")
      .update({ audio_transcription: transcription, transcription_status: "completed" })
      .eq("id", messageId);

    if (updateError) throw updateError;

    console.log(`[${FUNCTION_NAME}][${requestId}] Success (${transcription.length} chars)`);
    return new Response(JSON.stringify({ success: true, transcription }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
