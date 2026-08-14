import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getSupportConfig, SupportConfig } from "../_shared/support-config.ts";
import { sendAndPersistAutoMessage } from "../_shared/message-processor.ts";
import { getInstanceSecrets } from "../_shared/providers/index.ts";
import { SendContext } from "../_shared/message-types.ts";
import { evaluateBusinessHours, BusinessHoursEvaluation, tzTimeStr } from "../_shared/business-hours.ts";
import { decideInactivityAction } from "../_shared/inactivity-decision.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOG = "[check-inactivity-timeout]";

// ─── Limites de execução ────────────────────────────────────────────────────
// MAX_SENDS_PER_RUN: teto de MENSAGENS (aviso + encerramento) disparadas por
//   execução. Protege os tenants de uma rajada quando há backlog acumulado:
//   a AVALIAÇÃO roda em todos os vencidos, mas só MAX_SENDS_PER_RUN disparam
//   por ciclo; o restante é pego nos ciclos seguintes (cron a cada 2 min).
// TIME_BUDGET_MS: para o loop com folga antes do timeout de 30s do cron.
const MAX_SENDS_PER_RUN = 20;
const TIME_BUDGET_MS = 22000;


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
  scheduled_until: string | null;
  // novos vindos da RPC:
  department_id: string | null;
  instance_id: string | null;
  effective_close_min: number;
  effective_warn_before: number;
  warn_enabled: boolean;
  needs_warn: boolean;
  needs_close: boolean;
  // fim de expediente:
  inactivity_eod_close_at: string | null;
  eod_enabled: boolean;
  // grupo: o destino do envio é o JID @g.us da conversa, não o telefone do contato
  is_group: boolean;
  group_jid: string | null;
}


interface ContactRow {
  id: string;
  phone_number: string;
  name: string | null;
}

// Resultado de processAttendance. "*_skipped_limit" = decisão dizia enviar,
// mas o teto de envios do ciclo já estourou → fica pro próximo ciclo.
type ProcessResult =
  | "closed"
  | "warned"
  | "skipped"
  | "warn_skipped_limit"
  | "close_skipped_limit"
  | "eod_warned"
  | "eod_closed"
  | "eod_scheduled"
  | "error";

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
    .select("id, instance_id, contact_id, is_group, group_jid")
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
  // Grupo: o destino é o JID @g.us da conversa. O contato do grupo guarda
  // phone_number só com dígitos, então a regra do 1:1 montaria
  // "120363...@s.whatsapp.net" e o aviso/encerramento sairia para o vazio.
  const isGroup = conv.is_group === true;
  if (isGroup && !conv.group_jid) {
    console.error(`${LOG} conversa de grupo ${conversationId} sem group_jid — sem destino para enviar`);
    return null;
  }
  const remoteJid = isGroup
    ? conv.group_jid!
    : (phone.includes("@") ? phone : `${phone}@s.whatsapp.net`);

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

// Guards que barram QUALQUER ação automática sobre o atendimento.
// Rodam só quando o motor decidiu agir: a fila agora traz também atendimentos ainda
// não vencidos (candidatos à antecipação de fim de expediente), e checar todos eles
// a cada ciclo custaria 2 queries por linha sem nenhuma ação em troca.
async function passesActionGuards(
  supabase: any,
  att: AttendanceRow,
  log: (msg: string, extra?: any) => void,
): Promise<boolean> {
  // Atendimento aguardando avaliação CSAT — não encerrar por inatividade.
  // O ciclo pós-CSAT (nota e encerramento) é do check-csat-timeout.
  const { data: pendingCsat } = await supabase
    .from("support_csat")
    .select("id")
    .eq("attendance_id", att.id)
    .in("status", ["pending", "awaiting_reason"])
    .limit(1)
    .maybeSingle();
  if (pendingCsat) {
    log("CSAT pendente — skip (csat-timeout cuida)");
    return false;
  }

  // "Sem regras do sistema": contato com rules_disabled=true → nada automático.
  const { data: contactRules } = await supabase
    .from("whatsapp_contacts")
    .select("rules_disabled")
    .eq("id", att.contact_id)
    .maybeSingle();
  if (contactRules?.rules_disabled === true) {
    log("rules_disabled=true no contato — skip");
    return false;
  }

  return true;
}

