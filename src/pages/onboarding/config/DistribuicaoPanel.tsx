import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOnboardingPhases } from "@/hooks/useOnboardingPhases";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Users, Shuffle, Scale, UserCheck, AlertTriangle, X } from "lucide-react";

interface Pipeline {
  id: string;
  phase_id: string;
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
}

interface Pool {
  pipeline_id: string | null;
  pipeline_nome: string | null;
  department_id: string | null;
  department_nome: string | null;
  strategy: "menor_carga" | "round_robin" | "fixo" | null;
  fixed_agent_id: string | null;
  /** 'lista' = quem foi escolhido a dedo; 'setor' = fallback na equipe do setor. */
  origem: "lista" | "setor" | null;
  membros: Membro[];
}

interface PessoaDoTenant {
  user_id: string;
  nome: string;
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
        .select("id, phase_id, nome, produto_id, department_id, position")
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
  const phases = useOnboardingPhases(effectiveTenantId).data ?? [];
  // A jornada onde a jornada nasce — é ela que alimenta o rodízio.
  const primeiraPhase = phases[0] ?? null;

  // Só os pipelines da primeira jornada alimentam o motor: na virada para a seguinte a
  // responsabilidade vai para quem conduziu o treino, não para o rodízio.
  //
  // Sem filtro por department_id: desde 13/08 a lista de participantes é do PIPELINE,
  // então um pipeline sem setor também pode distribuir.
  const pipelinesDoRodizio = useMemo(() => {
    if (!primeiraPhase) return [] as Pipeline[];
    return pipelines.filter((p) => p.phase_id === primeiraPhase.id);
  }, [pipelines, primeiraPhase]);

  const poolsQ = useQuery({
    queryKey: ["onb-dist-pools", effectiveTenantId, pipelinesDoRodizio.map((p) => p.id).join(",")],
    enabled: !!effectiveTenantId && pipelinesDoRodizio.length > 0,
    queryFn: async () => {
      const out: Record<string, Pool> = {};
      for (const pipe of pipelinesDoRodizio) {
        const { data, error } = await (supabase.rpc as any)("fn_onboarding_assignment_pool", {
          p_tenant_id: effectiveTenantId,
          p_pipeline_id: pipe.id,
          p_produto_id: null,
          p_fase: "onboarding",
        });
        if (error) throw error;
        out[pipe.id] = data as Pool;
      }
      return out;
    },
  });

