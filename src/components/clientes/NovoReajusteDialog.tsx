import { useCallback, useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2, FileText, Filter, FilterX, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";

interface NovoReajusteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  reajusteId: string | null;
  onSuccess: () => void;
}

interface ItemRow {
  id: string;
  contrato_id: string;
  cliente_id: string;
  selecionado: boolean;
  percentual_aplicado: number;
  vlr_mensal_antes: number;
  vlr_mensal_depois: number;
  vlr_delta: number;
  data_proximo_reajuste_antes: string | null;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  cliente_numero: string;
  numero: string;
}

interface Totais {
  qtd_contratos: number;
  vlr_mensal_total_antes: number;
  vlr_reajuste_total: number;
  vlr_mensal_total_depois: number;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const SERIES: Record<string, number> = { ipca: 433, igpm: 189 };

export default function NovoReajusteDialog({
  open,
  onOpenChange,
  tenantId,
  reajusteId,
  onSuccess,
}: NovoReajusteDialogProps) {
  const [internalReajusteId, setInternalReajusteId] = useState<string | null>(null);
  const [status, setStatus] = useState<"pendente" | "aplicado" | "estornado">("pendente");
  const [indice, setIndice] = useState<"manual" | "ipca" | "igpm">("manual");
  const [indiceLoading, setIndiceLoading] = useState(false);
  const [indiceLabel, setIndiceLabel] = useState<string>("");
  const [periodo, setPeriodo] = useState<DateRange>({});
  const [percentual, setPercentual] = useState<string>("");
  const [buscando, setBuscando] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [confirmAplicar, setConfirmAplicar] = useState(false);
  const [confirmEstornar, setConfirmEstornar] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [search, setSearch] = useState("");

  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const isView = !!reajusteId;
  const readOnly = isView && status !== "pendente";
  const podeAplicar = !!internalReajusteId && status === "pendente";
  const podeEstornar = isView && status === "aplicado";

  const reset = useCallback(() => {
    setInternalReajusteId(null);
    setStatus("pendente");
    setIndice("manual");
    setIndiceLoading(false);
    setIndiceLabel("");
    setPeriodo({});
    setPercentual("");
    setBuscando(false);
    setItems([]);
    setLoadingItems(false);
    setTotais(null);
    setActionLoading(false);
    Object.values(debounceRef.current).forEach((t) => clearTimeout(t));
    debounceRef.current = {};
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Load existing reajuste (view mode)
  useEffect(() => {
    if (!open || !reajusteId) return;
    (async () => {
      const { data, error } = await (supabase.from("reajustes" as any) as any)
        .select("*")
        .eq("id", reajusteId)
        .single();
      if (error) {
        toast.error("Erro ao carregar reajuste");
        return;
      }
      setInternalReajusteId(reajusteId);
      setStatus(data.status);
      setPeriodo({
        from: data.periodo_inicio ? parseISO(data.periodo_inicio) : undefined,
        to: data.periodo_fim ? parseISO(data.periodo_fim) : undefined,
      });
      setPercentual(String(data.percentual_padrao ?? ""));
      setTotais({
        qtd_contratos: data.qtd_contratos ?? 0,
        vlr_mensal_total_antes: Number(data.vlr_mensal_total_antes ?? 0),
        vlr_reajuste_total: Number(data.vlr_reajuste_total ?? 0),
        vlr_mensal_total_depois: Number(data.vlr_mensal_total_depois ?? 0),
      });
      await loadItems(reajusteId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reajusteId]);

  const loadItems = async (rid: string) => {
    setLoadingItems(true);
    try {
      const { data: rcs, error } = await (supabase.from("reajuste_contratos" as any) as any)
        .select("*")
        .eq("reajuste_id", rid);
      if (error) throw error;
      const rows = (rcs ?? []) as any[];
      const clienteIds = Array.from(new Set(rows.map((r) => r.cliente_id).filter(Boolean)));
      const contratoIds = Array.from(new Set(rows.map((r) => r.contrato_id).filter(Boolean)));

      const [{ data: clientes }, { data: contratos }] = await Promise.all([
        clienteIds.length
          ? (supabase.from("clientes" as any) as any)
              .select("id, razao_social")
              .in("id", clienteIds)
          : Promise.resolve({ data: [] }),
        contratoIds.length
          ? (supabase.from("contratos" as any) as any)
              .select("id, numero, data_proximo_reajuste")
              .in("id", contratoIds)
          : Promise.resolve({ data: [] }),
      ]);
      const cliMap = new Map((clientes ?? []).map((c: any) => [c.id, c]));
      const ctrMap = new Map((contratos ?? []).map((c: any) => [c.id, c]));

      const mapped: ItemRow[] = rows.map((r) => ({
        id: r.id,
        contrato_id: r.contrato_id,
        cliente_id: r.cliente_id,
        selecionado: !!r.selecionado,
        percentual_aplicado: Number(r.percentual_aplicado ?? 0),
        vlr_mensal_antes: Number(r.vlr_mensal_antes ?? 0),
        vlr_mensal_depois: Number(r.vlr_mensal_depois ?? 0),
        vlr_delta: Number(r.vlr_delta ?? 0),
        data_proximo_reajuste_antes:
          r.data_proximo_reajuste_antes ?? (ctrMap.get(r.contrato_id) as any)?.data_proximo_reajuste ?? null,
        razao_social: (cliMap.get(r.cliente_id) as any)?.razao_social ?? "—",
        numero: (ctrMap.get(r.contrato_id) as any)?.numero ?? "—",
      }));
      mapped.sort((a, b) => a.razao_social.localeCompare(b.razao_social));
      setItems(mapped);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao carregar itens");
    } finally {
      setLoadingItems(false);
    }
  };

  const fetchIndice = async (key: "ipca" | "igpm") => {
    setIndiceLoading(true);
    try {
      const serie = SERIES[key];
      const res = await fetch(
        `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/12?formato=json`
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const arr = (await res.json()) as Array<{ data: string; valor: string }>;
      if (!arr?.length) throw new Error("empty");
      const acc = arr.reduce((p, m) => p * (1 + Number(m.valor) / 100), 1);
      const pct = (acc - 1) * 100;
      setPercentual(pct.toFixed(2));
      const last = arr[arr.length - 1];
      const [, mm, yyyy] = last.data.split("/");
      setIndiceLabel(
        `${key === "ipca" ? "IPCA" : "IGP-M"} acum. 12m: ${pct.toFixed(2).replace(".", ",")}% (ref. ${mm}/${yyyy})`
      );
    } catch {
      toast.warning("Não foi possível buscar o índice. Preencha manualmente.");
      setIndiceLabel("");
    } finally {
      setIndiceLoading(false);
    }
  };

  const handleIndiceChange = (v: string) => {
    setIndice(v as any);
    setIndiceLabel("");
    if (v === "manual") {
      setPercentual("");
    } else {
      fetchIndice(v as "ipca" | "igpm");
    }
  };

  const handleBuscar = async () => {
    if (!tenantId) {
      toast.error("Tenant não definido");
      return;
    }
    if (!periodo.from || !periodo.to) {
      toast.error("Selecione o período");
      return;
    }
    const pct = Number(percentual);
    if (!pct || isNaN(pct)) {
      toast.error("Informe o percentual");
      return;
    }
    setBuscando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("preparar_reajuste", {
        p_tenant_id: tenantId,
        p_periodo_inicio: format(periodo.from, "yyyy-MM-dd"),
        p_periodo_fim: format(periodo.to, "yyyy-MM-dd"),
        p_percentual: pct,
      });
      if (error) throw error;
      const rid = data.reajuste_id;
      setInternalReajusteId(rid);
      setTotais({
        qtd_contratos: data.qtd_contratos ?? 0,
        vlr_mensal_total_antes: Number(data.vlr_mensal_total_antes ?? 0),
        vlr_reajuste_total: Number(data.vlr_reajuste_total ?? 0),
        vlr_mensal_total_depois: Number(data.vlr_mensal_total_depois ?? 0),
      });
      await loadItems(rid);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao preparar reajuste");
    } finally {
      setBuscando(false);
    }
  };

  const applyTotaisFromRpc = (data: any) => {
    if (!data) return;
    setTotais({
      qtd_contratos: data.qtd_contratos ?? 0,
      vlr_mensal_total_antes: Number(data.vlr_mensal_total_antes ?? 0),
      vlr_reajuste_total: Number(data.vlr_reajuste_total ?? 0),
      vlr_mensal_total_depois: Number(data.vlr_mensal_total_depois ?? 0),
    });
  };

  const updateItemRpc = async (
    itemId: string,
    pPercentual: number | null,
    pSelecionado: boolean | null
  ) => {
    const { data, error } = await (supabase.rpc as any)("atualizar_reajuste_item", {
      p_item_id: itemId,
      p_percentual: pPercentual,
      p_selecionado: pSelecionado,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    applyTotaisFromRpc(data);
  };

  const handleToggleItem = (item: ItemRow, checked: boolean) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              selecionado: checked,
              vlr_delta: checked ? i.vlr_delta : 0,
              vlr_mensal_depois: checked ? i.vlr_mensal_depois : i.vlr_mensal_antes,
            }
          : i
      )
    );
    updateItemRpc(item.id, null, checked);
  };

  const handleToggleAll = async (checked: boolean) => {
    setItems((prev) => prev.map((i) => ({ ...i, selecionado: checked })));
    try {
      const results = await Promise.all(
        items.map((i) =>
          (supabase.rpc as any)("atualizar_reajuste_item", {
            p_item_id: i.id,
            p_percentual: null,
            p_selecionado: checked,
          })
        )
      );
      const last = results[results.length - 1];
      if (last?.data) applyTotaisFromRpc(last.data);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  };

  const scheduleRpcUpdate = (itemId: string, pct: number) => {
    if (debounceRef.current[itemId]) clearTimeout(debounceRef.current[itemId]);
    debounceRef.current[itemId] = setTimeout(() => {
      if (!isNaN(pct) && isFinite(pct)) updateItemRpc(itemId, pct, null);
    }, 800);
  };

  const handlePercentualItemChange = (item: ItemRow, value: string) => {
    const num = Number(value);
    const pct = isNaN(num) ? 0 : num;
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== item.id) return i;
        const delta = i.selecionado ? (i.vlr_mensal_antes * pct) / 100 : 0;
        return {
          ...i,
          percentual_aplicado: pct,
          vlr_delta: delta,
          vlr_mensal_depois: i.vlr_mensal_antes + delta,
        };
      })
    );
    scheduleRpcUpdate(item.id, pct);
  };

  const handleMrrNovoItemChange = (item: ItemRow, value: string) => {
    if (item.vlr_mensal_antes === 0) return;
    const num = Number(value);
    const novo = isNaN(num) ? 0 : num;
    const delta = novo - item.vlr_mensal_antes;
    const pct = Math.round(((delta / item.vlr_mensal_antes) * 100) * 100) / 100;
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== item.id) return i;
        return {
          ...i,
          percentual_aplicado: pct,
          vlr_delta: i.selecionado ? delta : 0,
          vlr_mensal_depois: novo,
        };
      })
    );
    scheduleRpcUpdate(item.id, pct);
  };

  const handleAplicar = async () => {
    if (!internalReajusteId) return;
    setActionLoading(true);
    try {
      const { error } = await (supabase.rpc as any)("aplicar_reajuste", {
        p_reajuste_id: internalReajusteId,
      });
      if (error) throw error;
      toast.success("Reajuste aplicado com sucesso");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao aplicar");
    } finally {
      setActionLoading(false);
      setConfirmAplicar(false);
    }
  };

  const handleEstornar = async () => {
    if (!internalReajusteId) return;
    setActionLoading(true);
    try {
      const { error } = await (supabase.rpc as any)("estornar_reajuste", {
        p_reajuste_id: internalReajusteId,
      });
      if (error) throw error;
      toast.success("Reajuste estornado com sucesso");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao estornar");
    } finally {
      setActionLoading(false);
      setConfirmEstornar(false);
    }
  };

  const selecionados = items.filter((i) => i.selecionado).length;
  const allSelected = items.length > 0 && selecionados === items.length;

  const title = isView ? `Reajuste — ${status}` : "Novo reajuste";
  const showIndice = !readOnly && (!isView || status === "pendente");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {showIndice && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Índice de reajuste
                </label>
                <Select value={indice} onValueChange={handleIndiceChange} disabled={indiceLoading}>
                  <SelectTrigger className="h-12">
                    <div className="flex items-center gap-2">
                      {indiceLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="ipca">IPCA (acum. 12 meses)</SelectItem>
                    <SelectItem value="igpm">IGP-M (acum. 12 meses)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <div className="flex-1">
                <DateRangePicker
                  label="Período de reajuste"
                  value={periodo}
                  onChange={setPeriodo}
                />
              </div>
              <div className="space-y-1 md:w-40">
                <label className="text-xs font-medium text-muted-foreground">% padrão</label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    value={percentual}
                    onChange={(e) => setPercentual(e.target.value)}
                    className="h-12 text-right pr-7"
                    disabled={readOnly}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                </div>
                {indiceLabel && (
                  <p className="text-xs text-muted-foreground italic">{indiceLabel}</p>
                )}
              </div>
              {!readOnly && (
                <Button
                  onClick={handleBuscar}
                  disabled={buscando}
                  className="h-12 bg-primary text-primary-foreground"
                >
                  {buscando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Buscar contratos
                </Button>
              )}
            </div>

            {totais && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <FileText className="h-3 w-3" /> Contratos
                  </div>
                  <div className="text-xl font-semibold">{totais.qtd_contratos}</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="text-xs text-muted-foreground mb-1">MRR atual</div>
                  <div className="text-xl font-semibold">
                    {fmtBRL(totais.vlr_mensal_total_antes)}
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="text-xs text-muted-foreground mb-1">Valor do reajuste</div>
                  <div className="text-xl font-semibold text-green-400">
                    +{fmtBRL(totais.vlr_reajuste_total)}
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="text-xs text-muted-foreground mb-1">MRR reajustado</div>
                  <div className="text-xl font-semibold text-blue-400">
                    {fmtBRL(totais.vlr_mensal_total_depois)}
                  </div>
                </div>
              </div>
            )}

            {(items.length > 0 || loadingItems) && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(c) => handleToggleAll(!!c)}
                      disabled={readOnly}
                    />
                    <span className="text-sm">
                      {selecionados} selecionados de {items.length}
                    </span>
                  </div>
                </div>

                {loadingItems ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (
                  <div className="max-h-[28rem] overflow-y-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-background">
                        <tr className="bg-muted">
                          <th className="px-3 py-2 w-10"></th>
                          <th className="px-3 py-2 text-left">Cliente / Contrato</th>
                          <th className="px-3 py-2 text-left">Próx. reajuste</th>
                          <th className="px-3 py-2 text-right">MRR atual</th>
                          <th className="px-3 py-2 text-right">%</th>
                          <th className="px-3 py-2 text-right">Delta</th>
                          <th className="px-3 py-2 text-right">MRR novo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr
                            key={item.id}
                            className={`border-t ${!item.selecionado ? "opacity-50" : ""}`}
                          >
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={item.selecionado}
                                onCheckedChange={(c) => handleToggleItem(item, !!c)}
                                disabled={readOnly}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{item.razao_social}</div>
                              <div className="text-xs text-muted-foreground">{item.numero}</div>
                            </td>
                            <td className="px-3 py-2">
                              {item.data_proximo_reajuste_antes
                                ? format(parseISO(item.data_proximo_reajuste_antes), "dd/MM/yyyy")
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {fmtBRL(item.vlr_mensal_antes)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                value={Math.round(item.percentual_aplicado * 100) / 100}
                                onChange={(e) => handlePercentualItemChange(item, e.target.value)}
                                disabled={readOnly || !item.selecionado}
                                className="h-8 w-20 text-right font-mono text-sm bg-transparent border border-muted rounded-md px-2"
                              />
                            </td>
                            <td className="px-3 py-2 text-right text-green-400">
                              {item.selecionado ? `+${fmtBRL(item.vlr_delta)}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                value={item.vlr_mensal_depois}
                                onChange={(e) => handleMrrNovoItemChange(item, e.target.value)}
                                disabled={readOnly || !item.selecionado || item.vlr_mensal_antes === 0}
                                className="h-8 w-28 text-right font-mono text-sm bg-transparent border border-muted rounded-md px-2 disabled:opacity-50"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {totais && totais.qtd_contratos === 0 && !loadingItems && (
              <div className="text-center text-muted-foreground py-8">
                Nenhum contrato encontrado no período selecionado
              </div>
            )}
          </div>

          <DialogFooter>
            {status === "estornado" ? (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            ) : podeEstornar ? (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Fechar
                </Button>
                <Button
                  onClick={() => setConfirmEstornar(true)}
                  disabled={actionLoading}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  Estornar reajuste
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                {podeAplicar && (
                  <Button
                    onClick={() => setConfirmAplicar(true)}
                    disabled={actionLoading || selecionados === 0}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    Aplicar reajuste ({selecionados} contratos)
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmAplicar} onOpenChange={setConfirmAplicar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar aplicação do reajuste</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja aplicar o reajuste de {percentual}% em {selecionados} contratos?
              Esta ação atualizará os valores de todos os contratos selecionados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleAplicar}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEstornar} onOpenChange={setConfirmEstornar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar estorno</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja estornar este reajuste? Os valores serão revertidos ao estado
              anterior.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEstornar}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Confirmar estorno
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
