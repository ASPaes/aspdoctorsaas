import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAdapter, getInstanceSecrets } from "../_shared/providers/index.ts";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || token !== SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rows, error: fetchErr } = await supabase
      .from("notification_whatsapp_outbox")
      .select("id, tenant_id, phone, message, attempts")
      .eq("status", "pending")
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(20);

    if (fetchErr) {
      console.error("[process-notification-outbox] fetch error:", fetchErr.message);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const instanceCache = new Map<string, string | null>();
    let sent = 0;
    let failed = 0;

    for (const row of rows || []) {
      try {
        let instanceId = instanceCache.get(row.tenant_id) ?? undefined;
        if (instanceId === undefined) {
          const { data: cfg } = await supabase
            .from("configuracoes")
            .select("churn_alert_instance_id")
            .eq("tenant_id", row.tenant_id)
            .maybeSingle();
          instanceId = (cfg?.churn_alert_instance_id as string | null) ?? null;
          instanceCache.set(row.tenant_id, instanceId);
        }

        if (!instanceId) {
          await supabase
            .from("notification_whatsapp_outbox")
            .update({
              status: "failed",
              error: "no_instance_configured",
              processed_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          failed++;
          continue;
        }

        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("id, instance_name, provider_type, instance_id_external, meta_phone_number_id")
          .eq("id", instanceId)
          .maybeSingle();

        if (!inst) {
          const nextAttempts = (row.attempts || 0) + 1;
          await supabase
            .from("notification_whatsapp_outbox")
            .update({
              attempts: nextAttempts,
              error: "instance_not_found",
              status: nextAttempts >= 3 ? "failed" : "pending",
              processed_at: nextAttempts >= 3 ? new Date().toISOString() : null,
            })
            .eq("id", row.id);
          failed++;
          continue;
        }

        try {
          const secrets = await getInstanceSecrets(supabase, inst.id);
          const adapter = getAdapter(inst.provider_type);
          const to = String(row.phone || "").replace(/\D/g, "");
          await adapter.send(secrets as any, inst as any, {
            to,
            messageType: "text",
            content: row.message,
          });

          await supabase
            .from("notification_whatsapp_outbox")
            .update({
              status: "sent",
              processed_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          sent++;
        } catch (sendErr: any) {
          const nextAttempts = (row.attempts || 0) + 1;
          const errMsg = String(sendErr?.message || sendErr || "send_error").slice(0, 300);
          await supabase
            .from("notification_whatsapp_outbox")
            .update({
              attempts: nextAttempts,
              error: errMsg,
              status: nextAttempts >= 3 ? "failed" : "pending",
              processed_at: nextAttempts >= 3 ? new Date().toISOString() : null,
            })
            .eq("id", row.id);
          failed++;
          console.error(`[process-notification-outbox] send error row=${row.id}:`, errMsg);
        }
      } catch (rowErr: any) {
        failed++;
        console.error(`[process-notification-outbox] row error id=${row.id}:`, rowErr?.message || rowErr);
      }
    }

    return new Response(
      JSON.stringify({ processed: rows?.length || 0, sent, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[process-notification-outbox] fatal:", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
