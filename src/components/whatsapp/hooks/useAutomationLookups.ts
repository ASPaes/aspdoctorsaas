import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * DEM-0410 | Os três catálogos que a tela de automações precisa: setores,
 * pessoas e canais.
 *
 * Fica num hook próprio, com queryKey estável, para os cards e o dialog
 * compartilharem o mesmo cache do react-query em vez de cada um consultar por
 * conta (o AssignmentRuleCard faz isso e cobra 3 consultas por card na tela).
 */

export interface OpcaoSetor {
  id: string;
  name: string;
}

export interface OpcaoPessoa {
  user_id: string;
  nome: string;
}

export interface OpcaoCanal {
  id: string;
  nome: string;
}

export const useAutomationLookups = () => {
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: setores = [], isLoading: carregandoSetores } = useQuery({
    queryKey: ["automation-lookup-setores", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name")
        .eq("tenant_id", tid!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as OpcaoSetor[];
    },
  });

  const { data: pessoas = [], isLoading: carregandoPessoas } = useQuery({
    queryKey: ["automation-lookup-pessoas", tid],
    enabled: !!tid,
    queryFn: async () => {
      // O nome da pessoa não mora em profiles: é profiles.funcionario_id →
      // funcionarios.nome.
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .eq("tenant_id", tid!)
        .eq("access_status", "active")
        .eq("status", "ativo");
      if (error) throw error;

      const funcIds = (profiles ?? [])
        .map((p) => p.funcionario_id)
        .filter((v): v is number => Boolean(v));

      const { data: funcionarios } = funcIds.length
        ? await supabase.from("funcionarios").select("id, nome").in("id", funcIds)
        : { data: [] as Array<{ id: number; nome: string }> };

      const nomePorFuncionario = new Map((funcionarios ?? []).map((f) => [f.id, f.nome]));

      return (profiles ?? [])
        .map((p) => ({
          user_id: p.user_id,
          nome: p.funcionario_id
            ? nomePorFuncionario.get(p.funcionario_id) ?? "Sem vínculo"
            : "Sem vínculo",
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as OpcaoPessoa[];
    },
  });

  const { data: canais = [], isLoading: carregandoCanais } = useQuery({
    queryKey: ["automation-lookup-canais", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("id, display_name, instance_name")
        .eq("tenant_id", tid!)
        .order("instance_name");
      if (error) throw error;
      return (data ?? []).map((i: any) => ({
        id: i.id,
        nome: i.display_name || i.instance_name,
      })) as OpcaoCanal[];
    },
  });

  const nomeDoSetor = (id: string | null) =>
    id ? setores.find((s) => s.id === id)?.name ?? "Setor removido" : null;

  const nomeDaPessoa = (id: string | null) =>
    id ? pessoas.find((p) => p.user_id === id)?.nome ?? "Pessoa sem acesso" : null;

  const nomeDoCanal = (id: string | null) =>
    id ? canais.find((c) => c.id === id)?.nome ?? "Canal removido" : null;

  return {
    setores,
    pessoas,
    canais,
    nomeDoSetor,
    nomeDaPessoa,
    nomeDoCanal,
    isLoading: carregandoSetores || carregandoPessoas || carregandoCanais,
  };
};
