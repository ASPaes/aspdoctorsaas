import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { fetchAllRows } from "@/lib/supabasePaginate";

/**
 * Aviso de e-mail novo (DEM-0461, 23/09/2026).
 *
 * "Não lido" tem UMA definição, a mesma do índice parcial criado na migration
 * `20260923205922_email_recebido_nao_lido.sql`:
 *
 *   lido_em is null · deleted_at is null · arquivado_em is null · acao <> 'ignorado'
 *
 * Arquivar conta como lido de propósito: arquivar já é "tratei disso". E
 * `ignorado` fica fora pelo mesmo motivo que fica fora da lista (propaganda
 * bloqueada, endereço que não abre ticket).
 *
 * A leitura é da EQUIPE, não de cada pessoa (decisão do Alexandre): quem abre
 * primeiro limpa a contagem para todo mundo. Quem enxerga o quê continua sendo
 * o RLS, que só dá a caixa inteira para admin/head.
 */

/** filtros comuns às duas consultas; o RLS recorta o resto */
const apenasNaoLidos = (q: any, tid: string) =>
  q
    .eq("tenant_id", tid)
    .is("lido_em", null)
    .is("deleted_at", null)
    .is("arquivado_em", null)
    .neq("acao", "ignorado");

/** quantos e-mails chegaram e ninguém abriu; alimenta o badge da barra lateral */
export function useRecebidosNaoLidos() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["emails_nao_lidos", tid],
    enabled: !!tid,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { count, error } = await apenasNaoLidos(
        (supabase.from("email_recebidos" as any) as any).select("id", { count: "exact", head: true }),
        tid!,
      );
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/**
 * Não lidos por chamado, para o ícone no card do ticket. Uma consulta só para a
 * tela inteira: a lista de tickets chega paginada e pedir por card seria uma
 * chamada por card.
 */
export function useNaoLidosPorTicket(ticketIds: string[]) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const ids = [...new Set(ticketIds.filter(Boolean))].sort();

  return useQuery({
    queryKey: ["emails_nao_lidos_ticket", tid, ids.join(",")],
    enabled: !!tid && ids.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const linhas = await fetchAllRows<{ ticket_id: string }>(() =>
        apenasNaoLidos(
          (supabase.from("email_recebidos" as any) as any).select("ticket_id"),
          tid!,
        ).in("ticket_id", ids),
      );
      const porTicket: Record<string, number> = {};
      for (const l of linhas) {
        if (l.ticket_id) porTicket[l.ticket_id] = (porTicket[l.ticket_id] ?? 0) + 1;
      }
      return porTicket;
    },
  });
}

/**
 * Marca lido. Por id (abriu o e-mail) ou por chamado (abriu o ticket, onde o
 * texto do e-mail do cliente já aparece inteiro na linha do tempo — exigir
 * clique no "Ver e-mail" deixaria o badge preso para sempre).
 *
 * Não existe policy de UPDATE em `email_recebidos`, então isto passa por RPC.
 */
export function useMarcarEmailLido() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, ticketId }: { ids?: string[]; ticketId?: string }) => {
      const { data, error } = await (supabase.rpc as any)("fn_email_recebidos_marcar_lido", {
        p_ids: ids ?? null,
        p_ticket_id: ticketId ?? null,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (afetados) => {
      if (afetados === 0) return; // nada mudou: não vale invalidar a tela toda
      queryClient.invalidateQueries({ queryKey: ["emails_nao_lidos"] });
      queryClient.invalidateQueries({ queryKey: ["emails_nao_lidos_ticket"] });
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos"] });
    },
  });
}
