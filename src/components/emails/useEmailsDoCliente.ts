import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { separarEmails } from "@/components/whatsapp/chat/email/travaEnvioEmail";

export interface SugestaoDoCliente {
  email: string;
  rotulo: string;
}

/**
 * E-mails de um cliente para o "Escrever e-mail" avulso (29/09/2026): o do
 * cadastro primeiro, depois os dos contatos. É a mesma lista que o chat sugere,
 * só que a partir do cliente escolhido na tela e não da conversa.
 */
export function useEmailsDoCliente(tenantId: string | null, clienteId: string | null) {
  return useQuery({
    queryKey: ["email-avulso-cliente", tenantId, clienteId],
    enabled: !!tenantId && !!clienteId,
    staleTime: 60_000,
    queryFn: async (): Promise<SugestaoDoCliente[]> => {
      const [cli, contatos] = await Promise.all([
        supabase.from("clientes").select("email").eq("id", clienteId!).eq("tenant_id", tenantId!).maybeSingle(),
        (supabase.from("cliente_contatos" as any) as any)
          .select("nome, cargo, email")
          .eq("cliente_id", clienteId)
          .eq("tenant_id", tenantId)
          .not("email", "is", null),
      ]);
      if (cli.error) throw cli.error;
      if (contatos.error) throw contatos.error;

      const lista: SugestaoDoCliente[] = [];
      const vistos = new Set<string>();
      const add = (email: string, rotulo: string) => {
        const chave = email.toLowerCase();
        if (vistos.has(chave)) return;
        vistos.add(chave);
        lista.push({ email, rotulo });
      };
      for (const e of separarEmails((cli.data as any)?.email)) add(e, "Cadastro do cliente");
      for (const c of (contatos.data ?? []) as any[]) {
        for (const e of separarEmails(c.email)) add(e, c.cargo ? `${c.nome} · ${c.cargo}` : c.nome);
      }
      return lista;
    },
  });
}
