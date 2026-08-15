import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Loader2, ChevronsUpDown, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useOnboardingPhases } from "@/hooks/useOnboardingPhases";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string | null;
  onCreated: () => void;
  /** Pipeline aberto no quadro — vira o padrão do "Abrir em". Null = o quadro ainda não
   *  resolveu qual pipeline mostrar; aí o primeiro da lista assume. */
  defaultPipelineId?: string | null;
}

/** Fases em que uma jornada pode NASCER. Acompanhamento tem quadro e fluxo próprios (o
 *  botão da tela vira "Novo acompanhamento"), e onboarding_journeys.fase_atual é um enum
 *  de duas fases — a RPC recusa qualquer outra. */
const FASES_DE_ABERTURA = ["onboarding", "implantacao"];

export function NewJourneyModal({ open, onOpenChange, tenantId, onCreated, defaultPipelineId }: Props) {
  const [clienteId, setClienteId] = useState<string>("");
  const [clienteLabel, setClienteLabel] = useState<string>("");
  const [clienteBusca, setClienteBusca] = useState<string>("");
  const [clientePopoverOpen, setClientePopoverOpen] = useState(false);
  const [produtoId, setProdutoId] = useState<string>("");
  const [assunto, setAssunto] = useState<string>("");
  const [dataInicio, setDataInicio] = useState<string>("");
  const [goLive, setGoLive] = useState<string>("");
  const [goLiveEdited, setGoLiveEdited] = useState(false);
  // Data de abertura = created_at da jornada, gravado pelo banco. Aqui só se mostra
  // a data de hoje como prévia, sempre desabilitada.
  const hojeISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const [demandTypeId, setDemandTypeId] = useState<string>("");
  // "auto" = deixa o motor de distribuição escolher (padrão).
  const [implantadorUserId, setImplantadorUserId] = useState<string>("auto");
  /** Quadro em que a jornada nasce. É ele que carrega a fase — não existe escolher
   *  "Implantação" e cair no pipeline do Onboarding. */
  const [pipelineId, setPipelineId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const clienteBuscaDebounced = useDebouncedValue(clienteBusca, 300);

  useEffect(() => {
    if (!open) {
      setClienteId(""); setClienteLabel(""); setClienteBusca("");
      setProdutoId(""); setAssunto(""); setDataInicio(""); setGoLive("");
      setGoLiveEdited(false);
      setDemandTypeId(""); setImplantadorUserId("auto"); setPipelineId("");
    }
  }, [open]);

  const phasesQuery = useOnboardingPhases(tenantId, { enabled: open });

  const pipelinesQuery = useQuery({
    queryKey: ["onb-pipelines-abertura", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome, phase_id, position")
        .eq("tenant_id", tenantId!)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; phase_id: string | null; position: number }>;
    },
  });

  /** Pipeline sem etapa ativa não pode receber jornada — a RPC recusa, e o cartão ficaria
   *  invisível num quadro sem coluna. Some da lista em vez de virar erro no Criar. */
  const pipelinesComEtapaQuery = useQuery({
    queryKey: ["onb-pipelines-com-etapa", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stages" as any) as any)
        .select("pipeline_id")
        .eq("tenant_id", tenantId!)
        .eq("ativo", true);
      if (error) throw error;
      return new Set((data ?? []).map((s: any) => s.pipeline_id as string));
    },
  });

  const opcoesAbertura = useMemo(() => {
    const fases = (phasesQuery.data ?? []).filter((f) => FASES_DE_ABERTURA.includes(f.slug ?? ""));
    const comEtapa = pipelinesComEtapaQuery.data;
    return (pipelinesQuery.data ?? [])
      .filter((p) => !comEtapa || comEtapa.has(p.id))
      .map((p) => {
        const fase = fases.find((f) => f.id === p.phase_id);
        return fase
          ? { ...p, fase_id: fase.id, fase_nome: fase.nome, fase_slug: fase.slug ?? "", fase_position: fase.position }
          : null;
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.fase_position - b.fase_position || a.position - b.position) as Array<{
        id: string; nome: string; fase_id: string; fase_nome: string; fase_slug: string;
        fase_position: number; position: number;
      }>;
  }, [phasesQuery.data, pipelinesQuery.data, pipelinesComEtapaQuery.data]);

  /** O quadro aberto vira o padrão — era exatamente o que faltava: com "Implantação Gula"
   *  selecionado, a jornada nascia no Onboarding assim mesmo. */
  useEffect(() => {
    if (!open || opcoesAbertura.length === 0) return;
    if (opcoesAbertura.some((o) => o.id === pipelineId)) return;
    const padrao = opcoesAbertura.find((o) => o.id === defaultPipelineId) ?? opcoesAbertura[0];
    setPipelineId(padrao.id);
  }, [open, opcoesAbertura, defaultPipelineId, pipelineId]);

  const aberturaEscolhida = useMemo(
    () => opcoesAbertura.find((o) => o.id === pipelineId) ?? null,
    [opcoesAbertura, pipelineId],
  );

  const clientesQuery = useQuery({
    queryKey: ["onb-clientes-search", tenantId, clienteBuscaDebounced],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("search_clientes", {
        p_tenant_id: tenantId,
        p_termo: clienteBuscaDebounced,
        p_limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string | null }>;
    },
  });

  const produtosQuery = useQuery({
    queryKey: ["onb-produtos-lookup", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, nome")
        .eq("tenant_id", tenantId!)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const demandTypesQuery = useQuery({
    queryKey: ["onb-demand-types-lookup", tenantId],
    enabled: open && !!tenantId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_demand_types" as any) as any)
        .select("id, nome, cor, sla_total_minutos")
        .eq("tenant_id", tenantId!)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; cor: string | null; sla_total_minutos: number | null }>;
    },
  });

  // Pool do rodízio do quadro escolhido, com a carga atual de cada um. Desde 14/08 o
  // pipeline vai explícito: a jornada nasce no quadro do "Abrir em", então a prévia de
  // quem vai receber tem que sair do MESMO pipeline (antes era sempre o de onboarding).
  const poolQuery = useQuery({
    queryKey: ["onb-assignment-pool", tenantId, produtoId, pipelineId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_onboarding_assignment_pool", {
        p_tenant_id: tenantId,
        p_pipeline_id: pipelineId || null,
        p_produto_id: produtoId ? Number(produtoId) : null,
        p_fase: aberturaEscolhida?.fase_slug || "onboarding",
      });
      if (error) throw error;
      return (data ?? null) as {
        pipeline_id: string | null;
        pipeline_nome: string | null;
        department_nome: string | null;
        origem: "lista" | "setor" | null;
        membros: Array<{ user_id: string; nome: string; jornadas_ativas: number }>;
      } | null;
    },
  });

  // Ter setor deixou de ser o sinal certo: com lista própria por pipeline, um pipeline
  // sem setor pode distribuir e um pipeline com setor pode estar sem ninguém.
  const poolMembros = poolQuery.data?.membros ?? [];
  const temPool = poolMembros.length > 0;

  // Lista completa do tenant: alimenta o grupo "Outros" do select. A exceção manual não
  // pode depender de o pipeline estar sem configuração — era o que acontecia antes, e
  // é por isso que escolher alguém de fora do setor só funcionava por acidente.
  const membrosQuery = useQuery({
    queryKey: ["onb-membros", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .eq("tenant_id", tenantId!)
        .eq("status", "ativo");
      if (pErr) throw pErr;
      const funcIds = (profiles ?? []).map((p) => p.funcionario_id).filter(Boolean) as number[];
      const { data: funcs = [] } = await supabase
        .from("funcionarios")
        .select("id, nome")
        .in("id", funcIds.length ? funcIds : [0]);
      const funcMap = new Map((funcs ?? []).map((f) => [f.id, f.nome as string]));
      return (profiles ?? [])
        .map((p) => ({
          user_id: p.user_id as string,
          nome: (p.funcionario_id ? funcMap.get(p.funcionario_id) : null) || "Sem vínculo",
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
    },
  });

  const outrosMembros = (membrosQuery.data ?? []).filter(
    (m) => !poolMembros.some((p) => p.user_id === m.user_id),
  );

  // O prazo passou a sair da soma das etapas do trilho do PRODUTO (01/08). Antes vinha do
  // tipo de demanda, que agora é só referência. A base aqui era 1440 e no diálogo de
  // edição era 480 — o mesmo cálculo com bases diferentes; agora existe uma só.
  //
  // p_from_phase_id recorta o trilho da fase de abertura em diante: jornada que nasce na
  // Implantação não pode ter no prazo as etapas do Onboarding que ela nunca vai percorrer.
  const trilhoQuery = useQuery({
    queryKey: ["onb-trilho-sla", tenantId, produtoId, aberturaEscolhida?.fase_id ?? null],
    enabled: open && !!tenantId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_onb_trilho_sla_min", {
        p_tenant_id: tenantId,
        p_produto_id: produtoId ? Number(produtoId) : null,
        p_from_phase_id: aberturaEscolhida?.fase_id ?? null,
      });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
  });

  // base_dia_util_8h: 1 dia útil = 480 minutos, igual a fn_journey_go_live.
  const trilhoMin = trilhoQuery.data ?? 0;
  const slaDays = trilhoMin ? Math.ceil(trilhoMin / 480) : 0;
  const slaLabel = `${slaDays} ${slaDays === 1 ? "dia útil" : "dias úteis"}`;

  // Golive previsto = início + soma das etapas da janela contada (fn_journey_go_live).
  const goLiveCalcQuery = useQuery({
    queryKey: ["onb-golive-calc", tenantId, produtoId, dataInicio, aberturaEscolhida?.fase_id ?? null],
    enabled: open && !!tenantId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const startIso = dataInicio ? `${dataInicio}T12:00:00-03:00` : new Date().toISOString();
      const { data, error } = await (supabase.rpc as any)("fn_journey_go_live", {
        p_tenant_id: tenantId,
        p_start: startIso,
        p_produto_id: produtoId ? Number(produtoId) : null,
        p_department_id: null,
        p_from_phase_id: aberturaEscolhida?.fase_id ?? null,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  useEffect(() => {
    if (!goLiveEdited && goLiveCalcQuery.data) setGoLive(goLiveCalcQuery.data);
  }, [goLiveCalcQuery.data, goLiveEdited]);

  async function handleSubmit() {
    if (!tenantId) return;
    if (!clienteId || !produtoId || !assunto.trim()) {
      toast.error("Preencha cliente, produto e assunto.");
      return;
    }
    if (!pipelineId) {
      toast.error("Escolha em qual quadro a jornada será aberta.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("create_onboarding_journey", {
        p_tenant_id: tenantId,
        p_cliente_id: clienteId,
        p_produto_id: produtoId,
        p_assunto: assunto.trim(),
        p_data_inicio_planejado: dataInicio || null,
        p_go_live_previsto: goLive || null,
        p_demand_type_id: demandTypeId || null,
        // "auto" → o motor de distribuição escolhe (fn_onboarding_pick_assignee)
        p_implantador_user_id: implantadorUserId === "auto" ? null : implantadorUserId || null,
        // A escolha da tela ganha do trilho do produto (decisão de 14/08/2026).
        p_pipeline_id: pipelineId,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        toast.error(res.message || "Não foi possível criar a jornada");
        return;
      }
      toast.success(
        aberturaEscolhida
          ? `Jornada criada em ${aberturaEscolhida.fase_nome} › ${aberturaEscolhida.nome}`
          : "Jornada criada",
      );
      onCreated();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao criar jornada");
    } finally {
      setSaving(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova jornada</DialogTitle>
        </DialogHeader>
        {/* 2 colunas: em 1 coluna o formulário passava de 730px e não cabia em
            notebook 13". sm: garante volta a 1 coluna em tela estreita. */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 py-2 sm:grid-cols-2">
          {/* Onde a jornada nasce. Vem preenchido com o quadro aberto, e é editável porque
              existe cliente que entra direto na Implantação, sem passar pelo Onboarding. */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Abrir em *</Label>
            <Select value={pipelineId} onValueChange={(v) => { setPipelineId(v); setGoLiveEdited(false); }}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    pipelinesQuery.isLoading || phasesQuery.isLoading ? "Carregando..." : "Selecione o quadro"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {opcoesAbertura.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    <span className="text-muted-foreground">{o.fase_nome}</span>
                    <span className="mx-1.5 text-muted-foreground/50">›</span>
                    {o.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {aberturaEscolhida?.fase_slug === "implantacao" && (
              <p className="text-xs text-amber-500">
                A jornada nasce direto na Implantação — o Onboarding não é percorrido e não
                entra no prazo.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <Popover open={clientePopoverOpen} onOpenChange={setClientePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={clientePopoverOpen}
                  className="w-full justify-between font-normal"
                >
                  <span className={cn("truncate", !clienteLabel && "text-muted-foreground")}>
                    {clienteLabel || "Buscar cliente por nome ou CNPJ..."}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Digite nome ou CNPJ..."
                    value={clienteBusca}
                    onValueChange={setClienteBusca}
                  />
                  <CommandList>
                    {clientesQuery.isFetching && (
                      <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Buscando...
                      </div>
                    )}
                    {!clientesQuery.isFetching && (clientesQuery.data ?? []).length === 0 && (
                      <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                    )}
                    <CommandGroup>
                      {(clientesQuery.data ?? []).map((c) => {
                        const label = c.nome_fantasia || c.razao_social || "—";
                        return (
                          <CommandItem
                            key={c.id}
                            value={c.id}
                            onSelect={() => {
                              setClienteId(c.id);
                              setClienteLabel(label);
                              setClientePopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                clienteId === c.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="truncate">{label}</span>
                              {c.cnpj && (
                                <span className="text-xs text-muted-foreground">{c.cnpj}</span>
                              )}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1.5">
            <Label>Responsável</Label>
            <Select value={implantadorUserId} onValueChange={setImplantadorUserId}>
              <SelectTrigger>
                <SelectValue placeholder={poolQuery.isLoading ? "Carregando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automático (rodízio)</SelectItem>
                {poolMembros.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    <span className="flex items-center gap-2">
                      <span>{m.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.jornadas_ativas === 1 ? "1 jornada" : `${m.jornadas_ativas} jornadas`}
                      </span>
                    </span>
                  </SelectItem>
                ))}
                {outrosMembros.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Outros
                    </div>
                    {outrosMembros.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.nome}</SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {temPool
                ? `No automático, o rodízio de ${poolQuery.data?.pipeline_nome ?? aberturaEscolhida?.nome ?? "onboarding"} escolhe.`
                : "Este pipeline não tem ninguém na distribuição — no automático, você fica como responsável. Configure em Configuração › Distribuição."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Produto *</Label>
            <Select value={produtoId} onValueChange={setProdutoId}>
              <SelectTrigger>
                <SelectValue placeholder={produtosQuery.isLoading ? "Carregando..." : "Selecione o produto"} />
              </SelectTrigger>
              <SelectContent>
                {(produtosQuery.data ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de demanda</Label>
            <Select value={demandTypeId} onValueChange={(v) => { setDemandTypeId(v); setGoLiveEdited(false); }}>
              <SelectTrigger>
                <SelectValue placeholder={demandTypesQuery.isLoading ? "Carregando..." : "Selecione (opcional)"} />
              </SelectTrigger>
              <SelectContent>
                {(demandTypesQuery.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: d.cor || "#6B7280" }}
                      />
                      {d.nome}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* texto livre: linha inteira */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Assunto *</Label>
            <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={200} />
          </div>

          {/* as três datas como um grupo. Separadas, o texto de ajuda da data de
              abertura esticava a linha e abria um buraco na coluna ao lado. */}
          <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Data de abertura</Label>
              <Input type="date" value={hojeISO} disabled readOnly />
            </div>
            <div className="space-y-1.5">
              <Label>Início planejado</Label>
              <Input type="date" value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); setGoLiveEdited(false); }} />
            </div>
            <div className="space-y-1.5">
              <Label>Go-live previsto</Label>
              <Input type="date" value={goLive} onChange={(e) => { setGoLive(e.target.value); setGoLiveEdited(true); }} />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1 sm:col-span-2">
            Data de abertura é registrada na criação e não editável. Início planejado é
            a data combinada com o cliente.
          </p>
          <div className="text-[11px] -mt-1 sm:col-span-2">
            {goLiveCalcQuery.isFetching || trilhoQuery.isFetching ? (
                <span className="text-muted-foreground">Calculando go-live…</span>
              ) : !trilhoMin ? (
                <span className="text-amber-500">
                  Nenhuma etapa com SLA na janela contada deste produto — go-live não calculado.
                </span>
              ) : goLiveEdited ? (
                <button
                  type="button"
                  onClick={() => setGoLiveEdited(false)}
                  className="text-primary hover:underline"
                >
                  Editado manualmente · recalcular pelo SLA ({slaLabel})
                </button>
              ) : goLiveCalcQuery.data ? (
                <span className="text-muted-foreground">Calculado: {slaLabel} a partir do início.</span>
              ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
