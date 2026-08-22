import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OperadorAtendimento {
  user_id: string;
  nome: string;
  setor: string | null;
}

/**
 * Operadores que podem ser escolhidos como responsáveis pelo atendimento de um
 * cliente ou de um contato.
 *
 * Não usa a RPC `get_transfer_agents` de propósito: ela filtra por
 * `current_tenant_id()`, e a tela de cliente também é usada pelo super admin
 * simulando outro tenant. Aqui o tenant vem do filtro da tela.
 */
export function useOperadoresAtendimento(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ["operadores-atendimento", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OperadorAtendimento[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, status, funcionario:funcionario_id(nome, department_id)")
        .eq("tenant_id", tenantId!)
        .eq("status", "ativo");
      if (error) throw error;

      const { data: depts } = await supabase
        .from("support_departments")
        .select("id, name")
        .eq("tenant_id", tenantId!);
      const deptName = new Map((depts ?? []).map((d: any) => [d.id, d.name as string]));

      return ((data ?? []) as any[])
        .map((p) => ({
          user_id: p.user_id as string,
          nome: (p.funcionario?.nome as string) ?? "Sem nome",
          setor: p.funcionario?.department_id ? deptName.get(p.funcionario.department_id) ?? null : null,
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    },
  });
}
