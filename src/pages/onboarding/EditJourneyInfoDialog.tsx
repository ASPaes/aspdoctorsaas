import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Loader2, ChevronsUpDown, Check, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";

export interface EditJourneyInfoDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string | null;
  journeyId: string;
  initial: {
    clienteId: string;
    clienteLabel: string;
    /** Só para exibir o nome. Nunca é enviado: produto define o pipeline. */
    produtoId: number | null;
    demandTypeId: string | null;
    assunto: string;
    dataInicio: string | null;
    goLive: string | null;
  };
  onSaved: () => void;
}

/**
 * Espelha o NewJourneyModal, menos produto e responsável:
 * produto resolve o pipeline em create_onboarding_journey (trocar exige cancelar e
 * reabrir) e responsável tem o "Transferir", com histórico e motivo próprios.
 */
export function EditJourneyInfoDialog({
  open, onOpenChange, tenantId, journeyId, initial, onSaved,
}: EditJourneyInfoDialogProps) {
  const [clienteId, setClienteId] = useState(initial.clienteId);
  const [clienteLabel, setClienteLabel] = useState(initial.clienteLabel);
  const [clienteBusca, setClienteBusca] = useState("");
  const [clientePopoverOpen, setClientePopoverOpen] = useState(false);
  const [demandTypeId, setDemandTypeId] = useState(initial.demandTypeId ?? "");
  const [assunto, setAssunto] = useState(initial.assunto);
  const [dataInicio, setDataInicio] = useState(initial.dataInicio ?? "");
  const [goLive, setGoLive] = useState(initial.goLive ?? "");
  // Começa "editado" para o go-live já gravado não ser sobrescrito pelo cálculo ao abrir.
  const [goLiveEdited, setGoLiveEdited] = useState(true);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  const clienteBuscaDebounced = useDebouncedValue(clienteBusca, 300);

  // Reabrir o diálogo sempre volta aos valores atuais da jornada — nada de rascunho velho.
  useEffect(() => {
    if (open) {
      setClienteId(initial.clienteId);
      setClienteLabel(initial.clienteLabel);
      setClienteBusca("");
      setDemandTypeId(initial.demandTypeId ?? "");
      setAssunto(initial.assunto);
      setDataInicio(initial.dataInicio ?? "");
      setGoLive(initial.goLive ?? "");
      setGoLiveEdited(true);
      setMotivo("");
    }
  }, [open, initial]);

  const clientesQuery = useQuery({
    queryKey: ["onb-clientes-search", tenantId, clienteBuscaDebounced],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("search_clientes", {
        p_tenant_id: tenantId, p_termo: clienteBuscaDebounced, p_limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string | null }>;
    },
  });

  const demandTypesQuery = useQuery({
    queryKey: ["onb-demand-types-lookup", tenantId],
    enabled: open && !!tenantId,
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

  // A view da jornada expõe produto_id, não produto_nome — o nome vem daqui, só para exibir.
  const produtoQuery = useQuery({
    queryKey: ["onb-produto-nome", initial.produtoId],
    enabled: open && initial.produtoId != null,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos" as any) as any)
        .select("id, nome")
        .eq("id", initial.produtoId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { id: number; nome: string } | null;
    },
  });

  // O prazo passou a sair da soma das etapas do trilho do PRODUTO (01/08). O campo do
  // tipo de demanda virou referência: não gera data nenhuma, só serve para a tela de
  // configuração acusar quando o plano de etapas não cabe na promessa comercial.
  const trilhoQuery = useQuery({
    queryKey: ["onb-trilho-sla", tenantId, initial.produtoId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_onb_trilho_sla_min", {
        p_tenant_id: tenantId,
        p_produto_id: initial.produtoId ?? null,
      });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
  });

  // base_dia_util_8h: 1 dia útil = 480 minutos, igual a fn_journey_go_live.
  const trilhoMin = trilhoQuery.data ?? 0;
  const slaDays = trilhoMin ? Math.ceil(trilhoMin / 480) : 0;
  const slaLabel = `${slaDays} ${slaDays === 1 ? "dia útil" : "dias úteis"}`;

  const goLiveCalcQuery = useQuery({
    queryKey: ["onb-golive-calc", tenantId, initial.produtoId, dataInicio],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const startIso = dataInicio ? `${dataInicio}T12:00:00-03:00` : new Date().toISOString();
      const { data, error } = await (supabase.rpc as any)("fn_journey_go_live", {
        p_tenant_id: tenantId, p_start: startIso,
        p_produto_id: initial.produtoId ?? null, p_department_id: null,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  useEffect(() => {
    if (!goLiveEdited && goLiveCalcQuery.data) setGoLive(goLiveCalcQuery.data);
  }, [goLiveCalcQuery.data, goLiveEdited]);

  async function handleSubmit() {
    if (!motivo.trim()) { toast.error("Informe o motivo da alteração."); return; }
    if (!clienteId || !assunto.trim()) { toast.error("Preencha cliente e assunto."); return; }
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("update_onboarding_journey_info", {
        p_journey_id: journeyId,
        p_cliente_id: clienteId,
        p_assunto: assunto.trim(),
        p_motivo: motivo.trim(),
        p_demand_type_id: demandTypeId || null,
        p_data_inicio_planejado: dataInicio || null,
        p_go_live_previsto: goLive || null,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) {
        toast.error(res.reason === "jornada_terminal"
          ? "Jornada concluída ou cancelada não pode ser editada."
          : "Não foi possível salvar as alterações.");
        return;
      }
      const qtd = (res?.mudou ?? []).length;
      toast.success(qtd === 0 ? "Nada foi alterado." : "Informações atualizadas");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar informações da jornada</DialogTitle>
          <DialogDescription>
            Correção de cadastro. Alterar as datas não reinicia o SLA já em andamento.
          </DialogDescription>
        </DialogHeader>

        {/* 2 colunas como no NewJourneyModal: em 1 coluna o formulário não cabe em 13". */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 py-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <Popover open={clientePopoverOpen} onOpenChange={setClientePopoverOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox"
                        aria-expanded={clientePopoverOpen}
                        className="w-full justify-between font-normal">
                  <span className={cn("truncate", !clienteLabel && "text-muted-foreground")}>
                    {clienteLabel || "Buscar cliente por nome ou CNPJ..."}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Digite nome ou CNPJ..."
                                value={clienteBusca} onValueChange={setClienteBusca} />
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
                          <CommandItem key={c.id} value={c.id} onSelect={() => {
                            setClienteId(c.id); setClienteLabel(label); setClientePopoverOpen(false);
                          }}>
                            <Check className={cn("mr-2 h-4 w-4", clienteId === c.id ? "opacity-100" : "opacity-0")} />
                            <div className="flex flex-col min-w-0">
                              <span className="truncate">{label}</span>
                              {c.cnpj && <span className="text-xs text-muted-foreground">{c.cnpj}</span>}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-[10px] text-muted-foreground">
              Trocar o cliente também troca a unidade do ticket.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Lock className="h-3 w-3" /> Produto
            </Label>
            <Input value={produtoQuery.data?.nome ?? "—"} disabled readOnly />
            <p className="text-[10px] text-muted-foreground">
              Para trocar o produto, cancele esta jornada e abra outra — o produto define o quadro de etapas.
            </p>
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
                      <span className="h-2 w-2 rounded-full" style={{ background: d.cor || "#6B7280" }} />
                      {d.nome}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Assunto *</Label>
            <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={200} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Início planejado</Label>
              <Input type="date" value={dataInicio}
                     onChange={(e) => { setDataInicio(e.target.value); setGoLiveEdited(false); }} />
            </div>
            <div className="space-y-1.5">
              <Label>Go-live previsto</Label>
              <Input type="date" value={goLive}
                     onChange={(e) => { setGoLive(e.target.value); setGoLiveEdited(true); }} />
            </div>
          </div>

          <div className="text-[11px] -mt-1 sm:col-span-2">
            {goLiveCalcQuery.isFetching || trilhoQuery.isFetching ? (
                <span className="text-muted-foreground">Calculando go-live…</span>
              ) : !trilhoMin ? (
                <span className="text-amber-500">
                  Nenhuma etapa com SLA na janela contada deste produto — go-live não calculado.
                </span>
              ) : goLiveEdited ? (
                <button type="button" onClick={() => setGoLiveEdited(false)} className="text-primary hover:underline">
                  Recalcular pelo SLA ({slaLabel})
                </button>
              ) : goLiveCalcQuery.data ? (
                <span className="text-muted-foreground">Calculado: {slaLabel} a partir do início.</span>
              ) : null}
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Motivo da alteração *</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                      placeholder="Ex.: vendedor cadastrou o cliente errado" />
            <p className="text-[10px] text-muted-foreground">Fica registrado na Timeline da jornada.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
