import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * Números dos cards da tela inicial do telefone.
 *
 * ⚠️ NÃO usa `whatsapp_pill_counts`. Aquela RPC é a consulta mais cara do
 * sistema — medida em 22/09/2026 em 5.490 chamadas/hora a 198ms, ~30% de um
 * núcleo só para os números das abas do chat. Pendurá-la na tela de abertura,
 * que todo mundo vê a cada vez que abre o app, multiplicaria isso. Aqui cada
 * número é um `count` com `head: true`: o servidor devolve só o total, sem
 * trafegar linha nenhuma.
 *
 * Cada contagem é uma query própria de propósito — uma falhar (RLS, tabela que o
 * tenant não usa) não pode derrubar as outras, e a tela tem que abrir mesmo sem
 * número.
 */

const CADENCIA_MS = 60_000;

function useContagem(chave: string, tid: string | null, consulta: () => any) {
  return useQuery({
    queryKey: ["mobile-home", chave, tid],
    enabled: !!tid,
    // A tela inicial é de passagem: a pessoa abre e entra num módulo. Um minuto
    // de validade evita refazer a conta a cada ida e volta pelo gesto de voltar.
    staleTime: CADENCIA_MS,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { count, error } = await consulta();
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useContadoresDoMobile() {
  const { effectiveTenantId: tid } = useTenantFilter();

  const chat = useContagem("chat", tid, () =>
    (supabase.from("whatsapp_conversations" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .gt("unread_count", 0)
  );

  // Aberto = sem conclusão e não apagado. É o que a tabela sabe dizer sem
  // depender da configuração de status de cada tenant (`ticket_statuses` é por
  // tenant, e "aberto" não é um valor fixo lá).
  const tickets = useContagem("tickets", tid, () =>
    (supabase.from("support_tickets" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .is("concluido_em", null)
      .is("deleted_at", null)
  );

  const implantacao = useContagem("implantacao", tid, () =>
    (supabase.from("onboarding_journeys" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .is("concluido_em", null)
  );

  const emails = useContagem("emails", tid, () =>
    (supabase.from("email_recebidos" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .is("lido_em", null)
  );

  return {
    chat: chat.data ?? 0,
    tickets: tickets.data ?? 0,
    implantacao: implantacao.data ?? 0,
    emails: emails.data ?? 0,
    carregando: chat.isLoading || tickets.isLoading || implantacao.isLoading || emails.isLoading,
  };
}
