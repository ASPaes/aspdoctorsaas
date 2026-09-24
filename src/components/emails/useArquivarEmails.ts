import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Arquivar e desarquivar e-mail (entrega 1 de 15/09/2026).
 *
 * Arquivado sai da lista principal e fica em "Arquivadas"; é diferente da
 * lixeira, que continua sendo só de admin. Quem pode arquivar o quê é a
 * `fn_email_arquivar` que decide, com a mesma regra de quem enxerga: operador
 * só mexe no que enviou e nas respostas a esses envios.
 *
 * `bloqueados` é o que a pessoa pediu e não aconteceu (de outra pessoa, na
 * lixeira, ou já estava no estado pedido). A tela avisa em vez de mentir.
 */
export function useArquivarEmails(tabela: "enviados" | "recebidos") {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, arquivar }: { ids: string[]; arquivar: boolean }) => {
      const { data, error } = await (supabase.rpc as any)("fn_email_arquivar", {
        p_tabela: tabela,
        p_ids: ids,
        p_arquivar: arquivar,
      });
      if (error) throw error;
      const r = (Array.isArray(data) ? data[0] : data) ?? { afetados: 0, bloqueados: 0 };
      return r as { afetados: number; bloqueados: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [tabela === "enviados" ? "emails_enviados" : "emails_recebidos"] });
      // a contagem das abas por setor não pode continuar somando o que saiu da lista
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos_contagem"] });
      // arquivar e mandar para a lixeira tiram o e-mail da conta de não lidos
      queryClient.invalidateQueries({ queryKey: ["emails_nao_lidos"] });
      queryClient.invalidateQueries({ queryKey: ["emails_nao_lidos_ticket"] });
    },
  });
}
