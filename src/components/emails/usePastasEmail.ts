import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * Pastas das telas E-mails (entrega 2, 15/09/2026).
 *
 * Dois tipos, decididos pelo Alexandre: pasta de SETOR, que todo o setor usa, e
 * pasta PESSOAL, que só quem criou vê. Quem filtra a lista é o RLS de
 * email_pastas; a tela só mostra o que voltou.
 *
 * Escrita sempre pelas RPCs (fn_email_pasta_salvar / _excluir / fn_email_mover_pasta):
 * a tabela só tem select para o usuário logado.
 */
export interface PastaEmail {
  id: string;
  nome: string;
  cor: string;
  escopo: "setor" | "pessoal";
  department_id: string | null;
  criado_por: string | null;
  support_departments?: { name: string } | null;
}

export const COR_PADRAO = "#64748B";

/** as cores que a tela oferece; qualquer outra o banco recusa pelo formato */
export const CORES_PASTA = [
  { valor: "#0EA5E9", nome: "Azul" },
  { valor: "#22C55E", nome: "Verde" },
  { valor: "#F59E0B", nome: "Laranja" },
  { valor: "#A855F7", nome: "Roxo" },
  { valor: "#EF4444", nome: "Vermelho" },
  { valor: COR_PADRAO, nome: "Cinza" },
];

export function usePastasEmail() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["email_pastas", tid],
    enabled: !!tid,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("email_pastas" as any) as any)
        .select("id, nome, cor, escopo, department_id, criado_por, support_departments(name)")
        .eq("tenant_id", tid)
        .order("escopo", { ascending: true })
        .order("nome", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PastaEmail[];
    },
  });
}

/** setores em que a pessoa está: são os que ela pode usar numa pasta de setor */
export function useMeusSetores() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user, profile } = useAuth();
  const mandaNoTenant = profile?.is_super_admin === true || profile?.role === "admin" || profile?.role === "head";

  return useQuery({
    queryKey: ["email_pastas_meus_setores", tid, user?.id, mandaNoTenant],
    enabled: !!tid && !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      // admin e head criam pasta para qualquer setor; operador, só para os dele
      if (mandaNoTenant) {
        const { data, error } = await (supabase.from("support_departments" as any) as any)
          .select("id, name")
          .eq("tenant_id", tid)
          .eq("is_active", true)
          .order("name");
        if (error) throw error;
        return (data ?? []) as { id: string; name: string }[];
      }

      const { data, error } = await (supabase.from("support_department_members" as any) as any)
        .select("department_id, support_departments(id, name)")
        .eq("tenant_id", tid)
        .eq("user_id", user!.id)
        .eq("is_active", true);
      if (error) throw error;
      return ((data ?? []) as any[])
        .map((m) => m.support_departments)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, name: s.name }));
    },
  });
}

export function useSalvarPasta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      nome: string;
      cor: string;
      escopo: "setor" | "pessoal";
      departmentId?: string | null;
      id?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)("fn_email_pasta_salvar", {
        p_nome: p.nome,
        p_cor: p.cor,
        p_escopo: p.escopo,
        p_department_id: p.departmentId ?? null,
        p_id: p.id ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email_pastas"] }),
  });
}

export function useExcluirPasta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("fn_email_pasta_excluir", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email_pastas"] });
      // os e-mails da pasta voltam para "sem pasta": as listas precisam recarregar
      queryClient.invalidateQueries({ queryKey: ["emails_enviados"] });
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos"] });
    },
  });
}

export function useMoverParaPasta(tabela: "enviados" | "recebidos") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, pastaId }: { ids: string[]; pastaId: string | null }) => {
      const { data, error } = await (supabase.rpc as any)("fn_email_mover_pasta", {
        p_tabela: tabela,
        p_ids: ids,
        p_pasta_id: pastaId,
      });
      if (error) throw error;
      const r = (Array.isArray(data) ? data[0] : data) ?? { afetados: 0, bloqueados: 0 };
      return r as { afetados: number; bloqueados: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [tabela === "enviados" ? "emails_enviados" : "emails_recebidos"] });
      queryClient.invalidateQueries({ queryKey: ["email_leitura"] });
    },
  });
}
