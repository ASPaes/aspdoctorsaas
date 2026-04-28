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

// Limite de atendimentos processados por execução. Protege contra avalanches
// (ex: backlog de zumbis ou mudança de threshold para valor baixo) e respeita
// rate limits dos providers WhatsApp. Os atendimentos não processados serão
// pegos na próxima execução do cron (1 min depois).
const MAX_BATCH_SIZE = 50;

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

interface ContactRow {
  id: string;
  phone_number: string;
  name: string | null;
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
): Promise<"closed" | "warned" | "skipped" | "error"> {
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
      return "skipped";
    }

    const lastActivityIso = getLastActivityIso(att);
    const elapsedMin = (Date.now() - new Date(lastActivityIso).getTime()) / 60000;

    // ─────────────────────────────────────────────────────────────────────────
    // FLUXO COM AVISO ATIVADO
    // Sempre: AVISO → ESPERA warnBeforeMin → FECHAMENTO
    // Cliente nunca é fechado sem ter sido avisado primeiro.
    // ─────────────────────────────────────────────────────────────────────────
    if (warnEnabled) {
      if (warnBeforeMin <= 0) {
        log("warnBefore inválido com aviso ativado — skip", { warnBeforeMin });
        return "skipped";
      }

      // Caso A: aviso ainda não foi enviado
      if (!att.inactivity_warning_sent_at) {
        const warnAtMin = Math.max(0, closeThresholdMin - warnBeforeMin);

        if (elapsedMin >= warnAtMin) {
          log("enviando aviso de inatividade", { elapsedMin, warnAtMin });

          const built = await buildSendContext(supabase, att.tenant_id, att.conversation_id);
          if (!built) {
            log("não foi possível construir SendContext — skip");
            return "skipped";
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

          // Marca timestamp do aviso (idempotência: só atualiza se ainda for null)
          await supabase
            .from("support_attendances")
            .update({ inactivity_warning_sent_at: new Date().toISOString() })
            .eq("id", att.id)
            .is("inactivity_warning_sent_at", null);

          return "warned";
        }
        return "skipped"; // ainda não chegou na janela de aviso
      }

      // Caso B: aviso já foi enviado — verifica se passou warnBeforeMin desde então
      const warningSentAt = new Date(att.inactivity_warning_sent_at).getTime();
      const minSinceWarning = (Date.now() - warningSentAt) / 60000;

      if (minSinceWarning < warnBeforeMin) {
        return "skipped"; // ainda na janela de espera pós-aviso
      }

      log("janela pós-aviso expirada — encerrando", {
        minSinceWarning,
        warnBeforeMin,
      });

      return await closeAttendance(supabase, att, correlationId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FLUXO COM AVISO DESATIVADO
    // Comportamento simples: passou do threshold → fecha.
    // ─────────────────────────────────────────────────────────────────────────
    if (elapsedMin >= closeThresholdMin) {
      log("aviso desativado, threshold atingido — encerrando", {
        elapsedMin,
        closeThresholdMin,
      });
      return await closeAttendance(supabase, att, correlationId);
    }

    return "skipped";
  } catch (err) {
    console.error(`${LOG}[${correlationId}][${att.attendance_code}] erro:`, err);
    return "error";
  }
}

async function closeAttendance(
  supabase: any,
  att: AttendanceRow,
  correlationId: string
): Promise<"closed" | "skipped"> {
  const log = (msg: string, extra?: any) =>
    console.log(`${LOG}[${correlationId}][${att.attendance_code}] ${msg}`, extra ?? "");

  const built = await buildSendContext(supabase, att.tenant_id, att.conversation_id);
  const nowIso = new Date().toISOString();

  // Atualiza attendance: status closed (guard idempotência via .eq status)
  const { error: attErr, data: updRows } = await supabase
    .from("support_attendances")
    .update({
      status: "closed",
      closed_at: nowIso,
      closed_reason: "inactivity",
      closure_type: "inactivity_auto",
      updated_at: nowIso,
    })
    .eq("id", att.id)
    .eq("status", "in_progress")
    .select("id");

  if (attErr) {
    log("erro ao fechar attendance", attErr);
    return "skipped";
  }

  // Se update não afetou nenhuma linha (status já mudou em paralelo), não envia
  if (!updRows || updRows.length === 0) {
    log("attendance não estava mais in_progress — skip mensagem");
    return "skipped";
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

  return "closed";
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

    // Busca limitada — prioriza atendimentos com aviso já enviado (próximos de fechar)
    // e depois os mais antigos sem aviso (próximos de receber aviso)
    const { data: rows, error } = await supabase
      .from("support_attendances")
      .select("id, attendance_code, tenant_id, conversation_id, contact_id, assigned_to, opened_at, last_customer_message_at, last_operator_message_at, inactivity_warning_sent_at")
      .eq("status", "in_progress")
      .order("inactivity_warning_sent_at", { ascending: true, nullsFirst: false })
      .order("last_operator_message_at", { ascending: true, nullsFirst: true })
      .limit(MAX_BATCH_SIZE);

    if (error) throw error;

    const attendances = (rows ?? []) as AttendanceRow[];
    console.log(`${LOG}[${correlationId}] processing ${attendances.length} attendances (max ${MAX_BATCH_SIZE})`);

    const results = await Promise.allSettled(
      attendances.map((att) => processAttendance(supabase, att, correlationId))
    );

    const summary = { closed: 0, warned: 0, skipped: 0, error: 0 };
    for (const r of results) {
      if (r.status === "fulfilled") {
        summary[r.value] = (summary[r.value] || 0) + 1;
      } else {
        summary.error++;
      }
    }

    const elapsed = Date.now() - startedAt;
    console.log(`${LOG}[${correlationId}] done in ${elapsed}ms`, summary);

    return new Response(
      JSON.stringify({
        success: true,
        scanned: attendances.length,
        ...summary,
        elapsed_ms: elapsed,
      }),
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
