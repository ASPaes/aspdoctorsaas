import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Percent, BarChart3, Calculator } from "lucide-react";
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

interface Props {
  espelho: EspelhoResult;
}

export default function EspelhoFinanceiro({ espelho }: Props) {
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
    </div>
  );
}
