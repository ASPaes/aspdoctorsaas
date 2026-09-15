import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRelevantAttendance } from "../../hooks/useRelevantAttendance";
import type { ConversationWithContact } from "../../hooks/useWhatsAppConversations";
import { separarEmails, type OpcoesGeracao } from "./travaEnvioEmail";

export interface ContaDeEnvio {
  id: string;
  rotulo: string;
  email: string;
  from_name: string | null;
  is_default: boolean;
}

/**
 * Contas que aparecem no Remetente (regra do Alexandre, 15/09/2026, que
 * substitui a de 10/09): só as ligadas a quem envia, direto
 * (`email_account_usuarios`) ou por algum setor dele (`support_department_members`
 * → `email_account_setores`). "Todos os setores" é a conta ligada a cada setor.
 * Nenhuma ligada: lista vazia, e o botão mostra o aviso em vez de abrir a tela.
 * Super admin é bypass (convenção do projeto): vê todas as ativas do tenant que
 * está simulando, porque não é membro dos setores dele.
 * O setor do ASSUNTO não libera conta sozinho. A send-email confere o mesmo.
 *
 * O tenant vem da conversa, não do filtro global: com o super admin em "Todos"
 * o filtro é null e a lista sairia vazia.
 */
export const chaveContasDeEnvio = (tenantId: string | null, userId: string | null, superAdmin: boolean) =>
  ["email-chat-contas", tenantId, userId, superAdmin] as const;

export function useContasDeEnvio(tenantId: string | null, userId: string | null, superAdmin: boolean, enabled: boolean) {
  return useQuery({
    queryKey: chaveContasDeEnvio(tenantId, userId, superAdmin),
    enabled: enabled && !!tenantId && !!userId,
    staleTime: 60_000,
    queryFn: () => buscarContasDeEnvio(tenantId, userId, superAdmin),
  });
}

/** separada do hook para o botão conferir no clique, antes de abrir a tela */
export async function buscarContasDeEnvio(tenantId: string | null, userId: string | null, superAdmin: boolean) {
      const [contas, setores, usuarios, membros] = await Promise.all([
        (supabase.from("email_accounts" as any) as any)
          .select("id, rotulo, email, from_name, is_default")
          .eq("tenant_id", tenantId)
          .eq("ativo", true)
          .order("is_default", { ascending: false })
          .order("rotulo", { ascending: true }),
        (supabase.from("email_account_setores" as any) as any).select("account_id, setor_id").eq("tenant_id", tenantId),
        (supabase.from("email_account_usuarios" as any) as any).select("account_id, user_id").eq("tenant_id", tenantId),
        (supabase.from("support_department_members" as any) as any)
          .select("department_id")
          .eq("tenant_id", tenantId)
          .eq("user_id", userId)
          .eq("is_active", true),
      ]);
      for (const r of [contas, setores, usuarios, membros]) if (r.error) throw r.error;

      const todas = (contas.data ?? []) as ContaDeEnvio[];
      const meusSetores = new Set(((membros.data ?? []) as any[]).map((m) => m.department_id));
      const ligadasIds = new Set<string>([
        ...((usuarios.data ?? []) as any[]).filter((u) => u.user_id === userId).map((u) => u.account_id),
        ...((setores.data ?? []) as any[]).filter((s) => meusSetores.has(s.setor_id)).map((s) => s.account_id),
      ]);

      if (superAdmin) return { contas: todas };
      return { contas: todas.filter((c) => ligadasIds.has(c.id)) };
}

export interface SugestaoEmail {
  email: string;
  rotulo: string;
}

/**
 * Cliente da conversa e os e-mails do cadastro dele, para sugerir em
 * Destinatário, Cc e Cco.
 *
 * O cliente segue a mesma ordem do cartão de Detalhes: o do atendimento
 * relevante, depois o `metadata.cliente_id` da conversa, depois o do contato
 * (é por lá que grupo guarda o vínculo).
 */