// canSend(): retorna true se ainda há orçamento de envio no ciclo.
// Recebe um objeto-contador por referência para que o incremento seja visível
// ao chamador (o loop principal), garantindo o teto global por execução.
async function processAttendance(
  supabase: any,
  att: AttendanceRow,
  correlationId: string,
  budget: { sends: number },
  configCache: Map<string, SupportConfig>,
  bhCache: Map<string, BusinessHoursEvaluation>,
): Promise<ProcessResult> {
  const log = (msg: string, extra?: any) =>
    console.log(`${LOG}[${correlationId}][${att.attendance_code}] ${msg}`, extra ?? "");

  try {
    let config = configCache.get(att.tenant_id);
    if (!config) {
      config = await getSupportConfig(supabase, att.tenant_id);
      configCache.set(att.tenant_id, config);
    }
    const tz = config.business_hours_timezone || "America/Sao_Paulo";

    // ─── Horário comercial: dentro/fora AGORA + fim do expediente de hoje ─────
    // Fail-safe: se a checagem falhar, assume "fora" e pula (não pune cliente).
    let bh: BusinessHoursEvaluation | null = null;
    if (config.business_hours_enabled && att.instance_id) {
      const minuteBucket = Math.floor(Date.now() / 60000);
      const bhKey = `${att.tenant_id}:${att.department_id ?? 'none'}:${minuteBucket}`;
      bh = bhCache.get(bhKey) ?? null;
      if (!bh) {
        try {
          bh = await evaluateBusinessHours(
            supabase,
            att.conversation_id,
            att.instance_id,
            att.tenant_id,
            config,
          );
          bhCache.set(bhKey, bh);
        } catch (err) {
          console.error(
            `${LOG}[${correlationId}][${att.attendance_code}] evaluateBusinessHours falhou — fail-safe: skip`,
            err,
          );
          return "skipped";
        }
      }
    }

    // A regra mora em _shared/inactivity-decision.ts (função pura, coberta por teste).
    // Aqui só executamos o que ela decidir.
    const action = decideInactivityAction({
      now: new Date(),
      lastActivityAt: new Date(getLastActivityIso(att)),
      warningSentAt: att.inactivity_warning_sent_at ? new Date(att.inactivity_warning_sent_at) : null,
      eodCloseAt: att.inactivity_eod_close_at ? new Date(att.inactivity_eod_close_at) : null,
      closeThresholdMin: att.effective_close_min,
      warnBeforeMin: att.effective_warn_before,
      warnEnabled: att.warn_enabled,
      insideBusinessHours: bh ? bh.inside : null,
      dayEndAt: bh?.dayEndAt ?? null,
      eodEnabled: att.eod_enabled && config.support_inactivity_eod_enabled !== false,
    });

    if (action.kind === "none") return "skipped";

    // Vamos agir: a flag de "aberto fora do expediente" está obsoleta.
    if (bh?.inside) {
      await supabase
        .from("whatsapp_conversations")
        .update({
          opened_out_of_hours: false,
          out_of_hours_cleared_at: new Date().toISOString(),
        })
        .eq("id", att.conversation_id)
        .eq("opened_out_of_hours", true);
    }

    // Agendar não manda mensagem: não consome o teto de envios do ciclo.
    if (action.kind === "eod_schedule") {
      if (!(await passesActionGuards(supabase, att, log))) return "skipped";
      await supabase
        .from("support_attendances")
        .update({ inactivity_eod_close_at: action.closeAt.toISOString() })
        .eq("id", att.id)
        .is("inactivity_eod_close_at", null);
      log("encerramento agendado para o fim do expediente", {
        fim: tzTimeStr(action.closeAt, tz),
      });
      return "eod_scheduled";
    }

    // Daqui pra baixo tudo envia mensagem → respeita o teto do ciclo.
    if (budget.sends >= MAX_SENDS_PER_RUN) {
      log("teto de envios atingido — adiando pro próximo ciclo", { acao: action.kind });
      return action.kind === "warn" || action.kind === "eod_warn"
        ? "warn_skipped_limit"
        : "close_skipped_limit";
    }
    if (!(await passesActionGuards(supabase, att, log))) return "skipped";

    // ─── ENCERRAMENTO AGENDADO PARA O FIM DO EXPEDIENTE ───────────────────────
    if (action.kind === "eod_close") {
      const endLabel = tzTimeStr(action.closeAt, tz);
      const message = (config.support_inactivity_eod_close_template || "")
        .replace(/\{\{end\}\}/g, endLabel)
        .replace(/\{\{code\}\}/g, att.attendance_code);

      log("fim de expediente — encerrando (agendado)", { fim: endLabel });
      const r = await closeAttendance(supabase, att, correlationId, message);
      if (r !== "closed") return r;
      budget.sends++;
      return "eod_closed";
    }

    // ─── ENCERRAMENTO COMUM ───────────────────────────────────────────────────
    if (action.kind === "close") {
      log("prazo de inatividade atingido — encerrando");
      const r = await closeAttendance(supabase, att, correlationId);
      if (r === "closed") budget.sends++;
      return r;
    }

    // ─── AVISOS (comum e de fim de expediente) ────────────────────────────────
    const built = await buildSendContext(supabase, att.tenant_id, att.conversation_id);
    if (!built) {
      log("não foi possível construir SendContext — skip");
      return "skipped";
    }

    if (action.kind === "eod_warn") {
      const endLabel = tzTimeStr(action.closeAt, tz);
      const message = (config.support_inactivity_eod_warning_template || "")
        .replace(/\{\{end\}\}/g, endLabel)
        .replace(/\{\{code\}\}/g, att.attendance_code);

      await sendAndPersistAutoMessage(
        supabase, built.ctx, att.conversation_id, message,
        { system: true, inactivity_warning: true, inactivity_eod: true, attendance_id: att.id }
      );
      budget.sends++;

      // Aviso e agendamento gravados juntos: o encerramento já fica garantido para o
      // fim do expediente, mesmo que o ciclo seguinte caia fora do horário.
      await supabase
        .from("support_attendances")
        .update({
          inactivity_warning_sent_at: new Date().toISOString(),
          inactivity_eod_close_at: action.closeAt.toISOString(),
        })
        .eq("id", att.id)
        .is("inactivity_warning_sent_at", null);

      log("aviso de fim de expediente enviado", { fim: endLabel, sendsNoCiclo: budget.sends });
      return "eod_warned";
    }

    // action.kind === "warn"
    const warnBeforeMin = Math.min(att.effective_warn_before, att.effective_close_min);
    // Grupo tem texto próprio (espelho do 1:1, mesma variável {{minutes}}).
    const warnTemplate = (att.is_group
      ? config.support_group_inactivity_warning_template
      : config.support_inactivity_warning_template) ||
      "⚠️ Por falta de interação, este atendimento será encerrado em {{minutes}} minutos. Se ainda precisar de ajuda, responda esta mensagem.";
    const message = warnTemplate.replace(/\{\{minutes\}\}/g, String(warnBeforeMin));

    await sendAndPersistAutoMessage(
      supabase, built.ctx, att.conversation_id, message,
      { system: true, inactivity_warning: true, attendance_id: att.id }
    );
    budget.sends++;

    await supabase
      .from("support_attendances")
      .update({ inactivity_warning_sent_at: new Date().toISOString() })
      .eq("id", att.id)
      .is("inactivity_warning_sent_at", null);

    log("aviso enviado", { warnBeforeMin, sendsNoCiclo: budget.sends });
    return "warned";

  } catch (err) {
    console.error(`${LOG}[${correlationId}][${att.attendance_code}] erro:`, err);
    return "error";
  }
}

