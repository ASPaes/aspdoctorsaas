import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, DollarSign, Percent, BarChart3, Calculator, ArrowUpDown, Zap, Minus, Equal } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";
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

/* ── KPI key mapping for each step ── */

const STEP_KPI_KEYS: Record<string, string> = {
  "Receita (MRR Atual)": "ef_receita_mrr",
  "(-) Custo Operação (COGS)": "ef_cogs",
  "Receita após COGS": "ef_receita_apos_cogs",
  "(-) Impostos": "ef_impostos",
  "Margem de Contribuição": "ef_margem_contribuicao",
  "MC %": "ef_mc_percent",
  "(-) Custos Fixos": "ef_custos_fixos",
  "Markup COGS": "ef_markup_cogs",
  "Fator Preço": "ef_fator_preco",
  "Lucro Real": "ef_lucro_real",
  "Lucro Real %": "ef_lucro_real_percent",
};

/* ── Color helpers ── */

function valueColor(value: number | null) {
  if (value === null || isNaN(value)) return "text-foreground";
  if (value > 0) return "text-green-700 dark:text-green-400";
  if (value < 0) return "text-primary";
  return "text-foreground";
}

function cardBg(value: number | null, isDeduction = false) {
  if (value === null || isNaN(value)) return "bg-muted/50";
  if (isDeduction) return "bg-primary/10 dark:bg-primary/20";
  if (value > 0) return "bg-green-50 dark:bg-green-950/30";
  if (value < 0) return "bg-primary/10 dark:bg-primary/20";
  return "bg-muted/50";
}

/* ── Step row (used in the funnel) ── */

interface StepProps {
  label: string;
  value: string;
  raw: number | null;
  icon: React.ElementType;
  isDeduction?: boolean;
  large?: boolean;
  extra?: React.ReactNode;
}

function StepCard({ label, value, raw, icon: Icon, isDeduction = false, large = false, extra }: StepProps) {
  return (
    <Card className={`border-0 shadow-sm ${cardBg(raw, isDeduction)}`}>
      <CardContent className={large ? "p-4" : "p-3"}>
        <div className="flex items-center justify-between mb-1">
          <Icon className="h-3.5 w-3.5 opacity-60" />
          <div className="flex items-center gap-1">
            {STEP_KPI_KEYS[label] && <KpiHelpPopover kpiKey={STEP_KPI_KEYS[label]} />}
            {raw !== null && !isNaN(raw) && !isDeduction && (
              raw > 0
                ? <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                : <TrendingDown className="h-3.5 w-3.5 text-primary" />
            )}
          </div>
        </div>
        <p className="text-[11px] font-medium opacity-70 leading-tight">{label}</p>
        <p className={`${large ? "text-xl" : "text-base"} font-bold mt-0.5 ${valueColor(raw)}`}>{value}</p>
        {extra}
      </CardContent>
    </Card>
  );
}

/* ── Main component ── */

interface Props {
  espelho: EspelhoResult;
  showEspelho?: boolean;
  isEditing?: boolean;
  onOpenMrrModal?: () => void;
  clienteId?: string;
  mensalidadeBase?: number;
  custoBase?: number;
  totalUpsell: number;
  totalCrossSell: number;
  totalDownsell: number;
  totalVendasAvulsas: number;
  somaDeltaMrr: number;
  qtdMovimentos: number;
}

