// acessofast-resolver
//
// Endpoint que o AcessoFast chama para descobrir de qual empresa é uma conversa.
//
// verify_jwt = FALSE, declarado em supabase/config.toml. É deliberado: quem chama é um
// parceiro externo que não tem JWT do Supabase. O portão é a chave de integração conferida
// aqui dentro. Sem a entrada no config.toml o CI deploya com false de qualquer jeito —
// mas aqui o false é uma decisão, não um acidente, e por isso está escrita.
//
// Por que não a RPC direta via PostgREST (que é o que o manual do parceiro pedia):
// exigiria um JWT assinado com o segredo do projeto, e o projeto migrou para chaves
// assimétricas (ECC P-256). O HS256 legado ainda verifica, mas está marcado como
// "previous key" — um token assinado com ele morre em silêncio no dia da migração da
// anon key. A chave de integração não depende de chave nenhuma do Supabase.
//
// A chave também é o que amarra o tenant: ela identifica de qual empresa o AcessoFast
// está falando. O tenant NÃO vem do argumento — foi a ressalva que o próprio parceiro
// levantou no manual deles.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 401 só para credencial. Tudo que é "não consegui resolver" volta [] — o parceiro
  // cai na escolha manual e nunca mostra erro técnico ao técnico.
  const auth = req.headers.get("authorization") ?? "";
  const chave = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : (req.headers.get("x-acessofast-key") ?? "").trim();
  if (chave.length < 16) return json({ error: "credencial_ausente" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json([]);
  }
  // Aceita os dois nomes: `conv` (o da URL) e `p_conversation_id` (o do manual deles).
  const conv = String(body.conv ?? body.p_conversation_id ?? "").trim();
  if (!conv) return json([]);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const hash = await sha256Hex(chave);
  const { data: integ, error: integErr } = await supabase
    .from("acessofast_integration")
    .select("tenant_id, ultimo_uso_at")
    .eq("chave_hash", hash)
    .maybeSingle();

  if (integErr) return json([]);
  if (!integ) return json({ error: "credencial_invalida" }, 401);

  // O tenant embutido no conv tem que ser o mesmo da credencial. Conversa de outro
  // assinante não resolve nem com um par perfeitamente válido em mãos.
  const tenantDoConv = conv.split(":")[0];
  if (tenantDoConv !== integ.tenant_id) return json([]);

  const { data, error } = await supabase.rpc("acessofast_resolver_conversa", {
    p_conversation_id: conv,
  });
  if (error) return json([]);

  // Carimbo de uso com folga de 1h: whatsapp_* já sofrem com volume de escrita, e este
  // endpoint é chamado a cada clique em Conectar. Não vale um UPDATE por clique.
  const ultimo = integ.ultimo_uso_at ? Date.parse(integ.ultimo_uso_at) : 0;
  if (Date.now() - ultimo > 3_600_000) {
    await supabase
      .from("acessofast_integration")
      .update({ ultimo_uso_at: new Date().toISOString() })
      .eq("tenant_id", integ.tenant_id);
  }

  return json(data ?? []);
});