async function closeAttendance(
  supabase: any,
  att: AttendanceRow,
  correlationId: string,
  // Mensagem ao cliente. Omitida = encerramento por inatividade comum.
  customMessage?: string,
): Promise<"closed" | "skipped"> {
  const log = (msg: string, extra?: any) =>
    console.log(`${LOG}[${correlationId}][${att.attendance_code}] ${msg}`, extra ?? "");

  const built = await buildSendContext(supabase, att.tenant_id, att.conversation_id);

  const { data: result, error: rpcErr } = await supabase
    .rpc("fn_close_attendance_atomic", {
      p_attendance_id: att.id,
      p_closed_reason: "inactivity",
      p_closure_type: "inactivity_auto",
    });

  if (rpcErr) {
    log("erro na RPC fn_close_attendance_atomic", rpcErr);
    return "skipped";
  }
  if (!result?.success) {
    log("RPC retornou falha", result);
    return "skipped";
  }

  if (built) {
    const message = customMessage?.trim()
      ? customMessage
      : `\u{2705} Atendimento *${att.attendance_code}* encerrado por inatividade.\n\nSe precisar de algo, \u00e9 s\u00f3 nos enviar uma nova mensagem. \u{1F60A}`;
    await sendAndPersistAutoMessage(
      supabase, built.ctx, att.conversation_id, message,
      {
        system: true, attendance_event: "closed", attendance_id: att.id,
        inactivity_close: true, ...(customMessage ? { inactivity_eod: true } : {}),
      }
    );
  }

  return "closed";
}

