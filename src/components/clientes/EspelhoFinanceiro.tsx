import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Percent, BarChart3, Calculator, ArrowUpDown, Zap, ShoppingCart } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { EspelhoResult } from "@/hooks/useEspelhoFinanceiro";

function fmt(value: number | null) {
  if (value === null || isNaN(value)) return "—";
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(value: number | null) {
  if (value === null || isNaN(value) || !isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function fmtX(value: number | null) {
  if (value === null || isNaN(value) || !isFinite(value)) return "—";
  return `${value.toFixed(2)}x`;
}

function getColorClasses(value: number | null, isCost = false) {
  if (value === null || isNaN(value)) return "bg-muted/50 text-foreground";
  if (isCost) return "bg-primary/10 dark:bg-primary/20 text-primary";
  if (value > 0) return "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400";
  if (value < 0) return "bg-primary/10 dark:bg-primary/20 text-primary";
  return "bg-muted/50 text-foreground";
}

interface MovimentoMrr {
  id: string;
  tipo: string;
  valor_delta: number;
  custo_delta: number;
  valor_venda_avulsa: number | null;
  status: string;
  estorno_de: string | null;
  estornado_por: string | null;
}

function useMrrTotals(clienteId?: string) {
  return useQuery({
    queryKey: ["movimentos_mrr_totals", clienteId],
    queryFn: async () => {
      if (!clienteId) return null;
      const { data, error } = await supabase
        .from("movimentos_mrr")
        .select("tipo, valor_delta, custo_delta, valor_venda_avulsa, status, estorno_de, estornado_por")
        .eq("cliente_id", clienteId);
      if (error) throw error;
      return data as unknown as MovimentoMrr[];
    },
    enabled: !!clienteId,
  });
}

interface Props {
  espelho: EspelhoResult;
  clienteId?: string;
  mensalidadeBase?: number;
  custoBase?: number;
}

export default function EspelhoFinanceiro({ espelho, clienteId, mensalidadeBase = 0, custoBase = 0 }: Props) {
  const { data: movimentos } = useMrrTotals(clienteId);

  // MRR calculations
  const movimentosAtivos = (movimentos ?? []).filter(
    (m) => m.status === "ativo" && !m.estornado_por && !m.estorno_de && m.tipo !== "venda_avulsa"
  );
  const vendasAvulsas = (movimentos ?? []).filter(
    (m) => m.status === "ativo" && m.tipo === "venda_avulsa"
  );

  const totalUpsell = movimentosAtivos.filter((m) => m.tipo === "upsell").reduce((s, m) => s + m.valor_delta, 0);
  const totalCrossSell = movimentosAtivos.filter((m) => m.tipo === "cross_sell").reduce((s, m) => s + m.valor_delta, 0);
  const totalDownsell = movimentosAtivos.filter((m) => m.tipo === "downsell").reduce((s, m) => s + Math.abs(m.valor_delta), 0);
  const totalVendasAvulsas = vendasAvulsas.reduce((s, m) => s + (m.valor_venda_avulsa || 0), 0);
  const somaDeltaMrr = movimentosAtivos.reduce((s, m) => s + m.valor_delta, 0);
  const somaDeltaCusto = movimentosAtivos.reduce((s, m) => s + (m.custo_delta || 0), 0);
  const mrrAtual = mensalidadeBase + somaDeltaMrr;
  const custoAtual = custoBase + somaDeltaCusto;
  const qtdMovimentos = (movimentos ?? []).filter((m) => m.status === "ativo").length;

  const hasMrrData = clienteId && movimentos && movimentos.length > 0;

  const metrics = [
    { label: "Valor Repasse", value: fmt(espelho.valor_repasse), raw: espelho.valor_repasse, icon: DollarSign, isCost: false },
    { label: "Impostos", value: fmt(espelho.impostos_rs), raw: espelho.impostos_rs, icon: Calculator, isCost: true },
    { label: "Custos Fixos", value: fmt(espelho.fixos_rs), raw: espelho.fixos_rs, icon: Calculator, isCost: true },
    { label: "Lucro Bruto", value: fmt(espelho.lucro_bruto), raw: espelho.lucro_bruto, icon: TrendingUp, isCost: false },
    { label: "Margem Bruta", value: fmtPct(espelho.margem_bruta_percent), raw: espelho.margem_bruta_percent, icon: Percent, isCost: false },
    { label: "Markup COGS", value: fmtPct(espelho.markup_cogs_percent), raw: espelho.markup_cogs_percent, icon: BarChart3, isCost: false },
    { label: "Fator Preço", value: fmtX(espelho.fator_preco_x), raw: espelho.fator_preco_x, icon: BarChart3, isCost: false },
    { label: "Margem Contribuição", value: fmt(espelho.margem_contribuicao), raw: espelho.margem_contribuicao, icon: TrendingUp, isCost: false },
  ];

  const lucroReal = espelho.lucro_real;
  const lucroPositivo = lucroReal !== null && !isNaN(lucroReal) && lucroReal > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Espelho Financeiro</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map((item) => {
          const Icon = item.icon;
          const isPositive = item.raw !== null && !isNaN(item.raw) && item.raw > 0;
          return (
            <Card key={item.label} className={`border-0 shadow-sm ${getColorClasses(item.raw, item.isCost)}`}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <Icon className="h-3.5 w-3.5 opacity-60" />
                  {item.raw !== null && !isNaN(item.raw) && !item.isCost && (
                    isPositive
                      ? <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                      : <TrendingDown className="h-3.5 w-3.5 text-primary" />
                  )}
                </div>
                <p className="text-[11px] font-medium opacity-70 leading-tight">{item.label}</p>
                <p className="text-base font-bold mt-0.5">{item.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Destaque: Lucro Real */}
      <Card className={`border-2 shadow-md ${lucroPositivo
        ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30"
        : "border-primary/30 dark:border-primary/50 bg-primary/10 dark:bg-primary/20"
      }`}>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium opacity-70">Lucro Real</p>
            <p className={`text-2xl font-bold ${lucroPositivo
              ? "text-green-700 dark:text-green-400"
              : "text-primary"
            }`}>
              {fmt(lucroReal)}
            </p>
          </div>
          {lucroPositivo
            ? <TrendingUp className="h-8 w-8 text-green-500 dark:text-green-400" />
            : <TrendingDown className="h-8 w-8 text-primary" />
          }
        </CardContent>
      </Card>

      {/* MRR Totals Section */}
      {clienteId && (
        <>
          <Separator className="my-2" />

          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">Composição MRR</h3>
            {qtdMovimentos > 0 && (
              <span className="ml-auto text-xs font-medium text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">
                {qtdMovimentos} movimento{qtdMovimentos !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* MRR Flow: Base → Movements → Current */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* MRR Base */}
            <Card className="border border-border/60 bg-card shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">MRR Base</p>
                    <p className="text-xl font-bold">{fmt(mensalidadeBase)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Custo base: {fmt(custoBase)}</p>
              </CardContent>
            </Card>

            {/* Movements Breakdown */}
            <Card className="border border-border/60 bg-card shadow-sm">
              <CardContent className="p-4 space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Movimentos</p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="text-xs">Upsell</span>
                    </div>
                    <span className="text-xs font-semibold text-green-600 dark:text-green-400">+{fmt(totalUpsell)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                      <span className="text-xs">Cross-sell</span>
                    </div>
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">+{fmt(totalCrossSell)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-orange-500" />
                      <span className="text-xs">Downsell</span>
                    </div>
                    <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">-{fmt(totalDownsell)}</span>
                  </div>
                  <Separator className="my-1" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-purple-500" />
                      <span className="text-xs">V. Avulsas</span>
                    </div>
                    <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">{fmt(totalVendasAvulsas)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* MRR Current */}
            <Card className={`border-2 shadow-md ${
              mrrAtual > mensalidadeBase
                ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30"
                : mrrAtual < mensalidadeBase
                  ? "border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30"
                  : "border-primary/30 bg-primary/5"
            }`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                    mrrAtual > mensalidadeBase
                      ? "bg-green-100 dark:bg-green-900/50"
                      : mrrAtual < mensalidadeBase
                        ? "bg-orange-100 dark:bg-orange-900/50"
                        : "bg-primary/10"
                  }`}>
                    <Zap className={`h-4 w-4 ${
                      mrrAtual > mensalidadeBase
                        ? "text-green-600 dark:text-green-400"
                        : mrrAtual < mensalidadeBase
                          ? "text-orange-600 dark:text-orange-400"
                          : "text-primary"
                    }`} />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">MRR Atual</p>
                    <p className={`text-xl font-bold ${
                      mrrAtual > mensalidadeBase
                        ? "text-green-700 dark:text-green-400"
                        : mrrAtual < mensalidadeBase
                          ? "text-orange-700 dark:text-orange-400"
                          : "text-foreground"
                    }`}>
                      {fmt(mrrAtual)}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Custo atual: {fmt(custoAtual)}</p>
                {somaDeltaMrr !== 0 && (
                  <p className={`text-xs font-medium mt-1 ${somaDeltaMrr > 0 ? "text-green-600 dark:text-green-400" : "text-orange-600 dark:text-orange-400"}`}>
                    {somaDeltaMrr > 0 ? "+" : ""}{fmt(somaDeltaMrr)} vs base
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
