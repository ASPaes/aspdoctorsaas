import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const FUNCTION_NAME = "process-finalize-queue";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BATCH = 10;
const MAX_BATCH = 50;
const MAX_ATTEMPTS = 3;

serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth: só aceita chamada interna com service_role
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.replace("Bearer ", "") !== serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // limit opcional via body
  let limit = DEFAULT_BATCH;
  try {
    const body = await req.json();
    if (body?.limit) limit = Math.min(MAX_BATCH, Math.max(1, Number(body.limit)));
  } catch { /* sem body, usa default */ }

  // Itens pendentes (ou em erro com retry disponível)
  const { data: items, error: selErr } = await supabase
    .from("attendance_analysis_queue")
    .select("attendance_id, attempts")
    .or(`status.eq.pending,and(status.eq.error,attempts.lt.${MAX_ATTEMPTS})`)
    .order("enqueued_at", { ascending: true })
    .limit(limit);

  if (selErr) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Erro lendo fila:`, selErr.message);
    return new Response(
      JSON.stringify({ error: selErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!items || items.length === 0) {
    return new Response(
      JSON.stringify({ success: true, processed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let done = 0;
  let errors = 0;

  for (const item of items) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/finalize-attendance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ attendanceId: item.attendance_id }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`finalize HTTP ${res.status}: ${txt.substring(0, 200)}`);
      }

      await supabase
        .from("attendance_analysis_queue")
        .update({ status: "done", processed_at: new Date().toISOString(), last_error: null })
        .eq("attendance_id", item.attendance_id);
      done++;
    } catch (e) {
      await supabase
        .from("attendance_analysis_queue")
        .update({
          status: "error",
          attempts: (item.attempts ?? 0) + 1,
          last_error: String(e instanceof Error ? e.message : e).substring(0, 500),
        })
        .eq("attendance_id", item.attendance_id);
      errors++;
    }
  }

  console.log(`[${FUNCTION_NAME}][${requestId}] processed=${items.length} done=${done} errors=${errors}`);

  return new Response(
    JSON.stringify({ success: true, processed: items.length, done, errors }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
