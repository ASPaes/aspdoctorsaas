import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getSupportConfig } from "../_shared/support-config.ts";
import { sendAndPersistAutoMessage } from "../_shared/message-processor.ts";
import { getInstanceSecrets } from "../_shared/providers/index.ts";
import { SendContext } from "../_shared/message-types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOG = "[check-inactivity-timeout]";

interface AttendanceRow {
  id: string;
  attendance_code: string;
  tenant_id: string;
  conversation_id: string;
  contact_id: string;
  assigned_to: string | null;
  opened_at: string;
  last_customer_message_at: string | null;
  last_operator_message_at: string | null;
  inactivity_warning_sent_at: string | null;
}

interface ConversationRow {
  id: string;
  instance_id: string;
}

interface ContactRow {
  id: string;
  phone_number: string;
  name: string | null;
}

interface InstanceRow {
  id: string;
  instance_name: string;
  instance_id_external: string | null;
  provider_type: string;
  meta_phone_number_id: string | null;
  skip_ura: boolean | null;
}

function getLastActivityIso(att: AttendanceRow): string {
  const candidates = [
    att.last_customer_message_at,
    att.last_operator_message_at,
    att.opened_at,
  ].filter((x): x is string => !!x);
  if (candidates.length === 0) return att.opened_at;
  return candidates.reduce((max, cur) => (cur > max ? cur : max));
}

async function buildSendContext(
  supabase: any,
  tenantId: string,
  conversationId: string
): Promise<{ ctx: SendContext; contact: ContactRow } | null> {
  const { data: conv } = await supabase
    .from("whatsapp_conversations")
    .select("id, instance_id, contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;

  const { data: contact } = await supabase
    .from("whatsapp_contacts")
    .select("id, phone_number, name")
    .eq("id", conv.contact_id)
    .maybeSingle();
  if (!contact) return null;

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name, instance_id_external, provider_type, meta_phone_number_id, skip_ura, tenant_id")
    .eq("id", conv.instance_id)
    .maybeSingle();
  if (!instance) return null;

  const secrets = await getInstanceSecrets(supabase, instance.id);
  if (!secrets) return null;

  const phone = contact.phone_number;
  const remoteJid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;

  const ctx: SendContext = {
    instanceId: instance.id,
    tenantId,
    providerType: instance.provider_type as any,
    instanceInfo: {
      id: instance.id,
      instance_name: instance.instance_name,
      provider_type: instance.provider_type as any,
      instance_id_external: instance.instance_id_external,
      meta_phone_number_id: instance.meta_phone_number_id,
      skip_ura: instance.skip_ura ?? false,
      tenant_id: tenantId,
    },
    secrets: secrets as any,
    remoteJid,
    contactName: contact.name || phone,
  };

  return { ctx, contact };
}

async function processAttendance(
  supabase: any,
  att: AttendanceRow,
  correlationId: string
): Promise<void> {
  const log = (msg: string, extra?: any) =>
    console.log(`${LOG}[${correlationId}][${att.attendance_code}] ${msg}`, extra ?? "");

  try {
    const config = await getSupportConfig(supabase, att.tenant_id);

    const closeThresholdMin = config.support_auto_close_inactivity_minutes;
    const warnEnabled = config.support_send_inactivity_warning === true;
    const warnBeforeMin = config.support_inactivity_warning_before_minutes;
    const warnTemplate = config.support_inactivity_warning_template ||
      "⚠️ Por falta de interação, este atendimento será encerrado em {{minutes}} minutos. Se ainda precisar de ajuda, responda esta mensagem.";

    if (!closeThresholdMin || closeThresholdMin <= 0) {
      log("close threshold inválido — skip", { closeThresholdMin });
      return;
    }

    const lastActivityIso = getLastActivityIso(att);
    const elapsedMin = (Date.now() - new Date(lastActivityIso).getTime()) / 60000;

    // ── 1. CHECK CLOSE ────────────────────────────────────────────────────────
    if (elapsedMin >= closeThresholdMin) {
      log("threshold de fechamento atingido — encerrando", { elapsedMin, closeThresholdMin });

      const built = await buildSendContext(supabase, att.tenant_id, att.conversation_id);
      const nowIso = new Date().toISOString();

      const { error: attErr } = await supabase
        .from("support_attendances")
        .update({
          status: "closed",
          closed_at: nowIso,
          closed_reason: "inactivity",
          closure_type: "inactivity_auto",
          updated_at: nowIso,
        })
        .eq("id", att.id)
        .eq("status", "in_progress");

      if (attErr) {
        log("erro ao fechar attendance", attErr);
        return;
      }

      await supabase
        .from("whatsapp_conversations")
        .update({ status: "closed", updated_at: nowIso })
        .eq("id", att.conversation_id);

      if (built) {
        await sendAndPersistAutoMessage(
          supabase,
          built.ctx,
          att.conversation_id,
          `\u{2705} Atendimento *${att.attendance_code}* encerrado por inatividade.\n\nSe precisar de algo, é só nos enviar uma nova mensagem. \u{1F60A}`,
          {
            system: true,
            attendance_event: "closed",
            attendance_id: att.id,
            inactivity_close: true,
          }
        );
      }
      return;
    }

    // ── 2. CHECK WARNING ──────────────────────────────────────────────────────
    if (!warnEnabled) return;
    if (att.inactivity_warning_sent_at) return;

    const warnAtMin = closeThresholdMin - warnBeforeMin;
    if (warnAtMin <= 0) return;

    if (elapsedMin >= warnAtMin) {
      log("threshold de aviso atingido — enviando aviso", { elapsedMin, warnAtMin });

      const built = await buildSendContext(supabase, att.tenant_id, att.conversation_id);
      if (!built) {
        log("não foi possível construir SendContext — skip");
        return;
      }

      const message = warnTemplate.replace(/\{\{minutes\}\}/g, String(warnBeforeMin));

      await sendAndPersistAutoMessage(
        supabase,
        built.ctx,
        att.conversation_id,
        message,
        {
          system: true,
          inactivity_warning: true,
          attendance_id: att.id,
        }
      );

      await supabase
        .from("support_attendances")
        .update({ inactivity_warning_sent_at: new Date().toISOString() })
        .eq("id", att.id)
        .is("inactivity_warning_sent_at", null);
    }
  } catch (err) {
    console.error(`${LOG}[${correlationId}][${att.attendance_code}] erro:`, err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const correlationId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: rows, error } = await supabase
      .from("support_attendances")
      .select("id, attendance_code, tenant_id, conversation_id, contact_id, assigned_to, opened_at, last_customer_message_at, last_operator_message_at, inactivity_warning_sent_at")
      .eq("status", "in_progress");

    if (error) throw error;

    const attendances = (rows ?? []) as AttendanceRow[];
    console.log(`${LOG}[${correlationId}] scanning ${attendances.length} attendances`);

    await Promise.allSettled(
      attendances.map((att) => processAttendance(supabase, att, correlationId))
    );

    const elapsed = Date.now() - startedAt;
    console.log(`${LOG}[${correlationId}] done in ${elapsed}ms`);

    return new Response(
      JSON.stringify({ success: true, processed: attendances.length, elapsed_ms: elapsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`${LOG}[${correlationId}] fatal:`, err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
