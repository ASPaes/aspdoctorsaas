import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";

interface Grupo { id: string; nome: string; nivel_base: string; ordem: number }
interface Vinculo { user_id: string; group_id: string; group_nome: string; nivel_base: string }

export const rbacGruposKeys = {
  grupos: (t: string | null) => ["rbac-grupos", t] as const,
  vinculos: (t: string | null) => ["rbac-vinculos", t] as const,
};

/** Lê grupos e vínculos de uma vez, para a tabela toda usar. */
export function useGruposDoTenant() {
  const { effectiveTenantId: tid } = useTenantFilter();

  const grupos = useQuery<Grupo[]>({
    queryKey: rbacGruposKeys.grupos(tid),
    enabled: !!tid,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("permission_groups" as any) as any)
        .select("id, nome, nivel_base, ordem").eq("tenant_id", tid).order("ordem");
      if (error) throw error;
      return (data ?? []) as Grupo[];
    },
  });

  const vinculos = useQuery<Record<string, Vinculo>>({
    queryKey: rbacGruposKeys.vinculos(tid),
    enabled: !!tid,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("rbac_get_user_groups", { p_tenant_id: tid });
      if (error) throw error;
      const m: Record<string, Vinculo> = {};
      for (const v of (data ?? []) as Vinculo[]) m[v.user_id] = v;
      return m;
    },
  });

  return { grupos: grupos.data ?? [], vinculos: vinculos.data ?? {}, isLoading: grupos.isLoading || vinculos.isLoading };
}

interface Props {
  userId: string;
  /** Desabilita a troca: é você mesmo, ou é super admin (que ignora o RBAC). */
  disabled?: boolean;
  grupos: Grupo[];
  vinculos: Record<string, Vinculo>;
}

export default function GrupoDoUsuarioSelect({ userId, disabled, grupos, vinculos }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const qc = useQueryClient();
  const atual = vinculos[userId];

  const atribuir = useMutation({
    mutationFn: async (groupId: string) => {
      const { data, error } = await (supabase.rpc as any)("rbac_assign_user_group", {
        p_user_id: userId, p_group_id: groupId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rbacGruposKeys.vinculos(tid) });
      qc.invalidateQueries({ queryKey: ["my-permissions"] });
      qc.invalidateQueries({ queryKey: ["tenant-users", tid] });
      qc.invalidateQueries({ queryKey: ["rbac-config", tid] });
      toast.success("Grupo alterado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!atual && !disabled) {
    // Acontece com papel fora dos três de origem (o `viewer` legado).
    return (
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Esta pessoa não está em nenhum grupo e por isso não tem acesso a nada.
            Escolha um grupo para liberar.
          </TooltipContent>
        </Tooltip>
        <Select onValueChange={(v) => atribuir.mutate(v)} disabled={atribuir.isPending}>
          <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Sem grupo" /></SelectTrigger>
          <SelectContent>
            {grupos.map((g) => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <Select
      value={atual?.group_id ?? ""}
      onValueChange={(v) => atribuir.mutate(v)}
      disabled={disabled || atribuir.isPending}
    >
      <SelectTrigger className="h-8 w-40"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        {grupos.map((g) => (
          <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
