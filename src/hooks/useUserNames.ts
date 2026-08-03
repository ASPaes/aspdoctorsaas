import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Nome de exibição a partir do auth user id.
 *
 * O caminho é profiles.user_id → profiles.funcionario_id → funcionarios.nome:
 * profiles NÃO tem full_name nem nome. É o mesmo caminho que a Timeline da jornada
 * já percorre.
 */
export function useUserNames(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean))).sort();

  return useQuery({
    queryKey: ["user-names", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Sem filtro de tenant de propósito: o super admin simulando outro tenant tem
      // profile no tenant dele e o próprio nome nunca resolveria. O RLS de profiles
      // continua sendo quem limita o que cada um enxerga.
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .in("user_id", ids);

      const funcIds = (profs ?? []).map((p: any) => p.funcionario_id).filter(Boolean);
      const funcMap: Record<number, string> = {};
      if (funcIds.length > 0) {
        const { data: funcs } = await supabase
          .from("funcionarios")
          .select("id, nome")
          .in("id", funcIds);
        (funcs ?? []).forEach((f: any) => { funcMap[f.id] = f.nome; });
      }

      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => {
        if (p.funcionario_id && funcMap[p.funcionario_id]) map[p.user_id] = funcMap[p.funcionario_id];
      });
      return map;
    },
  });
}
