import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLookups } from "@/hooks/useLookups";
import { format, addDays, subDays, startOfMonth, endOfMonth } from "date-fns";
import { DateRangePicker, DateRange } from "@/components/ui/date-range-picker";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  ShieldCheck, ShieldAlert, ShieldOff, ShieldQuestion,
  DollarSign, UserX, TrendingUp, BarChart3, List,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const formatBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_OPTIONS = [
  { value: "todos", label: "Todos" },
  { value: "ganho", label: "Ganho" },
  { value: "perdido_terceiro", label: "Perdido p/ Terceiro" },
  { value: "pendente", label: "Pendente" },
];

export function CertA1Dashboard() {
  // Default: mês corrente
  const now = new Date();
  const [periodo, setPeriodo] = useState<DateRange>({
    from: startOfMonth(now),
    to: endOfMonth(now),
  });
  const [statusFilter, setStatusFilter] = useState("ganho");
  const [vendedorFilter, setVendedorFilter] = useState("todos");

  const funcionarios = useLookups().funcionarios.data ?? [];

  const periodoInicioStr = periodo.from ? format(periodo.from, "yyyy-MM-dd") : null;
  const periodoFimStr = periodo.to ? format(periodo.to, "yyyy-MM-dd") : null;

  const { data: metrics, isLoading } = useQuery({
    queryKey: ["cert-a1-dashboard", periodoInicioStr, periodoFimStr],
    queryFn: async () => {
      // Vendas no período
      let vendasQuery = supabase
        .from("certificado_a1_vendas")
        .select("id, cliente_id, valor_venda, status, vendedor_id, data_venda")
        .not("data_venda", "is", null);
      if (periodoInicioStr && periodoFimStr) {
        vendasQuery = vendasQuery.gte("data_venda", periodoInicioStr).lte("data_venda", periodoFimStr);
      }
      const { data: vendas } = await vendasQuery;

      // Fetch client names for the sales
      const clienteIds = [...new Set((vendas ?? []).map(v => v.cliente_id))];
      let clientesMap: Record<string, { razao_social: string | null; nome_fantasia: string | null }> = {};
      if (clienteIds.length > 0) {
        const { data: clientes } = await supabase
          .from("clientes")
          .select("id, razao_social, nome_fantasia")
          .in("id", clienteIds);
        (clientes ?? []).forEach(c => { clientesMap[c.id] = { razao_social: c.razao_social, nome_fantasia: c.nome_fantasia }; });
      }

      const ganhos = vendas?.filter((v) => v.status === "ganho") || [];
      const vendasQtd = ganhos.length;
      const faturamento = ganhos.reduce((sum, v) => sum + (Number(v.valor_venda) || 0), 0);
      const perdidoQtd = vendas?.filter((v) => v.status === "perdido_terceiro").length || 0;

      // Vendas por funcionário (somente ganhos)
      const vendasPorFunc: Record<number, number> = {};
      ganhos.forEach((v) => {
        if (v.vendedor_id) {
          vendasPorFunc[v.vendedor_id] = (vendasPorFunc[v.vendedor_id] || 0) + 1;
        }
      });

      // Oportunidades rolling
      const today = new Date();
      const todayStr = format(today, "yyyy-MM-dd");
      const minus20Str = format(subDays(today, 20), "yyyy-MM-dd");
      const plus30Str = format(addDays(today, 30), "yyyy-MM-dd");

      const { data: certClientes } = await supabase
        .from("clientes")
        .select("id, cert_a1_vencimento")
        .eq("cancelado", false)
        .not("cert_a1_vencimento", "is", null)
        .gte("cert_a1_vencimento", minus20Str)
        .lte("cert_a1_vencimento", plus30Str) as any;

      const oportunidadesJanela = certClientes?.length || 0;
      const vencendo30 = certClientes?.filter((c: any) => c.cert_a1_vencimento >= todayStr && c.cert_a1_vencimento <= plus30Str).length || 0;
      const vencidos20 = certClientes?.filter((c: any) => c.cert_a1_vencimento >= minus20Str && c.cert_a1_vencimento < todayStr).length || 0;

      // Sem data
      const { count: semData } = await supabase
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("cancelado", false)
        .is("cert_a1_vencimento", null) as any;

      // Detail list for table (all statuses - filtering done client-side)
      const vendasDetalhe = (vendas ?? []).map(v => ({
        id: v.id,
        clienteNome: clientesMap[v.cliente_id]?.razao_social || "—",
        clienteFantasia: clientesMap[v.cliente_id]?.nome_fantasia || null,
        dataVenda: v.data_venda,
        valor: Number(v.valor_venda) || 0,
        status: v.status,
        vendedorId: v.vendedor_id,
      })).sort((a, b) => (b.dataVenda > a.dataVenda ? 1 : -1));

      return {
        vendasQtd,
        faturamento,
        perdidoQtd,
        oportunidadesJanela,
        vencendo30,
        vencidos20,
        semData: semData || 0,
        vendasPorFunc,
        vendasDetalhe,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Apply client-side filters on the detail table
  const vendasFiltradas = useMemo(() => {
    if (!metrics?.vendasDetalhe) return [];
    return metrics.vendasDetalhe.filter(v => {
      if (statusFilter !== "todos" && v.status !== statusFilter) return false;
      if (vendedorFilter !== "todos" && String(v.vendedorId) !== vendedorFilter) return false;
      return true;
    });
  }, [metrics?.vendasDetalhe, statusFilter, vendedorFilter]);

  const chartData = useMemo(() => {
    if (!metrics?.vendasPorFunc) return [];
    return Object.entries(metrics.vendasPorFunc)
      .map(([id, qtd]) => ({
        nome: funcionarios.find((f) => f.id === Number(id))?.nome || `ID ${id}`,
        qtd,
      }))
      .sort((a, b) => b.qtd - a.qtd);
  }, [metrics?.vendasPorFunc, funcionarios]);

  // Vendedores que aparecem nas vendas do período (para o filtro)
  const vendedoresNoFiltro = useMemo(() => {
    if (!metrics?.vendasDetalhe) return [];
    const ids = [...new Set(metrics.vendasDetalhe.map(v => v.vendedorId).filter(Boolean))];
    return ids.map(id => ({
      id: String(id),
      nome: funcionarios.find(f => f.id === id)?.nome || `ID ${id}`,
    })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [metrics?.vendasDetalhe, funcionarios]);

  const val = (v: number | undefined) => (isLoading ? "—" : String(v ?? 0));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="max-w-xs">
          <DateRangePicker label="Período" value={periodo} onChange={setPeriodo} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Vendedor</Label>
          <Select value={vendedorFilter} onValueChange={setVendedorFilter}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {vendedoresNoFiltro.map(v => (
                <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <KPICardEnhanced
          label="Vendas no Período"
          value={val(metrics?.vendasQtd)}
          icon={<TrendingUp className="h-4 w-4 text-green-600" />}
          variant="success"
          size="sm"
        />
        <KPICardEnhanced
          label="Perdidos"
          value={val(metrics?.perdidoQtd)}
          icon={<UserX className="h-4 w-4 text-destructive" />}
          variant="destructive"
          size="sm"
        />
        <KPICardEnhanced
          label="Faturamento"
          value={isLoading ? "—" : formatBRL.format(metrics?.faturamento ?? 0)}
          icon={<DollarSign className="h-4 w-4 text-green-600" />}
          variant="success"
          size="sm"
        />
        <KPICardEnhanced
          label="Oport. Janela"
          value={val(metrics?.oportunidadesJanela)}
          icon={<ShieldCheck className="h-4 w-4 text-primary" />}
          variant="primary"
          size="sm"
        />
        <KPICardEnhanced
          label="Vencendo 30d"
          value={val(metrics?.vencendo30)}
          icon={<ShieldAlert className="h-4 w-4 text-amber-600" />}
          variant="warning"
          size="sm"
        />
        <KPICardEnhanced
          label="Vencidos 20d"
          value={val(metrics?.vencidos20)}
          icon={<ShieldOff className="h-4 w-4 text-destructive" />}
          variant="destructive"
          size="sm"
        />
        <KPICardEnhanced
          label="Sem Data"
          value={val(metrics?.semData)}
          icon={<ShieldQuestion className="h-4 w-4 text-muted-foreground" />}
          variant="default"
          size="sm"
        />
      </div>

      {/* Gráfico vendas por funcionário */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Qtde de Vendas por Funcionário
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma venda no período selecionado.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(250, chartData.length * 40)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" allowDecimals={false} className="text-xs fill-muted-foreground" />
                <YAxis type="category" dataKey="nome" width={140} className="text-xs fill-muted-foreground" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                />
                <Bar dataKey="qtd" name="Vendas" radius={[0, 4, 4, 0]} className="fill-primary" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tabela detalhada de vendas */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <List className="h-4 w-4 text-muted-foreground" />
            Vendas Detalhadas ({vendasFiltradas.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vendasFiltradas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma venda encontrada com os filtros selecionados.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Data Venda</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendasFiltradas.map((v) => {
                  const vendedorNome = v.vendedorId
                    ? funcionarios.find((f) => f.id === v.vendedorId)?.nome || `ID ${v.vendedorId}`
                    : "—";
                  const statusLabel: Record<string, string> = {
                    ganho: "Ganho",
                    perdido_terceiro: "Perdido p/ Terceiro",
                    pendente: "Pendente",
                  };
                  const statusVariant = v.status === "ganho" ? "default" : v.status === "perdido_terceiro" ? "destructive" : "secondary";
                  return (
                    <TableRow key={v.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium text-foreground">{v.clienteNome}</span>
                          {v.clienteFantasia && (
                            <span className="block text-xs text-muted-foreground">{v.clienteFantasia}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{v.dataVenda ? format(new Date(v.dataVenda + "T00:00:00"), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell>{vendedorNome}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant as any}>{statusLabel[v.status] || v.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatBRL.format(v.valor)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
