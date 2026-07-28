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
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string | null;
  fase: "onboarding" | "implantacao";
  onCreated: () => void;
}

export function NewJourneyModal({ open, onOpenChange, tenantId, fase, onCreated }: Props) {
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
  const [saving, setSaving] = useState(false);

  const clienteBuscaDebounced = useDebouncedValue(clienteBusca, 300);

  useEffect(() => {
    if (!open) {
      setClienteId(""); setClienteLabel(""); setClienteBusca("");
      setProdutoId(""); setAssunto(""); setDataInicio(""); setGoLive("");
      setGoLiveEdited(false);
      setDemandTypeId(""); setImplantadorUserId("auto");
    }
  }, [open]);

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

  // Pool do rodízio: membros do setor do pipeline daquele produto, com a carga
  // atual de cada um. Depende do produto porque o pipeline é escolhido por ele.
  const poolQuery = useQuery({
    queryKey: ["onb-assignment-pool", tenantId, produtoId, fase],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_onboarding_assignment_pool", {
        p_tenant_id: tenantId,
        p_department_id: null,
        p_produto_id: produtoId ? Number(produtoId) : null,
        p_fase: "onboarding",
      });
      if (error) throw error;
      return (data ?? null) as {
        department_id: string | null;
        department_nome: string | null;
        membros: Array<{ user_id: string; nome: string; jornadas_ativas: number; no_rodizio: boolean }>;
      } | null;
    },
  });

  const temSetor = !!poolQuery.data?.department_id;
  const poolMembros = poolQuery.data?.membros ?? [];

  // Fallback de quando o pipeline ainda não tem setor: lista de sempre.
  const membrosQuery = useQuery({
    queryKey: ["onb-membros", tenantId],
    enabled: open && !!tenantId && !temSetor,
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

  const selectedDemand = (demandTypesQuery.data ?? []).find((d) => d.id === demandTypeId);
  const slaDays = selectedDemand?.sla_total_minutos
    ? Math.ceil(selectedDemand.sla_total_minutos / 1440)
    : 0;
  const slaLabel = `${slaDays} ${slaDays === 1 ? "dia útil" : "dias úteis"}`;

  // Golive previsto = início + SLA do tipo de demanda em dias úteis (fn_journey_go_live).
  const goLiveCalcQuery = useQuery({
    queryKey: ["onb-golive-calc", tenantId, demandTypeId, dataInicio],
    enabled: open && !!tenantId && !!demandTypeId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const startIso = dataInicio ? `${dataInicio}T12:00:00-03:00` : new Date().toISOString();
      const { data, error } = await (supabase.rpc as any)("fn_journey_go_live", {
        p_tenant_id: tenantId,
        p_start: startIso,
        p_demand_type_id: demandTypeId,
        p_department_id: null,
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
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        toast.error(res.message || "Não foi possível criar a jornada");
        return;
      }
      toast.success("Jornada criada");
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
          <DialogTitle>Nova jornada de {fase}</DialogTitle>
        </DialogHeader>
        {/* 2 colunas: em 1 coluna o formulário passava de 730px e não cabia em
            notebook 13". sm: garante volta a 1 coluna em tela estreita. */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 py-2 sm:grid-cols-2">
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
                {temSetor
                  ? poolMembros.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        <span className="flex items-center gap-2">
                          <span>{m.nome}</span>
                          <span className="text-xs text-muted-foreground">
                            {m.jornadas_ativas === 1 ? "1 jornada" : `${m.jornadas_ativas} jornadas`}
                          </span>
                        </span>
                      </SelectItem>
                    ))
                  : (membrosQuery.data ?? []).map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.nome}</SelectItem>
                    ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {temSetor
                ? `Rodízio entre o setor ${poolQuery.data?.department_nome}.`
                : "Este pipeline não tem setor definido — no automático, você fica como responsável. Configure em Configuração › Distribuição."}
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
          {demandTypeId && (
            <div className="text-[11px] -mt-1 sm:col-span-2">
              {goLiveCalcQuery.isFetching ? (
                <span className="text-muted-foreground">Calculando go-live…</span>
              ) : selectedDemand && !selectedDemand.sla_total_minutos ? (
                <span className="text-amber-500">Este tipo de demanda não tem SLA definido — go-live não calculado.</span>
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
          )}
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
