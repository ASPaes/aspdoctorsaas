// AI Client shared utilities

export interface AIConfig {
  apiKey: string;
  model: string;
  provider: string;
  baseUrl?: string;
  systemPrompt?: string | null;
}

export async function getAIConfig(
  tenantId: string,
  supabase: any
): Promise<AIConfig | null> {
  try {
    const { data, error } = await supabase
      .from("ai_settings")
      .select("api_key_encrypted, model, provider, base_url, is_active, system_prompt")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) return null;

    const encryptionKey = Deno.env.get("AI_SETTINGS_ENCRYPTION_KEY")!;
    const { data: decrypted, error: decryptError } = await supabase.rpc(
      "decrypt_api_key",
      {
        p_encrypted: data.api_key_encrypted,
        p_encryption_key: encryptionKey,
      }
    );

    if (decryptError || !decrypted) return null;

    return {
      apiKey: decrypted,
      model: data.model || "gpt-5.4",
      provider: data.provider,
      baseUrl: data.base_url || undefined,
      systemPrompt: data.system_prompt || null,
    };
  } catch {
    return null;
  }
}

export async function callAI(
  config: AIConfig,
  messages: { role: string; content: string }[],
  tools?: any[]
): Promise<string> {
  const { provider, apiKey, model, baseUrl, systemPrompt } = config;

  // Injeta o systemPrompt do tenant como primeiro system message
  // se já existir um system no array, o do tenant vem antes (maior prioridade)
  const enrichedMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  if (provider === "openai" || provider === "custom") {
    const url =
      provider === "custom" && baseUrl
        ? `${baseUrl}/chat/completions`
        : "https://api.openai.com/v1/chat/completions";

    const body: any = { model, messages: enrichedMessages, max_completion_tokens: 1500 };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = { type: "function", function: { name: tools[0].function.name } };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    const data = await res.json();

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) return toolCall.function.arguments;
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (provider === "anthropic") {
    // Anthropic: separar system de user/assistant
    // Combinar todos os system messages em um único bloco
    const systemParts = enrichedMessages
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const userMessages = enrichedMessages.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    const body: any = {
      model,
      max_tokens: 1500,
      messages: userMessages,
    };
    if (systemParts.length > 0) {
      body.system = systemParts.join("\n\n---\n\n");
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  }

  if (provider === "gemini") {
    const cleanModel = model.replace(/^models\//, "");

    // Combinar todos os system messages para o systemInstruction do Gemini
    const systemParts = enrichedMessages
      .filter((m) => m.role === "system")
      .map((m) => m.content);

    const contents = enrichedMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: any = { contents };
    if (systemParts.length > 0) {
      body.systemInstruction = { parts: [{ text: systemParts.join("\n\n---\n\n") }] };
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  throw new Error(`Provider desconhecido: ${provider}`);
}
