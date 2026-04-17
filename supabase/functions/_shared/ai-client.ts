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

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface AIResult {
  content: string;
  usage: AIUsage;
}

const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-5.4': { input: 2.00, output: 8.00 },
  'gpt-5': { input: 2.00, output: 8.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o3': { input: 10.00, output: 40.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o1': { input: 15.00, output: 60.00 },
  'claude-opus-4': { input: 15.00, output: 75.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-3-7-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku': { input: 0.80, output: 4.00 },
  'claude-haiku': { input: 0.80, output: 4.00 },
  'claude-3-opus': { input: 15.00, output: 75.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-pro': { input: 3.50, output: 10.50 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const m = model.toLowerCase();
  // Exact match first, then partial match (longer keys first to avoid gpt-4 matching gpt-4o)
  const key = Object.keys(MODEL_PRICES)
    .sort((a, b) => b.length - a.length)
    .find(k => m === k || m.startsWith(k) || m.includes(k));
  if (!key) return 0;
  const price = MODEL_PRICES[key];
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export async function callAI(
  config: AIConfig,
  messages: { role: string; content: string }[],
  tools?: any[]
): Promise<AIResult> {
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

    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const content = (() => {
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) return toolCall.function.arguments;
      return data.choices?.[0]?.message?.content ?? "";
    })();
    return { content, usage: { inputTokens, outputTokens, estimatedCostUsd: calcCost(config.model, inputTokens, outputTokens) } };
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
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    return { content: data.content?.[0]?.text ?? "", usage: { inputTokens, outputTokens, estimatedCostUsd: calcCost(config.model, inputTokens, outputTokens) } };
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
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    return { content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "", usage: { inputTokens, outputTokens, estimatedCostUsd: calcCost(config.model, inputTokens, outputTokens) } };
  }

  throw new Error(`Provider desconhecido: ${provider}`);
}
