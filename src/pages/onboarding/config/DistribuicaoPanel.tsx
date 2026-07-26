import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, Shuffle, Scale, UserCheck, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Pipeline {
  id: string;
  fase: "onboarding" | "implantacao";
  nome: string;
  produto_id: number | null;
  department_id: string | null;
  position: number;
}

interface Departamento {
  id: string;
  name: string;
}

interface Membro {
  user_id: string;
  nome: string;
  jornadas_ativas: number;
  no_rodizio: boolean;
}

interface Pool {
  department_id: string | null;
  department_nome: string | null;
  strategy: "menor_carga" | "round_robin" | "fixo" | null;
  fixed_agent_id: string | null;
  membros: Membro[];
}

const SEM_SETOR = "__sem__";

const ESTRATEGIAS: Array<{
  value: "menor_carga" | "round_robin" | "fixo";
  label: string;
  descricao: string;
  icon: typeof Scale;
}> = [
  {
    value: "menor_carga",
    label: "Menor carga",
    descricao: "Vai para quem tem menos jornadas em andamento. Empate: quem assumiu a última há mais tempo.",
    icon: Scale,
  },
  {
    value: "round_robin",
    label: "Rodízio",
    descricao: "Gira na ordem da lista, um por vez, sem olhar quantas jornadas cada um já tem.",
    icon: Shuffle,
  },
  {
    value: "fixo",
    label: "Agente fixo",
    descricao: "Sempre a mesma pessoa. Se ela sair do setor, cai para menor carga.",
    icon: UserCheck,
  },
];

