import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { separarEmails } from "@/components/whatsapp/chat/email/travaEnvioEmail";
import type { SugestaoEmail } from "@/components/whatsapp/chat/email/useEmailChatDados";

/**
 * Dados da tela "Enviar e-mail" aberta pelo TICKET (17/09/2026): o chamado, o
 * cliente dele, os e-mails sugeridos e quantos chats estão ligados ao ticket.
 *
 * O destinatário sai do contato do ticket e da ficha do cliente, na mesma
 * ordem da tela do chat: contato do chamado primeiro, depois o cadastro.
 */
export interface DadosEmailTicket {
  ticket: {
    id: string;
    tenant_id: string;
    ticket_code: string | null;
    assunto: string | null;
    cliente_id: string | null;
    department_id: string | null;
  } | null;
  cliente: { id: string; codigo_sequencial: number | null; nome_fantasia: string | null; razao_social: string | null } | null;
  ufCliente: string | null;
  sugestoes: SugestaoEmail[];
  /** chats de WhatsApp ligados a este chamado */
  chats: number;
  /** o contato do chamado, para o campo "Nome do contato" das macros */
  contatoNome: string | null;
}

export function useEmailDoTicket(ticketId: string | null, enabled: boolean) {
  return useQuery<DadosEmailTicket>({
    queryKey: ["email-ticket-dados", ticketId],
    enabled: enabled && !!ticketId,
    staleTime: 60_000,
    queryFn: async () => {
      const vazio: DadosEmailTicket = { ticket: null, cliente: null, ufCliente: null, sugestoes: [], chats: 0, contatoNome: null };
      if (!ticketId) return vazio;

      const { data: t } = await (supabase.from("support_tickets" as any) as any)
        .select("id, tenant_id, ticket_code, assunto, cliente_id, department_id, cliente_contato_id")
        .eq("id", ticketId)
        .maybeSingle();
      if (!t) return vazio;

      const ticket = {
        id: t.id,
        tenant_id: t.tenant_id,
        ticket_code: t.ticket_code ?? null,
        assunto: t.assunto ?? null,
        cliente_id: t.cliente_id ?? null,
        department_id: t.department_id ?? null,
      };

      const [chatsRes, cliRes, contatosRes, contatoDoTicketRes] = await Promise.all([
        (supabase.from("support_attendances" as any) as any)
          .select("id", { count: "exact", head: true })
          .eq("ticket_id", ticketId),
        t.cliente_id
          ? (supabase.from("clientes" as any) as any)
              .select("id, codigo_sequencial, nome_fantasia, razao_social, email, estados(sigla)")
              .eq("id", t.cliente_id)
              .eq("tenant_id", t.tenant_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        t.cliente_id
          ? (supabase.from("cliente_contatos" as any) as any)
              .select("nome, cargo, email")
              .eq("cliente_id", t.cliente_id)
              .eq("tenant_id", t.tenant_id)
              .not("email", "is", null)
          : Promise.resolve({ data: [] }),
        t.cliente_contato_id
          ? (supabase.from("cliente_contatos" as any) as any)
              .select("nome, cargo, email")
              .eq("id", t.cliente_contato_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const cliente = (cliRes as any)?.data ?? null;
      const sugestoes: SugestaoEmail[] = [];
      const vistos = new Set<string>();
      const add = (email: string, rotulo: string) => {
        const limpo = email.trim().toLowerCase();
        if (!limpo || vistos.has(limpo)) return;
        vistos.add(limpo);
        sugestoes.push({ email: limpo, rotulo });
      };

      // o contato do chamado vem primeiro: é com ele que a equipe está falando
      const doTicket = (contatoDoTicketRes as any)?.data;
      if (doTicket) {
        for (const e of separarEmails(doTicket.email)) add(e, `${doTicket.nome} · contato do chamado`);
      }
      for (const e of separarEmails(cliente?.email)) add(e, "Cadastro do cliente");
      for (const c of ((contatosRes as any)?.data ?? []) as any[]) {
        for (const e of separarEmails(c.email)) add(e, c.cargo ? `${c.nome} · ${c.cargo}` : c.nome);
      }

      return {
        ticket,
        cliente: cliente
          ? {
              id: cliente.id,
              codigo_sequencial: cliente.codigo_sequencial ?? null,
              nome_fantasia: cliente.nome_fantasia ?? null,
              razao_social: cliente.razao_social ?? null,
            }
          : null,
        ufCliente: cliente?.estados?.sigla ?? null,
        sugestoes,
        chats: (chatsRes as any)?.count ?? 0,
        contatoNome: (doTicket?.nome as string | undefined)?.trim() || null,
      };
    },
  });
}