  // Todo mundo que PODE entrar num rodízio. É esta lista que permite pôr alguém de
  // outro setor num pipeline — o caso do onboarding do Gula, cujo responsável está
  // no setor Suporte Gula e nunca apareceria no pool do setor Onboarding.
  const pessoasQ = useQuery({
    queryKey: ["onb-dist-pessoas", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data: profs, error } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .eq("tenant_id", effectiveTenantId!)
        .eq("status", "ativo");
      if (error) throw error;
      const ids = (profs ?? []).map((p) => p.funcionario_id).filter(Boolean) as number[];
      const { data: funcs } = await supabase
        .from("funcionarios")
        .select("id, nome")
        .in("id", ids.length ? ids : [0]);
      const mapa = new Map((funcs ?? []).map((f) => [f.id, f.nome as string]));
      return (profs ?? [])
        .map((p) => ({
          user_id: p.user_id as string,
          nome: (p.funcionario_id ? mapa.get(p.funcionario_id) : null) || "Sem vínculo",
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome)) as PessoaDoTenant[];
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

  async function salvarRegra(pipelineId: string, patch: Record<string, unknown>) {
    const pool = poolsQ.data?.[pipelineId];
    // origem 'setor' significa lista vazia. Não materializar o setor aqui: salvar só a
    // estratégia congelaria o fallback numa lista fixa sem ninguém ter pedido isso.
    const listaAtual = pool?.origem === "lista" ? (pool?.membros ?? []).map((m) => m.user_id) : [];

    const { error } = await (supabase.from("onboarding_assignment_rules" as any) as any).upsert(
      {
        tenant_id: effectiveTenantId,
        pipeline_id: pipelineId,
        strategy: pool?.strategy ?? "menor_carga",
        fixed_agent_id: pool?.fixed_agent_id ?? null,
        included_agents: listaAtual,
        is_active: true,
        ...patch,
      },
      { onConflict: "tenant_id,pipeline_id" },
    );

    if (error) {
      toast.error(error.message || "Erro ao salvar a regra");
      return;
    }
    invalidar();
  }

  async function adicionarPessoa(pipelineId: string, userId: string) {
    const pool = poolsQ.data?.[pipelineId];
    const atual = pool?.origem === "lista" ? (pool?.membros ?? []).map((m) => m.user_id) : [];
    if (atual.includes(userId)) return;
    await salvarRegra(pipelineId, { included_agents: [...atual, userId] });
  }

  async function removerPessoa(pipelineId: string, userId: string) {
    const pool = poolsQ.data?.[pipelineId];
    // Removendo a partir do fallback, a lista precisa nascer materializada — senão
    // tirar 1 de 3 pessoas do setor não teria efeito nenhum.
    const atual = (pool?.membros ?? []).map((m) => m.user_id);
    await salvarRegra(pipelineId, { included_agents: atual.filter((id) => id !== userId) });
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
  // Agrupa por jornada cadastrada, na ordem definida na aba Jornadas.
  const gruposPorPhase = phases
    .map((f) => ({ phase: f, itens: pipelines.filter((p) => p.phase_id === f.id) }))
    .filter((g) => g.itens.length > 0);

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
            {gruposPorPhase.map(({ phase, itens }) => (
                <div key={phase.id} className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                    {phase.nome}
                  </p>
                  {itens.map((p) => (
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
            ))}
          </div>
        )}

        {gruposPorPhase.length > 1 && (
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 pt-0.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>
              O rodízio só age na <strong>criação</strong> da jornada, e só olha os pipelines de
              <strong> {primeiraPhase?.nome ?? "primeira jornada"}</strong>. Ao concluir essa etapa, a
              responsabilidade passa para quem conduziu o treino — o setor das jornadas seguintes serve
              para o ticket, não para distribuir.
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

        {pipelinesDoRodizio.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-lg">
            Nenhum pipeline de onboarding ativo — a distribuição automática está desligada.
          </div>
        ) : poolsQ.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {pipelinesDoRodizio.map((pipe) => {
              const pool = poolsQ.data?.[pipe.id];
              const membros = pool?.membros ?? [];
              const estrategia = pool?.strategy ?? "menor_carga";
              const porSetor = pool?.origem !== "lista";
              const disponiveis = (pessoasQ.data ?? []).filter(
                (p) => !membros.some((m) => m.user_id === p.user_id),
              );

              return (
                <div key={pipe.id} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border bg-muted/30">
                    <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{pipe.nome}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        Setor {pool?.department_nome ?? "não definido"}
                      </p>
                    </div>
                    <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">
                      {porSetor ? `${membros.length} do setor` : `${membros.length} no rodízio`}
                    </Badge>
                  </div>

                  <div className="p-3.5 space-y-3.5">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Como escolher o responsável</label>
                      <Select
                        value={estrategia}
                        onValueChange={(v) => salvarRegra(pipe.id, { strategy: v })}
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
                          onValueChange={(v) => salvarRegra(pipe.id, { fixed_agent_id: v })}
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
                          {pool?.department_id
                            ? "Ninguém escolhido e o setor está vazio — a jornada vai nascer sem responsável."
                            : "Sem ninguém escolhido e sem setor — a jornada vai nascer sem responsável."}
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {membros.map((m) => (
                            <div
                              key={m.user_id}
                              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-border/60"
                            >
                              <span className="flex-1 text-sm truncate">{m.nome}</span>
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                {m.jornadas_ativas === 1 ? "1 jornada" : `${m.jornadas_ativas} jornadas`}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removerPessoa(pipe.id, m.user_id)}
                                aria-label={`Tirar ${m.nome} do rodízio de ${pipe.nome}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {porSetor && membros.length > 0 && (
                        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                          <span>
                            Ninguém escolhido para este pipeline — vale a equipe do setor{" "}
                            <strong>{pool?.department_nome}</strong>. Adicionar alguém aqui passa a
                            valer só para <strong>{pipe.nome}</strong>.
                          </span>
                        </p>
                      )}

                      <Select value="" onValueChange={(v) => adicionarPessoa(pipe.id, v)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="+ Adicionar pessoa" />
                        </SelectTrigger>
                        <SelectContent>
                          {disponiveis.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              Todo mundo já está na lista
                            </div>
                          ) : (
                            disponiveis.map((p) => (
                              <SelectItem key={p.user_id} value={p.user_id}>
                                {p.nome}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
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