export function useClienteDoEmail(conversation: ConversationWithContact, enabled: boolean) {
  const { attendanceId } = useRelevantAttendance(conversation.id);
  const tenantId = conversation.tenant_id;
  const contactId = (conversation as any).contact_id ?? conversation.contact?.id ?? null;
  const metadataClienteId = ((conversation.metadata || {}) as Record<string, unknown>).cliente_id as string | undefined;

  return useQuery({
    queryKey: ["email-chat-cliente", conversation.id, attendanceId, contactId, metadataClienteId ?? null],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      let atendimentoCodigo: string | null = null;
      let ticketCodigo: string | null = null;
      let departmentId: string | null = null;
      let clienteId: string | null = null;

      if (attendanceId) {
        const { data } = await supabase
          .from("support_attendances")
          .select("attendance_code, cliente_id, department_id, ticket_id")
          .eq("id", attendanceId)
          .maybeSingle();
        atendimentoCodigo = (data as any)?.attendance_code ?? null;
        departmentId = (data as any)?.department_id ?? null;
        clienteId = (data as any)?.cliente_id ?? null;
        const ticketId = (data as any)?.ticket_id ?? null;
        if (ticketId) {
          const { data: tk } = await (supabase.from("support_tickets" as any) as any)
            .select("ticket_code")
            .eq("id", ticketId)
            .maybeSingle();
          ticketCodigo = (tk as any)?.ticket_code ?? null;
        }
      }
      const atendimento = { atendimentoId: attendanceId, atendimentoCodigo, ticketCodigo, departmentId };
      if (!clienteId && metadataClienteId) clienteId = metadataClienteId;
      if (!clienteId && contactId) {
        const { data } = await (supabase.from("whatsapp_contacts" as any) as any)
          .select("cliente_id")
          .eq("id", contactId)
          .maybeSingle();
        clienteId = (data as any)?.cliente_id ?? null;
      }

      if (!clienteId) return { cliente: null, ...atendimento, sugestoes: [] as SugestaoEmail[] };

      const [cli, contatos] = await Promise.all([
        supabase
          .from("clientes")
          .select("id, codigo_sequencial, nome_fantasia, razao_social, email")
          .eq("id", clienteId)
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        (supabase.from("cliente_contatos" as any) as any)
          .select("nome, cargo, email")
          .eq("cliente_id", clienteId)
          .eq("tenant_id", tenantId)
          .not("email", "is", null),
      ]);

      const cliente = (cli.data as any) ?? null;
      const sugestoes: SugestaoEmail[] = [];
      const vistos = new Set<string>();
      const add = (email: string, rotulo: string) => {
        if (vistos.has(email)) return;
        vistos.add(email);
        sugestoes.push({ email, rotulo });
      };
      for (const e of separarEmails(cliente?.email)) add(e, "Cadastro do cliente");
      for (const c of (contatos.data ?? []) as any[]) {
        for (const e of separarEmails(c.email)) add(e, c.cargo ? `${c.nome} · ${c.cargo}` : c.nome);
      }

      return { cliente, ...atendimento, sugestoes };
    },
  });
}

export type ResultadoEnvio = { ok: true; mensagem: string } | { ok: false; mensagem: string };

/**
 * Envia pela `send-email` com origem 'chat': o envio aparece em E-mails ›
 * Enviados como Chat, ligado ao atendimento, e a resposta do cliente volta
 * registrada em Recebidos pelo token do Reply-To.
 */
export async function enviarEmailChat(input: {
  tenant_id: string;
  account_id: string;
  para: string[];
  cc: string[];
  cco: string[];
  assunto: string;
  texto: string;
  html: string;
  atendimento_id: string | null;
  cliente_id: string | null;
  department_id: string | null;
}): Promise<ResultadoEnvio> {
  const { data, error } = await supabase.functions.invoke("send-email", {
    body: {
      tenant_id: input.tenant_id,
      account_id: input.account_id,
      to: input.para,
      cc: input.cc,
      bcc: input.cco,
      subject: input.assunto,
      text: input.texto,
      html: input.html,
      origem: "chat",
      referencia_id: input.atendimento_id,
      cliente_id: input.cliente_id,
      department_id: input.department_id,
    },
  });
  if (error) {
    let mensagem = error.message || "Falha ao falar com o servidor.";
    try {
      const corpo = await (error as any)?.context?.json?.();
      if (corpo?.error || corpo?.mensagem) mensagem = String(corpo.error || corpo.mensagem);
    } catch {
      // corpo não era JSON
    }
    return { ok: false, mensagem };
  }
  const r = data as any;
  return r?.ok === true
    ? { ok: true, mensagem: r.mensagem || "E-mail enviado." }
    : { ok: false, mensagem: r?.mensagem || r?.error || "O e-mail não foi enviado." };
}

export type ResultadoGeracao =
  | { ok: true; assunto: string; corpo: string }
  | { ok: false; mensagem: string };

/**
 * Pede à `gerar-email-chat` o assunto e o corpo. Recusa esperada (teto de IA,
 * conversa vazia) vem com 200 e ok:false; erro de verdade vem com status e o
 * motivo no JSON, que o `functions.invoke` esconde atrás de "non-2xx".
 */
export async function gerarEmailChat(input: { conversation_id: string } & OpcoesGeracao): Promise<ResultadoGeracao> {
  const { data, error } = await supabase.functions.invoke("gerar-email-chat", { body: input });
  if (error) {
    let mensagem = error.message || "Falha ao falar com o servidor.";
    try {
      const corpo = await (error as any)?.context?.json?.();
      if (corpo?.mensagem || corpo?.error) mensagem = String(corpo.mensagem || corpo.error);
    } catch {
      // corpo não era JSON
    }
    return { ok: false, mensagem };
  }
  return data as ResultadoGeracao;
}
