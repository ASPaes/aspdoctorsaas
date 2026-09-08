// send-assignment-greeting — DEM-0195 (Athuz).
//
// Manda a mensagem padrão do tenant para o CLIENTE no momento em que o
// atendimento que ele iniciou ganha um dono.
//
// Chamada por pg_net, a partir das triggers trg_zz_assignment_greeting_{ins,upd}
// em support_attendances. Nunca é chamada pelo frontend.
//
// A regra de quem recebe está na trigger (origem do atendimento). Aqui os gates
// são de reconferência: entre o disparo e a execução o atendimento pode ter sido
// encerrado, devolvido para a fila ou o operador já pode ter escrito.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getInstanceSecrets } from "../_shared/providers/index.ts";
import { sendAndPersistAutoMessage } from "../_shared/message-processor.ts";
import { SendContext } from "../_shared/message-types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOG = "[send-assignment-greeting]";

// Espelha a lista da trigger. Duplicado de propósito: se um dia divergirem, a
// trigger é o portão que vale e este é o que aparece no log.
const ORIGENS_DO_CLIENTE = ["customer", "out_of_hours", "billing_automation"];

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Nome do operador: profiles.funcionario_id → funcionarios.nome.
// profiles não tem full_name/nome neste projeto.
async function nomeDoOperador(supabase: any, userId: string): Promise<string> {
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("funcionario_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!prof?.funcionario_id) return "";
    const { data: func } = await supabase
      .from("funcionarios")
      .select("nome")
      .eq("id", prof.funcionario_id)
      .maybeSingle();
    return (func?.nome || "").trim();
  } catch {
    return "";
  }
}

// Primeiro nome só — "Olá, aqui é o Vinicius Melo da Athuz" soa formulário.
function primeiroNome(nome: string): string {
  return (nome || "").trim().split(/\s+/)[0] || "";
}

function renderTemplate(
  template: string,
  vars: { nome: string; operador: string; atendimento: string; setor: string },
): string {
  return template
    .replace(/\{nome\}/gi, vars.nome)
    .replace(/\{operador\}/gi, vars.operador)
    .replace(/\{atendimento\}/gi, vars.atendimento)
    .replace(/\{setor\}/gi, vars.setor)
    // Placeholder sem valor deixa espaço duplo e vírgula solta ("Olá , tudo bem").
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

async function buildSendContext(
  supabase: any,
  tenantId: string,
  conversationId: string,
): Promise<{ ctx: SendContext; contactName: string } | null> {
  const { data: conv } = await supabase
    .from("whatsapp_conversations")
    .select("id, instance_id, contact_id, is_group, group_jid")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv || conv.is_group === true || !conv.instance_id) return null;

  const { data: contact } = await supabase
    .from("whatsapp_contacts")
    .select("id, phone_number, name")
    .eq("id", conv.contact_id)
    .maybeSingle();
  if (!contact?.phone_number) return null;

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select(
      "id, instance_name, instance_id_external, provider_type, meta_phone_number_id, skip_ura, tenant_id",
    )
    .eq("id", conv.instance_id)
    .maybeSingle();
  if (!instance) return null;

  const secrets = await getInstanceSecrets(supabase, instance.id);
  if (!secrets) return null;

  const phone = contact.phone_number;
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
    } as any,
    secrets: secrets as any,
    remoteJid: phone.includes("@") ? phone : `${phone}@s.whatsapp.net`,
    contactName: contact.name || phone,
  };

  return { ctx, contactName: contact.name || "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const attendanceId = body?.attendance_id;
  if (!attendanceId || typeof attendanceId !== "string") {
    return json({ ok: false, error: "attendance_id_required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: att } = await supabase
      .from("support_attendances")
      .select(
        "id, tenant_id, conversation_id, attendance_code, assigned_to, status, created_from, is_group, department_id, msg_agent_count, first_response_at",
      )
      .eq("id", attendanceId)
      .maybeSingle();

    if (!att) return json({ ok: true, skipped: "attendance_not_found" });
    if (att.is_group === true) return json({ ok: true, skipped: "group" });
    if (!att.conversation_id) return json({ ok: true, skipped: "no_conversation" });
    if (!ORIGENS_DO_CLIENTE.includes(att.created_from || "")) {
      return json({ ok: true, skipped: "origem_nao_e_do_cliente", created_from: att.created_from });
    }
    if (!att.assigned_to || att.status !== "in_progress") {
      return json({ ok: true, skipped: "sem_dono_ou_nao_in_progress", status: att.status });
    }
    // O operador já falou: a saudação chegaria DEPOIS da mensagem dele.
    if ((att.msg_agent_count ?? 0) > 0 || att.first_response_at) {
      return json({ ok: true, skipped: "operador_ja_respondeu" });
    }

    const { data: cfg } = await supabase
      .from("configuracoes")
      .select("support_assignment_greeting_enabled, support_assignment_greeting_template")
      .eq("tenant_id", att.tenant_id)
      .maybeSingle();

    const template = (cfg?.support_assignment_greeting_template || "").trim();
    if (cfg?.support_assignment_greeting_enabled !== true || !template) {
      return json({ ok: true, skipped: "desligado_ou_sem_template" });
    }

    // Reserva atômica: só a primeira chamada de cada atendimento passa daqui.
    const { data: claimed, error: claimErr } = await supabase.rpc(
      "try_claim_assignment_greeting",
      { p_attendance_id: att.id },
    );
    if (claimErr) {
      console.error(`${LOG} erro na reserva:`, claimErr.message);
      return json({ ok: false, error: "claim_failed" }, 500);
    }
    if (claimed !== true) return json({ ok: true, skipped: "ja_enviado" });

    const built = await buildSendContext(supabase, att.tenant_id, att.conversation_id);
    if (!built) {
      await supabase.rpc("mark_assignment_greeting_result", {
        p_attendance_id: att.id,
        p_status: "error",
        p_error: "send_context_indisponivel",
      });
      console.error(`${LOG} sem SendContext para att ${att.id}`);
      return json({ ok: false, error: "send_context_unavailable" }, 500);
    }

    let setor = "";
    if (att.department_id) {
      const { data: dept } = await supabase
        .from("support_departments")
        .select("name")
        .eq("id", att.department_id)
        .maybeSingle();
      setor = dept?.name || "";
    }

    const texto = renderTemplate(template, {
      nome: primeiroNome(built.contactName),
      operador: primeiroNome(await nomeDoOperador(supabase, att.assigned_to)),
      atendimento: att.attendance_code || "",
      setor,
    });

    if (!texto) {
      await supabase.rpc("mark_assignment_greeting_result", {
        p_attendance_id: att.id,
        p_status: "error",
        p_error: "template_vazio_apos_render",
      });
      return json({ ok: true, skipped: "texto_vazio" });
    }

    await sendAndPersistAutoMessage(supabase, built.ctx, att.conversation_id, texto, {
      auto: true,
      assignment_greeting: true,
      attendance_id: att.id,
    });

    await supabase.rpc("mark_assignment_greeting_result", {
      p_attendance_id: att.id,
      p_status: "sent",
      p_error: null,
    });

    console.log(`${LOG} enviada para att ${att.id} (${att.attendance_code})`);
    return json({ ok: true, sent: true, attendance_id: att.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} erro:`, msg);
    try {
      await supabase.rpc("mark_assignment_greeting_result", {
        p_attendance_id: attendanceId,
        p_status: "error",
        p_error: msg.slice(0, 500),
      });
    } catch { /* registro é secundário */ }
    return json({ ok: false, error: msg }, 500);
  }
});
