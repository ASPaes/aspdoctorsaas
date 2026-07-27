import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_UPLOAD_MB = 50;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

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
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const ticketId = formData.get("ticketId") as string | null;

    if (!file || !ticketId) {
      return new Response(JSON.stringify({ error: "file e ticketId obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mesmo teto do bucket (file_size_limit = 50MB) e do front.
    if (file.size > MAX_UPLOAD_BYTES) {
      return new Response(JSON.stringify({ error: `"${file.name}" excede ${MAX_UPLOAD_MB}MB` }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: ticket } = await supabaseAdmin
      .from("support_tickets")
      .select("tenant_id")
      .eq("id", ticketId)
      .maybeSingle();

    if (!ticket) {
      return new Response(JSON.stringify({ error: "Ticket não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenantId = ticket.tenant_id;
    const safeName = file.name
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
    const path = `${tenantId}/${ticketId}/${Date.now()}_${safeName}`;

    // Passa o File direto (não arrayBuffer): com 50MB, a cópia extra dobrava o pico de memória da função.
    const { error: uploadError } = await supabaseAdmin.storage
      .from("ticket-attachments")
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return new Response(JSON.stringify({ error: "Upload: " + uploadError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: att, error: insertError } = await supabaseAdmin
      .from("support_ticket_attachments")
      .insert({
        tenant_id: tenantId, ticket_id: ticketId,
        file_name: file.name, file_path: path,
        file_size: file.size,
        file_type: file.type || safeName.split(".").pop() || "",
        uploaded_by: user.id,
      })
      .select("id")
      .single();

    if (insertError) {
      await supabaseAdmin.storage.from("ticket-attachments").remove([path]);
      return new Response(JSON.stringify({ error: "Registro: " + insertError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: att.id, path }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