export default function EspelhoFinanceiro({
  espelho,
  showEspelho = true,
  isEditing = false,
  onOpenMrrModal,
  clienteId,
  mensalidadeBase = 0,
  custoBase = 0,
  totalUpsell,
  totalCrossSell,
  totalDownsell,
  totalVendasAvulsas,
  somaDeltaMrr,
  qtdMovimentos,
}: Props) {
  const mrrAtual = espelho.mrrEfetivo;
  const custoAtual = espelho.custoEfetivo;
  const lucroReal = espelho.lucro_real;
  const lucroPositivo = lucroReal !== null && !isNaN(lucroReal) && lucroReal > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-4">

        {/* ═══════ A) COMPOSIÇÃO MRR ═══════ */}
        {clienteId && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Composição MRR</h3>
                {qtdMovimentos > 0 && (
                  <span className="ml-auto text-xs font-medium text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">
                    {qtdMovimentos} movimento{qtdMovimentos !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {isEditing && onOpenMrrModal && (
                <Button type="button" variant="outline" size="sm" onClick={onOpenMrrModal}>
                  <ArrowUpDown className="h-4 w-4 mr-2" />
                  Movimentos MRR
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {/* MRR Base + Custo Base */}
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

              {/* Movimentos Breakdown */}
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
                        <span className="text-xs">V. Avulsas (ativação)</span>
                      </div>
                      <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">{fmt(totalVendasAvulsas)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* MRR Atual + Custo Atual */}
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

            <Separator className="my-2" />
          </>
        )}

        {showEspelho && (
        <>
        {/* ═══════ B) ESPELHO FINANCEIRO — funil lógico ═══════ */}
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Espelho Financeiro</h3>
        </div>

        {/* Linha 1: Receita → (−) COGS → (=) Receita após COGS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <StepCard label="Receita (MRR Atual)" value={fmt(mrrAtual)} raw={mrrAtual} icon={DollarSign} />
          <StepCard label="(-) Custo Operação (COGS)" value={fmt(custoAtual)} raw={custoAtual} icon={Minus} isDeduction />
          <StepCard label="Receita após COGS" value={fmt(espelho.valor_apos_cogs)} raw={espelho.valor_apos_cogs} icon={Equal} />
        </div>

        {/* Linha 2: (−) Impostos → MC R$ → MC % */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <StepCard label="(-) Impostos" value={fmt(espelho.impostos_rs)} raw={espelho.impostos_rs} icon={Calculator} isDeduction />
          <StepCard label="Margem de Contribuição" value={fmt(espelho.margem_contribuicao)} raw={espelho.margem_contribuicao} icon={TrendingUp} />
          <StepCard label="MC %" value={fmtPct(espelho.margem_contribuicao_percent)} raw={espelho.margem_contribuicao_percent} icon={Percent} />
        </div>

        {/* Linha 3: (−) Custos Fixos → Indicadores auxiliares */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <StepCard label="(-) Custos Fixos" value={fmt(espelho.fixos_rs)} raw={espelho.fixos_rs} icon={Calculator} isDeduction />
          <StepCard label="Markup COGS" value={fmtPct(espelho.markup_cogs_percent)} raw={espelho.markup_cogs_percent} icon={BarChart3} />
          <StepCard label="Fator Preço" value={fmtX(espelho.fator_preco_x)} raw={espelho.fator_preco_x} icon={BarChart3} />
        </div>

        {/* Destaque: Lucro Real */}
        <Card className={`border-2 shadow-md ${lucroPositivo
          ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30"
          : "border-primary/30 dark:border-primary/50 bg-primary/10 dark:bg-primary/20"
        }`}>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium opacity-70">Lucro Real</p>
                <KpiHelpPopover kpiKey="ef_lucro_real" />
              </div>
              <div className="flex items-baseline gap-3">
                <p className={`text-2xl font-bold ${lucroPositivo ? "text-green-700 dark:text-green-400" : "text-primary"}`}>
                  {fmt(lucroReal)}
                </p>
                {espelho.lucro_real_percent !== null && (
                  <p className={`text-sm font-semibold ${lucroPositivo ? "text-green-600 dark:text-green-400" : "text-primary"}`}>
                    {fmtPct(espelho.lucro_real_percent)}
                  </p>
                )}
              </div>
            </div>
            {lucroPositivo
              ? <TrendingUp className="h-8 w-8 text-green-500 dark:text-green-400" />
              : <TrendingDown className="h-8 w-8 text-primary" />
            }
          </CardContent>
        </Card>
        </>
        )}
      </div>
    </div>
  );
}
