import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLookups } from "@/hooks/useLookups";
import { useCertA1Filters } from "@/hooks/useCertA1Filters";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { format, addMonths, differenceInDays, parseISO, addDays, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CertA1Dashboard } from "@/components/certificados/CertA1Dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ShieldCheck, ShieldAlert, ShieldOff, ShieldQuestion, ArrowUpDown, ArrowUp, ArrowDown, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

type QuickFilter = "todos" | "janela" | "vence30" | "vencido20" | "personalizado";
type SortField = "codigo_sequencial" | "razao_social" | "cert_a1_vencimento" | "cert_a1_ultima_venda_em";
type SortDir = "asc" | "desc";

function getCertStatus(vencimento: string | null) {
  if (!vencimento) return { label: "Sem data", key: "sem_data" };
  const diff = differenceInDays(parseISO(vencimento), new Date());
  if (diff < 0) return { label: "Vencido", key: "vencido" };
  if (diff <= 30) return { label: "Vencendo", key: "vencendo" };
  return { label: "Válido", key: "valido" };
}

const statusBadgeClasses: Record<string, string> = {
  vencido: "bg-primary/15 text-primary border-primary/30",
  vencendo: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  valido: "bg-green-500/15 text-green-600 border-green-500/30",
  sem_data: "",
};

const formatBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function CertificadosA1() {
  const queryClient = useQueryClient();
  const lookups = useLookups();
  const { filters, updateFilter } = useCertA1Filters();
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq('tenant_id', tid) : q;

  const {
    searchText, quickFilter: quickFilterRaw, statusFilter, somenteGanho,
    vencimentoDe, vencimentoAte, sortField: sortFieldRaw, sortDir: sortDirRaw,
  } = filters;

  const quickFilter = quickFilterRaw as QuickFilter;
  const sortField = sortFieldRaw as SortField;
  const sortDir = sortDirRaw as SortDir;

  // Modals
  const [editVencimentoCliente, setEditVencimentoCliente] = useState<any>(null);
  const [editVencimentoValue, setEditVencimentoValue] = useState("");
  const [vendaModalCliente, setVendaModalCliente] = useState<any>(null);

  // Venda modal state
  const [perdidoTerceiro, setPerdidoTerceiro] = useState(false);
  const [dataVenda, setDataVenda] = useState(new Date().toISOString().split("T")[0]);
  const [valorVenda, setValorVenda] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [dataBaseRenovacao, setDataBaseRenovacao] = useState("");
  const [motivoPerda, setMotivoPerda] = useState("");

  const [debouncedSearch, setDebouncedSearch] = useState(searchText);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  // Calculate date ranges for quick filters
  const quickFilterDates = useMemo(() => {
    const today = new Date();
    const todayStr = format(today, "yyyy-MM-dd");
    switch (quickFilter) {
      case "janela":
        return { de: format(subDays(today, 20), "yyyy-MM-dd"), ate: format(addDays(today, 30), "yyyy-MM-dd") };
      case "vence30":
        return { de: todayStr, ate: format(addDays(today, 30), "yyyy-MM-dd") };
      case "vencido20":
        return { de: format(subDays(today, 20), "yyyy-MM-dd"), ate: todayStr };
      case "personalizado":
        return { de: vencimentoDe, ate: vencimentoAte };
      default:
        return { de: "", ate: "" };
    }
  }, [quickFilter, vencimentoDe, vencimentoAte]);

  const { data: clientes, isLoading } = useQuery({
    queryKey: ["cert_a1_lista", debouncedSearch, quickFilter, statusFilter, quickFilterDates, sortField, sortDir, somenteGanho, tid],
    queryFn: async () => {
      // If "somente ganho" is active, fetch sold client IDs first
      let ganhoIds: string[] | null = null;
      if (somenteGanho) {
        const { data: vendas } = await tf(supabase.from("certificado_a1_vendas").select("cliente_id").eq("status", "ganho"));
        ganhoIds = [...new Set((vendas ?? []).map((v: any) => v.cliente_id))] as string[];
        if (ganhoIds.length === 0) return [];
      }

      let q = tf(supabase.from("clientes" as any)
        .select("id, razao_social, nome_fantasia, cnpj, codigo_sequencial, telefone_contato, cert_a1_vencimento, cert_a1_ultima_venda_em, cert_a1_ultimo_vendedor_id")
        .eq("cancelado", false)) as any;

      if (ganhoIds) {
        q = q.in("id", ganhoIds);
      }

      if (debouncedSearch) {
        const s = `%${debouncedSearch}%`;
        const trimmed = debouncedSearch.trim();
        const isNumeric = /^\d+$/.test(trimmed);
        if (isNumeric) {
          q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s},codigo_sequencial.eq.${trimmed}`);
        } else {
          q = q.or(`razao_social.ilike.${s},nome_fantasia.ilike.${s},cnpj.ilike.${s}`);
        }
      }

      // Date filter from quick filter
      if (quickFilterDates.de) q = q.gte("cert_a1_vencimento", quickFilterDates.de);
      if (quickFilterDates.ate) q = q.lte("cert_a1_vencimento", quickFilterDates.ate);

      // Sort
      const nullsFirst = sortDir === "asc";
      q = q.order(sortField, { ascending: sortDir === "asc", nullsFirst });

      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  // Post-query status filtering
  const filteredClientes = useMemo(() => {
    if (!clientes) return [];
    if (!statusFilter) return clientes;
    return clientes.filter((c) => getCertStatus(c.cert_a1_vencimento).key === statusFilter);
  }, [clientes, statusFilter]);

  // KPIs
  const kpis = useMemo(() => {
    const list = filteredClientes;
    const total = list.length;
    const vencidos = list.filter((c) => getCertStatus(c.cert_a1_vencimento).key === "vencido").length;
    const vencendo = list.filter((c) => getCertStatus(c.cert_a1_vencimento).key === "vencendo").length;
    const validos = list.filter((c) => getCertStatus(c.cert_a1_vencimento).key === "valido").length;
    const semData = list.filter((c) => getCertStatus(c.cert_a1_vencimento).key === "sem_data").length;
    return { total, vencidos, vencendo, validos, semData };
  }, [filteredClientes]);

  const funcionarios = lookups.funcionarios.data ?? [];
  const vendedorNome = useCallback((id: number | null) => {
    if (!id) return "—";
    return funcionarios.find((f) => f.id === id)?.nome ?? "—";
  }, [funcionarios]);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) updateFilter("sortDir", sortDir === "asc" ? "desc" : "asc");
    else { updateFilter("sortField", field); updateFilter("sortDir", "asc"); }
  }, [sortField, sortDir, updateFilter]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  // Editar vencimento
  const updateVencimento = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("clientes").update({ cert_a1_vencimento: editVencimentoValue || null } as any).eq("id", editVencimentoCliente.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Vencimento atualizado!");
      queryClient.invalidateQueries({ queryKey: ["cert_a1_lista"] });
      setEditVencimentoCliente(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Registrar venda
  const registrarVenda = useMutation({
    mutationFn: async () => {
      const payload: any = {
        cliente_id: vendaModalCliente.id,
        data_venda: dataVenda,
        status: perdidoTerceiro ? "perdido_terceiro" : "ganho",
      };
      if (perdidoTerceiro) {
        payload.data_base_renovacao = dataBaseRenovacao || null;
        payload.motivo_perda = motivoPerda || null;
        payload.vendedor_id = vendedorId ? Number(vendedorId) : null;
      } else {
        payload.valor_venda = valorVenda ? Number(valorVenda) : null;
        payload.vendedor_id = vendedorId ? Number(vendedorId) : null;
        payload.observacao = observacao || null;
      }
      const { error } = await supabase.from("certificado_a1_vendas" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venda registrada!");
      queryClient.invalidateQueries({ queryKey: ["cert_a1_lista"] });
      setVendaModalCliente(null);
      resetVendaModal();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetVendaModal = () => {
    setPerdidoTerceiro(false);
    setDataVenda(new Date().toISOString().split("T")[0]);
    setValorVenda("");
    setVendedorId("");
    setObservacao("");
    setDataBaseRenovacao("");
    setMotivoPerda("");
  };

  const previewVencimento = useMemo(() => {
    const baseDate = perdidoTerceiro ? dataBaseRenovacao : dataVenda;
    if (!baseDate) return null;
    return format(addMonths(parseISO(baseDate), 12), "dd/MM/yyyy");
  }, [perdidoTerceiro, dataVenda, dataBaseRenovacao]);

  const quickFilterButtons: { key: QuickFilter; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "janela", label: "Janela Renovação" },
    { key: "vence30", label: "Vence em 30d" },
    { key: "vencido20", label: "Vencido até 20d" },
    { key: "personalizado", label: "Personalizado" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Certificados A1</h1>
        <p className="mt-1 text-muted-foreground">Gestão de certificados digitais A1</p>
      </div>

      <Tabs defaultValue="lista">
        <TabsList>
          <TabsTrigger value="lista">Lista</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <CertA1Dashboard />
        </TabsContent>

        <TabsContent value="lista" className="mt-4 space-y-4">

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total", value: kpis.total, icon: ShieldCheck, color: "" },
          { label: "Vencidos", value: kpis.vencidos, icon: ShieldOff, color: "text-primary" },
          { label: "Vencendo (30d)", value: kpis.vencendo, icon: ShieldAlert, color: "text-amber-600" },
          { label: "Válidos", value: kpis.validos, icon: ShieldCheck, color: "text-green-600" },
          { label: "Sem Data", value: kpis.semData, icon: ShieldQuestion, color: "text-muted-foreground" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">{kpi.label}</CardTitle>
              <kpi.icon className={`h-4 w-4 ${kpi.color || "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-7 w-10" /> : <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick filter buttons */}
      <div className="flex flex-wrap gap-2">
        {quickFilterButtons.map((b) => (
          <Button
            key={b.key}
            variant={quickFilter === b.key ? "default" : "outline"}
            size="sm"
            onClick={() => updateFilter("quickFilter", b.key)}
          >
            {b.label}
          </Button>
        ))}
      </div>

      {/* Personalizado date range */}
      {quickFilter === "personalizado" && (
        <div className="flex gap-2 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">De</label>
            <Input type="date" value={vencimentoDe} onChange={(e) => updateFilter("vencimentoDe", e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Até</label>
            <Input type="date" value={vencimentoAte} onChange={(e) => updateFilter("vencimentoAte", e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
      )}

      {/* Search + status filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
           placeholder="Buscar cód. sequencial, razão social, fantasia, CNPJ..."
            value={searchText}
            onChange={(e) => updateFilter("searchText", e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => updateFilter("statusFilter", v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Todos status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos_status">Todos</SelectItem>
            <SelectItem value="vencido">Vencido</SelectItem>
            <SelectItem value="vencendo">Vencendo</SelectItem>
            <SelectItem value="valido">Válido</SelectItem>
            <SelectItem value="sem_data">Sem data</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Checkbox id="somenteGanho" checked={somenteGanho} onCheckedChange={(v) => updateFilter("somenteGanho", v === true)} />
          <label htmlFor="somenteGanho" className="text-sm whitespace-nowrap">Somente vendidos</label>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => toggleSort("codigo_sequencial")}>
                <span className="flex items-center text-xs">Cód. Seq.<SortIcon field="codigo_sequencial" /></span>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort("razao_social")}>
                <span className="flex items-center text-xs">Razão Social<SortIcon field="razao_social" /></span>
              </TableHead>
              <TableHead className="text-xs">Telefone</TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort("cert_a1_vencimento")}>
                <span className="flex items-center text-xs">Vencimento<SortIcon field="cert_a1_vencimento" /></span>
              </TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort("cert_a1_ultima_venda_em")}>
                <span className="flex items-center text-xs">Últ. Venda<SortIcon field="cert_a1_ultima_venda_em" /></span>
              </TableHead>
              <TableHead className="text-xs">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredClientes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filteredClientes.map((c: any) => {
                const st = getCertStatus(c.cert_a1_vencimento);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs">{c.codigo_sequencial || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <div>{c.razao_social || "—"}</div>
                      {c.nome_fantasia && <div className="text-muted-foreground">{c.nome_fantasia}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{c.telefone_contato || "—"}</TableCell>
                    <TableCell className="text-xs">
                      {c.cert_a1_vencimento ? format(parseISO(c.cert_a1_vencimento), "dd/MM/yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClasses[st.key] || ""}>
                        {st.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.cert_a1_ultima_venda_em ? format(parseISO(c.cert_a1_ultima_venda_em), "dd/MM/yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                          setEditVencimentoCliente(c);
                          setEditVencimentoValue(c.cert_a1_vencimento || "");
                        }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                          setVendaModalCliente(c);
                          resetVendaModal();
                        }}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Modal Editar Vencimento */}
      <Dialog open={!!editVencimentoCliente} onOpenChange={(o) => !o && setEditVencimentoCliente(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Vencimento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{editVencimentoCliente?.razao_social}</p>
          <Input type="date" value={editVencimentoValue} onChange={(e) => setEditVencimentoValue(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditVencimentoCliente(null)}>Cancelar</Button>
            <Button onClick={() => updateVencimento.mutate()} disabled={updateVencimento.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Registrar Venda */}
      <Dialog open={!!vendaModalCliente} onOpenChange={(o) => { if (!o) { setVendaModalCliente(null); resetVendaModal(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Venda — {vendaModalCliente?.razao_social}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox id="perdido2" checked={perdidoTerceiro} onCheckedChange={(v) => setPerdidoTerceiro(v === true)} />
              <label htmlFor="perdido2" className="text-sm">Já renovado com terceiro</label>
            </div>

            {perdidoTerceiro ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Data base da renovação</label>
                  <Input type="date" value={dataBaseRenovacao} onChange={(e) => setDataBaseRenovacao(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Registrado por</label>
                  <Select value={vendedorId} onValueChange={setVendedorId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {funcionarios.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Motivo / Observação</label>
                  <Textarea value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)} rows={2} />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Data da Venda</label>
                  <Input type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Valor R$</label>
                  <Input type="number" step="0.01" value={valorVenda} onChange={(e) => setValorVenda(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Vendedor</label>
                  <Select value={vendedorId} onValueChange={setVendedorId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {funcionarios.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Observação</label>
                  <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
                </div>
              </>
            )}

            {previewVencimento && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <span className="text-muted-foreground">Novo vencimento: </span>
                <span className="font-medium">{previewVencimento}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVendaModalCliente(null)}>Cancelar</Button>
            <Button onClick={() => registrarVenda.mutate()} disabled={registrarVenda.isPending}>
              {registrarVenda.isPending ? "Salvando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
