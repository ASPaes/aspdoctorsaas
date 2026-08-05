import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Espelha o ORIGENS da upload-ticket-attachment: Suporte e Customer Success têm tabelas de anexo
// distintas, no mesmo bucket.
const TABELAS: Record<string, string> = {
  support: "support_ticket_attachments",
  cs: "cs_ticket_attachments",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return json({ error: "Não autenticado" }, 401);
    }

    // Sem "origem" é Suporte: mantém o contrato de quem já chamava a função.
    const { attachmentId, origem = "support" } = await req.json().catch(() => ({}));
    if (!attachmentId) {
      return json({ error: "attachmentId obrigatório" }, 400);
    }

    const tabela = TABELAS[origem];
    if (!tabela) {
      return json({ error: `origem inválida: "${origem}"` }, 400);
    }

    const { data: att } = await supabaseAdmin
      .from(tabela)
      .select("id, tenant_id, file_path, file_name, uploaded_by")
      .eq("id", attachmentId)
      .maybeSingle();

    if (!att) {
      return json({ error: "Anexo não encontrado" }, 404);
    }

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id, role, is_super_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    const isSuperAdmin = prof?.is_super_admin === true;
    if (!isSuperAdmin && prof?.tenant_id !== att.tenant_id) {
      return json({ error: "Anexo de outro tenant" }, 403);
    }

    // Mesma regra da UI: admin/head (e super admin) excluem qualquer anexo; os demais só o próprio.
    const canDeleteAny = isSuperAdmin || prof?.role === "admin" || prof?.role === "head";
    if (!canDeleteAny && att.uploaded_by !== user.id) {
      return json({ error: "Só quem anexou o arquivo pode excluí-lo" }, 403);
    }

    // Arquivo primeiro: se a linha sair antes, a policy do bucket deixa de casar e o objeto vira órfão.
    // file_path 'db://…' é anexo antigo gravado no banco, sem objeto no Storage.
    if (att.file_path && !att.file_path.startsWith("db://")) {
      const { error: rmError } = await supabaseAdmin.storage
        .from("ticket-attachments")
        .remove([att.file_path]);
      if (rmError) {
        return json({ error: "Storage: " + rmError.message }, 500);
      }
    }

    const { error: delError } = await supabaseAdmin
      .from(tabela)
      .delete()
      .eq("id", attachmentId);

    if (delError) {
      return json({ error: "Registro: " + delError.message }, 500);
    }

    return json({ success: true, id: attachmentId });
  } catch (err) {
    return json({ error: (err as Error).message ?? "Erro interno" }, 500);
  }
});
