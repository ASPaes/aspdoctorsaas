import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { KpiArea } from "@/lib/kpiCatalog";
import { ROTULO_PERIODO, type FiltrosSecao } from "./filtrosDaSecao";

/** Valor sentinela do "todos". O Select do shadcn não aceita item com valor
 *  string vazia, então null vira "__todos" na ida e volta. */
const TODOS = "__todos";

/** Mesmas consultas que a tela de Atendimento usa para popular os filtros —
 *  `support_departments` ativos e `profiles` com funcionário ativo. Ficam
 *  aqui em vez de reaproveitar o contexto porque o contexto é montado uma vez
 *  por página e o painel precisa de um conjunto por seção. */
function useSetores(ativo: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ["meu-painel-setores", tid],
    enabled: ativo && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function useAgentes(ativo: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ["meu-painel-agentes", tid],
    enabled: ativo && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionario:funcionarios!profiles_funcionario_id_fkey(nome, ativo)")
        .eq("tenant_id", tid);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((p) => p.funcionario?.ativo)
        .map((p) => ({ user_id: String(p.user_id), nome: p.funcionario?.nome ?? "Sem nome" }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
    },
  });
}

function useFornecedores(ativo: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ["meu-painel-fornecedores", tid],
    enabled: ativo && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("fornecedores" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: number; nome: string }[];
    },
  });
}

const CLASSE = "h-7 w-auto min-w-[110px] border-border bg-background/40 text-[11.5px]";

export function FiltrosDaSecaoBar({
  areas, filtros, onMudar,
}: {
  /** Áreas presentes na seção. Uma seção pode misturar, e a barra mostra a
   *  união dos filtros: setor e agente só aparecem se houver indicador de
   *  Atendimento, fornecedor só se houver de Financeiro. Filtro que nenhum
   *  indicador da seção usa não aparece — botão que não faz nada é pior que
   *  botão ausente. */
  areas: KpiArea[];
  filtros: FiltrosSecao;
  onMudar: (campo: string, valor: unknown) => void;
}) {
  const ehAtendimento = areas.includes("atendimento");
  const ehFinanceiro = areas.includes("financeiro");

  const setores = useSetores(ehAtendimento);
  const agentes = useAgentes(ehAtendimento);
  const fornecedores = useFornecedores(ehFinanceiro);

  const periodoAtual = typeof filtros.periodo === "string" ? filtros.periodo : "personalizado";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={periodoAtual} onValueChange={(v) => onMudar("periodo", v)}>
        <SelectTrigger className={CLASSE} aria-label="Período">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(ROTULO_PERIODO).map(([k, r]) => (
            <SelectItem key={k} value={k}>{r}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {ehAtendimento && (
        <>
          <Select
            value={filtros.departmentId ?? TODOS}
            onValueChange={(v) => onMudar("departmentId", v === TODOS ? null : v)}
          >
            <SelectTrigger className={CLASSE} aria-label="Setor">
              <SelectValue placeholder="Todos os setores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os setores</SelectItem>
              {(setores.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtros.agentId ?? TODOS}
            onValueChange={(v) => onMudar("agentId", v === TODOS ? null : v)}
          >
            <SelectTrigger className={CLASSE} aria-label="Agente">
              <SelectValue placeholder="Todos os agentes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os agentes</SelectItem>
              {(agentes.data ?? []).map((a) => (
                <SelectItem key={a.user_id} value={a.user_id}>{a.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtros.tipoAtendimento}
            onValueChange={(v) => onMudar("tipoAtendimento", v)}
          >
            <SelectTrigger className={CLASSE} aria-label="Tipo de atendimento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Individual + grupo</SelectItem>
              <SelectItem value="individual">Só individuais</SelectItem>
              <SelectItem value="group">Só grupos</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filtros.plantao} onValueChange={(v) => onMudar("plantao", v)}>
            <SelectTrigger className={CLASSE} aria-label="Plantão">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Plantão + comercial</SelectItem>
              <SelectItem value="comercial">Só horário comercial</SelectItem>
              <SelectItem value="plantao">Só plantão</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}

      {ehFinanceiro && (
        <Select
          value={filtros.fornecedorIds.length === 1 ? String(filtros.fornecedorIds[0]) : TODOS}
          onValueChange={(v) => onMudar("fornecedorIds", v === TODOS ? [] : [Number(v)])}
        >
          <SelectTrigger className={CLASSE} aria-label="Fornecedor">
            <SelectValue placeholder="Todos os fornecedores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os fornecedores</SelectItem>
            {(fornecedores.data ?? []).map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