// ─── Autoatendimento da URA ──────────────────────────────────────────────────
// Passada independente da inatividade comum. Quem escolheu uma opção da URA que
// só responde (ex.: o link do "Indique e ganhe") fica em ura_state='self_service':
// sem setor, sem atendente, fora da fila. Se voltar a falar, o motor devolve o
// menu. Se sumir, quem encerra é aqui.
//
// A RPC fecha atendimento E conversa numa transação e devolve o que já fechou.
// A despedida sai depois: se o envio falhar, o cliente fica sem a mensagem, mas
// o estado no banco continua íntegro. A ordem inversa (enviar e depois fechar)
// repetiria a despedida a cada ciclo se a função morresse no meio.
async function closeUraSelfService(
  supabase: any,
  correlationId: string,
  budget: { sends: number },
): Promise<{ closed: number; sem_despedida: number }> {
  const { data: rows, error } = await supabase
    .rpc("fn_close_ura_selfservice", { p_limit: 20 });

  if (error) {
    console.error(`${LOG}[${correlationId}] erro na RPC fn_close_ura_selfservice:`, error);
    return { closed: 0, sem_despedida: 0 };
  }

  let closed = 0;
  let semDespedida = 0;

  for (const r of (rows ?? []) as any[]) {
    closed++;
    if (budget.sends >= MAX_SENDS_PER_RUN) { semDespedida++; continue; }

    const built = await buildSendContext(supabase, r.tenant_id, r.conversation_id);
    if (!built) { semDespedida++; continue; }

    const message = (r.mensagem || "").trim()
      || `\u{2705} Atendimento *${r.attendance_code}* encerrado.\n\nSe precisar de algo, é só nos enviar uma nova mensagem. \u{1F60A}`;

    await sendAndPersistAutoMessage(
      supabase, built.ctx, r.conversation_id, message,
      {
        system: true, attendance_event: "closed", attendance_id: r.attendance_id,
        ura_self_service_close: true,
      },
    );
    budget.sends++;
  }

  return { closed, sem_despedida: semDespedida };
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

    const budget = { sends: 0 };
    const configCache = new Map<string, SupportConfig>();
    const bhCache = new Map<string, BusinessHoursEvaluation>();
    const summary: Record<ProcessResult, number> = {
      closed: 0, warned: 0, skipped: 0,
      warn_skipped_limit: 0, close_skipped_limit: 0,
      eod_warned: 0, eod_closed: 0, eod_scheduled: 0, error: 0,
    };

    let scanned = 0;
    let stopReason = "fim_da_fila";

    // Autoatendimento primeiro: são poucos por dia e vivem minutos. Rodando
    // antes, o teto de envios do ciclo não os deixa sem a despedida — e o
    // p_limit de 20 impede que eles engulam o orçamento da inatividade.
    const ura = await closeUraSelfService(supabase, correlationId, budget);

    // Nova RPC pré-filtra atendimentos que precisam ação imediata (needs_warn/needs_close),
    // com overrides setor>instância>global já resolvidos. Reduz drasticamente o volume.
    const { data: rows, error } = await supabase
      .rpc("get_inactive_attendances_to_process", { p_limit: 200 });
    if (error) throw error;

    const attendances = (rows ?? []) as AttendanceRow[];
    scanned = attendances.length;

    // Processa SEQUENCIALMENTE: o teto de envios (budget.sends) precisa ser checado
    // e incrementado de forma serial pra evitar rajadas.
    for (const att of attendances) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { stopReason = "orcamento_tempo"; break; }
      let res: ProcessResult;
      try {
        res = await processAttendance(supabase, att, correlationId, budget, configCache, bhCache);
      } catch {
        res = "error";
      }
      summary[res] = (summary[res] || 0) + 1;
      if (budget.sends >= MAX_SENDS_PER_RUN) { stopReason = "teto_envios"; break; }
    }

    const elapsed = Date.now() - startedAt;
    console.log(`${LOG}[${correlationId}] done`, {
      scanned, sends: budget.sends, stopReason, elapsed_ms: elapsed, ...summary,
      ura_self_service_closed: ura.closed, ura_self_service_sem_despedida: ura.sem_despedida,
    });

    return new Response(
      JSON.stringify({
        success: true, scanned, sends: budget.sends, stopReason, ...summary,
        ura_self_service_closed: ura.closed, ura_self_service_sem_despedida: ura.sem_despedida,
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