export function DistribuicaoPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();

  const pipelinesQ = useQuery({
    queryKey: ["onb-dist-pipelines", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, fase, nome, produto_id, department_id, position")
        .eq("tenant_id", effectiveTenantId)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Pipeline[];
    },
  });

  const deptsQ = useQuery({
    queryKey: ["onb-dist-departamentos", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name")
        .eq("tenant_id", effectiveTenantId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Departamento[];
    },
  });

  const produtosQ = useQuery({
    queryKey: ["onb-dist-produtos", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, nome")
        .eq("tenant_id", effectiveTenantId!);
      if (error) throw error;
      return new Map((data ?? []).map((p: any) => [p.id as number, p.nome as string]));
    },
  });

  const pipelines = pipelinesQ.data ?? [];

  // Só o pipeline de onboarding alimenta o motor: na virada para implantação a
  // responsabilidade vai para quem conduziu o treino, não para o rodízio.
  const setoresDoRodizio = useMemo(() => {
    const ids = pipelines
      .filter((p) => p.fase === "onboarding" && p.department_id)
      .map((p) => p.department_id as string);
    return Array.from(new Set(ids));
  }, [pipelines]);

  const poolsQ = useQuery({
    queryKey: ["onb-dist-pools", effectiveTenantId, setoresDoRodizio.join(",")],
    enabled: !!effectiveTenantId && setoresDoRodizio.length > 0,
    queryFn: async () => {
      const out: Record<string, Pool> = {};
      for (const dept of setoresDoRodizio) {
        const { data, error } = await (supabase.rpc as any)("fn_onboarding_assignment_pool", {
          p_tenant_id: effectiveTenantId,
          p_department_id: dept,
          p_produto_id: null,
          p_fase: "onboarding",
        });
        if (error) throw error;
        out[dept] = data as Pool;
      }
      return out;
    },
  });

  function invalidar() {
    qc.invalidateQueries({ queryKey: ["onb-dist-pipelines"] });
    qc.invalidateQueries({ queryKey: ["onb-dist-pools"] });
  }

  async function salvarSetorDoPipeline(pipelineId: string, deptId: string) {
    const valor = deptId === SEM_SETOR ? null : deptId;
    const { error } = await (supabase.from("onboarding_pipelines" as any) as any)
      .update({ department_id: valor })
      .eq("id", pipelineId)
      .eq("tenant_id", effectiveTenantId);
    if (error) {
      toast.error(error.message || "Erro ao salvar o setor");
      return;
    }
    toast.success(valor ? "Setor definido" : "Setor removido");
    invalidar();
  }

  async function salvarRegra(deptId: string, patch: Record<string, unknown>) {
    const pool = poolsQ.data?.[deptId];
    const excluidosAtuais = (pool?.membros ?? []).filter((m) => !m.no_rodizio).map((m) => m.user_id);

    const { error } = await (supabase.from("onboarding_assignment_rules" as any) as any).upsert(
      {
        tenant_id: effectiveTenantId,
        department_id: deptId,
        strategy: pool?.strategy ?? "menor_carga",
        fixed_agent_id: pool?.fixed_agent_id ?? null,
        excluded_agents: excluidosAtuais,
        is_active: true,
        ...patch,
      },
      { onConflict: "tenant_id,department_id" },
    );

    if (error) {
      toast.error(error.message || "Erro ao salvar a regra");
      return;
    }
    invalidar();
  }

  async function alternarRodizio(deptId: string, userId: string, dentro: boolean) {
    const pool = poolsQ.data?.[deptId];
    const excluidos = new Set((pool?.membros ?? []).filter((m) => !m.no_rodizio).map((m) => m.user_id));
    if (dentro) excluidos.delete(userId);
    else excluidos.add(userId);

    const restantes = (pool?.membros ?? []).filter((m) => !excluidos.has(m.user_id));
    if (restantes.length === 0) {
      toast.error("Precisa sobrar pelo menos uma pessoa no rodízio.");
      return;
    }

    await salvarRegra(deptId, { excluded_agents: Array.from(excluidos) });
  }

  const carregando = pipelinesQ.isLoading || deptsQ.isLoading;

  if (carregando) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const departamentos = deptsQ.data ?? [];
  const produtos = produtosQ.data;
  const porFase = {
    onboarding: pipelines.filter((p) => p.fase === "onboarding"),
    implantacao: pipelines.filter((p) => p.fase === "implantacao"),
  };

  return (
    <div className="max-w-3xl space-y-8 pb-6">
      {/* ---------- Setor por pipeline ---------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Setor de cada pipeline</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            O setor define quem entra no rodízio e vai junto para o ticket da jornada.
          </p>
        </div>

        {pipelines.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-lg">
            Nenhum pipeline ativo. Configure em "Pipelines &amp; Etapas".
          </div>
        ) : (
          <div className="space-y-4">
            {(["onboarding", "implantacao"] as const).map((fase) =>
              porFase[fase].length === 0 ? null : (
                <div key={fase} className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                    {fase === "onboarding" ? "Onboarding" : "Implantação"}
                  </p>
                  {porFase[fase].map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-card transition-colors hover:border-primary/40"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{p.nome}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.produto_id ? produtos?.get(p.produto_id) ?? `Produto #${p.produto_id}` : "Todos os produtos"}
                        </p>
                      </div>
                      <Select
                        value={p.department_id ?? SEM_SETOR}
                        onValueChange={(v) => salvarSetorDoPipeline(p.id, v)}
                      >
                        <SelectTrigger className="w-52 h-9">
                          <SelectValue placeholder="Sem setor" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_SETOR}>Sem setor</SelectItem>
                          {departamentos.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              ),
            )}
          </div>
        )}

        {porFase.implantacao.length > 0 && (
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 pt-0.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>
              O rodízio só age na <strong>criação</strong> da jornada. Ao concluir o onboarding, a
              responsabilidade passa para quem conduziu o treino — o setor da implantação serve para o
              ticket, não para distribuir.
            </span>
          </p>
        )}
      </section>

      {/* ---------- Regra do rodízio ---------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Regra do rodízio</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Vale quando a jornada é criada sem responsável escolhido na mão.
          </p>
        </div>

        {setoresDoRodizio.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-lg">
            Nenhum pipeline de onboarding tem setor definido — a distribuição automática está desligada.
          </div>
        ) : poolsQ.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {setoresDoRodizio.map((deptId) => {
              const pool = poolsQ.data?.[deptId];
              const membros = pool?.membros ?? [];
              const estrategia = pool?.strategy ?? "menor_carga";
              const noRodizio = membros.filter((m) => m.no_rodizio);

              return (
                <div key={deptId} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border bg-muted/30">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{pool?.department_nome ?? "Setor"}</span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {noRodizio.length} de {membros.length} no rodízio
                    </Badge>
                  </div>

                  <div className="p-3.5 space-y-3.5">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Como escolher o responsável</label>
                      <Select
                        value={estrategia}
                        onValueChange={(v) => salvarRegra(deptId, { strategy: v })}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ESTRATEGIAS.map((e) => (
                            <SelectItem key={e.value} value={e.value}>
                              <span className="flex items-center gap-2">
                                <e.icon className="h-3.5 w-3.5" />
                                {e.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {ESTRATEGIAS.find((e) => e.value === estrategia)?.descricao}
                      </p>
                    </div>

                    {estrategia === "fixo" && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Quem recebe</label>
                        <Select
                          value={pool?.fixed_agent_id ?? ""}
                          onValueChange={(v) => salvarRegra(deptId, { fixed_agent_id: v })}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Escolha a pessoa" />
                          </SelectTrigger>
                          <SelectContent>
                            {membros.map((m) => (
                              <SelectItem key={m.user_id} value={m.user_id}>
                                {m.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Quem participa</label>
                      {membros.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded-md">
                          Este setor não tem nenhum membro ativo — a jornada vai nascer sem responsável.
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {membros.map((m) => (
                            <div
                              key={m.user_id}
                              className={cn(
                                "flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-border/60 transition-opacity",
                                !m.no_rodizio && "opacity-50",
                              )}
                            >
                              <span className="flex-1 text-sm truncate">{m.nome}</span>
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                {m.jornadas_ativas === 1 ? "1 jornada" : `${m.jornadas_ativas} jornadas`}
                              </span>
                              <Switch
                                checked={m.no_rodizio}
                                onCheckedChange={(v) => alternarRodizio(deptId, m.user_id, v)}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
