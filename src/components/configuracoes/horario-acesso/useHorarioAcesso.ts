import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import type { AccessInterval } from "@/lib/accessWindow";

export interface AccessSchedule {
  id: string;
  tenant_id: string;
  name: string;
  timezone: string;
  is_active: boolean;
  intervals: AccessInterval[];
  warn_before_minutes: number | null;
  grace_minutes: number;
  release_queue_on_end: boolean;
  created_at: string;
}

export interface AccessTarget {
  id: string;
  schedule_id: string;
  department_id: string | null;
  user_id: string | null;
}

export interface PessoaAcesso {
  user_id: string;
  nome: string;
  role: string;
  department_id: string | null;
  department_name: string | null;
  origin: "exempt" | "user" | "department" | "none";
  schedule_id: string | null;
  schedule_name: string | null;
  allowed: boolean | null;
  ends_at: string | null;
  next_start_at: string | null;
}

export interface SalvarRegra {
  id: string | null;
  name: string;
  timezone: string;
  is_active: boolean;
  intervals: AccessInterval[];
  warn_before_minutes: number | null;
  grace_minutes: number;
  release_queue_on_end: boolean;
  department_ids: string[];
  user_ids: string[];
}

const tabela = (nome: string) => (supabase.from(nome as any) as any);

export function useHorarioAcesso() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const qc = useQueryClient();

  const regras = useQuery({
    queryKey: ["horario-acesso-regras", tid],
    enabled: !!tid,
    queryFn: async (): Promise<AccessSchedule[]> => {
      const { data, error } = await tabela("access_schedules").select("*").eq("tenant_id", tid).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const alvos = useQuery({
    queryKey: ["horario-acesso-alvos", tid],
    enabled: !!tid,
    queryFn: async (): Promise<AccessTarget[]> => {
      const { data, error } = await tabela("access_schedule_targets")
        .select("id, schedule_id, department_id, user_id")
        .eq("tenant_id", tid);
      if (error) throw error;
      return data ?? [];
    },
  });

  const setores = useQuery({
    queryKey: ["horario-acesso-setores", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name")
        .eq("tenant_id", tid!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const pessoas = useQuery({
    queryKey: ["horario-acesso-pessoas", tid],
    enabled: !!tid,
    // "Agora" muda sozinho com o relógio: relê a cada minuto enquanto a tela está aberta.
    refetchInterval: 60_000,
    queryFn: async (): Promise<PessoaAcesso[]> => {
      const { data, error } = await (supabase.rpc as any)("access_schedule_overview", { p_tenant_id: tid });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["horario-acesso-regras", tid] });
    qc.invalidateQueries({ queryKey: ["horario-acesso-alvos", tid] });
    qc.invalidateQueries({ queryKey: ["horario-acesso-pessoas", tid] });
  };

  const salvar = useMutation({
    mutationFn: async (r: SalvarRegra) => {
      const { error } = await (supabase.rpc as any)("access_schedule_save", {
        p_tenant_id: tid,
        p_id: r.id,
        p_name: r.name,
        p_timezone: r.timezone,
        p_is_active: r.is_active,
        p_intervals: r.intervals,
        p_warn_before_minutes: r.warn_before_minutes,
        p_grace_minutes: r.grace_minutes,
        p_release_queue_on_end: r.release_queue_on_end,
        p_department_ids: r.department_ids,
        p_user_ids: r.user_ids,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra salva");
      invalidar();
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível salvar a regra."),
  });

  const ligar = useMutation({
    mutationFn: async ({ id, ativa }: { id: string; ativa: boolean }) => {
      const { error } = await (supabase.rpc as any)("access_schedule_set_active", { p_id: id, p_is_active: ativa });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.ativa ? "Regra ligada" : "Regra desligada");
      invalidar();
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível alterar a regra."),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("access_schedule_delete", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra excluída");
      invalidar();
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível excluir a regra."),
  });

  return {
    tid,
    regras: regras.data ?? [],
    alvos: alvos.data ?? [],
    setores: setores.data ?? [],
    pessoas: pessoas.data ?? [],
    carregando: regras.isLoading || alvos.isLoading || pessoas.isLoading,
    salvar,
    ligar,
    excluir,
  };
}
