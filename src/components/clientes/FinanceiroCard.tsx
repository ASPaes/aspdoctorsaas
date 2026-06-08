import { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useEspelhoFinanceiro } from "@/hooks/useEspelhoFinanceiro";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { NumericInput } from "@/components/ui/numeric-input";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";
import { Percent, ArrowUpDown, TrendingUp, TrendingDown } from "lucide-react";
import type { ClienteFormValues } from "@/pages/ClienteForm";

interface FinanceiroCardProps {
  form: UseFormReturn<ClienteFormValues>;
  clienteId?: string;
  isEditing?: boolean;
  onOpenMrrModal?: () => void;
}

interface MovimentoMrr {
  tipo: string;
  valor_delta: number;
  custo_delta: number;
  valor_venda_avulsa: number | null;
  status: string;
  estorno_de: string | null;
  estornado_por: string | null;
}

const fmt = (v: number | null) =>
  v === null || isNaN(v)
    ? "—"
    : `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number | null) =>
  v === null || isNaN(v) || !isFinite(v) ? "—" : `${v.toFixed(2)}%`;
const fmtX = (v: number | null) =>
  v === null || isNaN(v) || !isFinite(v) ? "—" : `${v.toFixed(2)}x`;

const STEP_KPI_KEYS: Record<string, string> = {
  "Receita (MRR)": "ef_receita_mrr",
  "(-) COGS": "ef_cogs",
  "Após COGS": "ef_receita_apos_cogs",
  "(-) Impostos": "ef_impostos",
  "(-) Custos fixos": "ef_custos_fixos",
  "Margem contribuição": "ef_margem_contribuicao",
  "Markup COGS": "ef_markup_cogs",
  "Fator preço": "ef_fator_preco",
  "Lucro real": "ef_lucro_real",
};

interface MiniCardProps {
  label: string;
  value: string;
  tone?: "neutral" | "deduction" | "result";
  sub?: React.ReactNode;
  kpiKey?: string;
}

function MiniCard({ label, value, tone = "neutral", sub, kpiKey }: MiniCardProps) {
  const bg =
    tone === "deduction"
      ? "bg-destructive/10 border-destructive/20"
      : tone === "result"
        ? "bg-primary/10 border-primary/20"
        : "bg-muted/50 border-border/40";
  const valueColor =
    tone === "deduction" ? "text-destructive" : tone === "result" ? "text-primary" : "text-foreground";
  return (
    <div className={`rounded-md border p-2 ${bg}`}>
      <div className="flex items-center gap-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium leading-tight">
          {label}
        </p>
        {kpiKey && <KpiHelpPopover kpiKey={kpiKey} />}
      </div>
      <p className={`text-base font-bold mt-0.5 ${valueColor}`}>{value}</p>
      {sub}
    </div>
  );
}

export default function FinanceiroCard({
  form,
  clienteId,
  isEditing,
  onOpenMrrModal,
}: FinanceiroCardProps) {
  const mensalidade = form.watch("mensalidade");
  const custo_operacao = form.watch("custo_operacao");
  const imposto_percentual = form.watch("imposto_percentual");
  const custo_fixo_percentual = form.watch("custo_fixo_percentual");

  const { can } = usePermissions();
  const canVerCustos = can("clientes.custos", "view");

  const { data: movimentos } = useQuery({
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

  const { data: totalAtivacao } = useQuery({
    queryKey: ["cliente_produtos_ativacao", clienteId],
    queryFn: async () => {
      if (!clienteId) return 0;
      const { data, error } = await (supabase.from("cliente_produtos" as any) as any)
        .select("vlr_ativacao")
        .eq("cliente_id", clienteId)
        .eq("ativo", true);
      if (error) return 0;
      return (data ?? []).reduce((s: number, p: any) => s + (Number(p.vlr_ativacao) || 0), 0);
    },
    enabled: !!clienteId,
  });

  const movimentosAtivos = (movimentos ?? []).filter(
    (m) =>
      m.status === "ativo" &&
      !m.estornado_por &&
      !m.estorno_de &&
      m.tipo !== "venda_avulsa" &&
      m.tipo !== "churn" &&
      m.tipo !== "reactivation"
  );
  const somaDeltaMrr = movimentosAtivos.filter((m) => m.tipo !== 'reajuste').reduce((s, m) => s + m.valor_delta, 0);
  const somaDeltaCusto = movimentosAtivos.filter((m) => m.tipo !== 'reajuste').reduce((s, m) => s + (m.custo_delta || 0), 0);
  const totalReajuste = movimentosAtivos.filter((m) => m.tipo === 'reajuste').reduce((s, m) => s + m.valor_delta, 0);

  const vendasAvulsas = (movimentos ?? []).filter(
    (m) => m.status === "ativo" && m.tipo === "venda_avulsa"
  );
  const totalVendasAvulsas = vendasAvulsas.reduce((s, m) => s + (m.valor_venda_avulsa || 0), 0);

  const totalUpsell = movimentosAtivos
    .filter((m) => m.tipo === "upsell")
    .reduce((s, m) => s + m.valor_delta, 0);
  const totalCrossSell = movimentosAtivos
    .filter((m) => m.tipo === "cross_sell")
    .reduce((s, m) => s + m.valor_delta, 0);
  const totalDownsell = movimentosAtivos
    .filter((m) => m.tipo === "downsell")
    .reduce((s, m) => s + Math.abs(m.valor_delta), 0);

  const espelho = useEspelhoFinanceiro({
    mensalidade: mensalidade ?? null,
    custo_operacao: custo_operacao ?? null,
    imposto_percentual: imposto_percentual ?? null,
    custo_fixo_percentual: custo_fixo_percentual ?? null,
    deltaMrr: somaDeltaMrr + totalReajuste,
    deltaCusto: somaDeltaCusto,
  });

  const mensalidadeBase = mensalidade ?? 0;
  const custoBase = custo_operacao ?? 0;
  const mrrAtual = espelho.mrrEfetivo;
  const custoAtual = espelho.custoEfetivo;
  const lucroPositivo = espelho.lucro_real > 0;

  // MRR comparison styles
  const mrrUp = mrrAtual > mensalidadeBase;
  const mrrDown = mrrAtual < mensalidadeBase;
  const mrrAtualBlockClass = mrrUp
    ? "border-green-500/40 bg-green-500/10"
    : mrrDown
      ? "border-orange-500/40 bg-orange-500/10"
      : "border-primary/30 bg-primary/10";
  const mrrAtualValueClass = mrrUp
    ? "text-green-600 dark:text-green-400"
    : mrrDown
      ? "text-orange-600 dark:text-orange-400"
      : "text-primary";

  if (!canVerCustos) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Percent className="h-5 w-5 text-primary" />
          Parâmetros Financeiros
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Seção 1: Campos editáveis */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="imposto_percentual"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Imposto % *</FormLabel>
                <FormControl>
                  <NumericInput
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="0,00"
                    decimals={2}
                    suffix="%"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="custo_fixo_percentual"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Custo Fixo % *</FormLabel>
                <FormControl>
                  <NumericInput
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="0,00"
                    decimals={2}
                    suffix="%"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        {/* Seção 2: Pipeline MRR */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Composição MRR
            </p>
            {isEditing && onOpenMrrModal && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenMrrModal}>
                <ArrowUpDown className="h-4 w-4 mr-1" />
                Movimentos MRR
              </Button>
            )}
          </div>
          <div className="flex flex-col md:flex-row md:items-stretch">
            {/* MRR Base */}
            <div className="flex-1 border border-border/60 bg-card p-3 rounded-md md:rounded-r-none md:border-r-0">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                MRR Base
              </p>
              <p className="text-lg font-bold mt-0.5">{fmt(mensalidadeBase)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Custo: {fmt(custoBase)}
              </p>
            </div>
            {/* Movimentos */}
            <div className="flex-1 border border-border/60 bg-card p-3 md:rounded-none">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                Movimentos
              </p>
              <div className="space-y-0.5">
                <p className="text-[11px] text-green-500">
                  ↑ Upsell +{fmt(totalUpsell)}
                </p>
                <p className="text-[11px] text-blue-500">
                  → Cross +{fmt(totalCrossSell)}
                </p>
                <p className="text-[11px] text-orange-500">
                  ↓ Down -{fmt(totalDownsell)}
                </p>
                <p className="text-[11px] text-purple-500">
                  ● Avulsa {fmt(totalVendasAvulsas)}
                </p>
                <p className="text-[11px] text-cyan-500">
                  % Reajuste +{fmt(totalReajuste)}
                </p>
              </div>
            </div>
            {/* MRR Atual */}
            <div
              className={`flex-1 border-2 p-3 rounded-md md:rounded-l-none text-right ${mrrAtualBlockClass}`}
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                MRR Atual
              </p>
              <p className={`text-xl font-bold mt-0.5 ${mrrAtualValueClass}`}>
                {fmt(mrrAtual)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Custo: {fmt(custoAtual)}
              </p>
            </div>
          </div>
        </div>

        {(totalAtivacao ?? 0) > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Total Ativação (produtos)
              </p>
              <p className="text-lg font-bold mt-0.5 text-amber-500">
                {fmt(totalAtivacao ?? 0)}
              </p>
            </div>
          </div>
        )}

        {/* Seção 3: Espelho Financeiro (admin/super_admin only) */}
        {canVerCustos && (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Espelho Financeiro
              </p>

              {/* Row 1: Receita - COGS = Após COGS */}
              <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
                <MiniCard
                  label="Receita (MRR)"
                  value={fmt(mrrAtual)}
                  kpiKey={STEP_KPI_KEYS["Receita (MRR)"]}
                />
                <span className="text-muted-foreground text-lg font-medium">−</span>
                <MiniCard
                  label="(-) COGS"
                  value={fmt(custoAtual)}
                  tone="deduction"
                  kpiKey={STEP_KPI_KEYS["(-) COGS"]}
                />
                <span className="text-muted-foreground text-lg font-medium">=</span>
                <MiniCard
                  label="Após COGS"
                  value={fmt(espelho.valor_apos_cogs)}
                  kpiKey={STEP_KPI_KEYS["Após COGS"]}
                />
              </div>

              {/* Row 2: Impostos / Custos fixos / MC */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <MiniCard
                  label={`(-) Impostos ${fmtPct(imposto_percentual ?? 0)}`}
                  value={fmt(espelho.impostos_rs)}
                  tone="deduction"
                  kpiKey={STEP_KPI_KEYS["(-) Impostos"]}
                />
                <MiniCard
                  label={`(-) Custos fixos ${fmtPct(custo_fixo_percentual ?? 0)}`}
                  value={fmt(espelho.fixos_rs)}
                  tone="deduction"
                  kpiKey={STEP_KPI_KEYS["(-) Custos fixos"]}
                />
                <MiniCard
                  label="Margem contribuição"
                  value={fmt(espelho.margem_contribuicao)}
                  kpiKey={STEP_KPI_KEYS["Margem contribuição"]}
                  sub={
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      MC% {fmtPct(espelho.margem_contribuicao_percent)}
                    </p>
                  }
                />
              </div>

              {/* Row 3: Markup / Fator */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <MiniCard
                  label="Markup COGS"
                  value={fmtPct(espelho.markup_cogs_percent)}
                  kpiKey={STEP_KPI_KEYS["Markup COGS"]}
                />
                <MiniCard
                  label="Fator preço"
                  value={fmtX(espelho.fator_preco_x)}
                  kpiKey={STEP_KPI_KEYS["Fator preço"]}
                />
              </div>

              {/* Lucro Real */}
              <div
                className={`rounded-md border-2 p-3 flex items-center justify-between ${
                  lucroPositivo
                    ? "border-green-600/40 bg-green-500/10"
                    : "border-destructive/40 bg-destructive/10"
                }`}
              >
                <div>
                  <div className="flex items-center gap-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                      Lucro real
                    </p>
                    <KpiHelpPopover kpiKey={STEP_KPI_KEYS["Lucro real"]} />
                  </div>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <p
                      className={`text-2xl font-bold ${
                        lucroPositivo
                          ? "text-green-600 dark:text-green-400"
                          : "text-destructive"
                      }`}
                    >
                      {fmt(espelho.lucro_real)}
                    </p>
                    {espelho.lucro_real_percent !== null && (
                      <p
                        className={`text-sm font-semibold ${
                          lucroPositivo
                            ? "text-green-600 dark:text-green-400"
                            : "text-destructive"
                        }`}
                      >
                        {fmtPct(espelho.lucro_real_percent)}
                      </p>
                    )}
                  </div>
                </div>
                {lucroPositivo ? (
                  <TrendingUp className="h-7 w-7 text-green-500" />
                ) : (
                  <TrendingDown className="h-7 w-7 text-destructive" />
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
