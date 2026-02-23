import { Card, CardContent } from "@/components/ui/card";
import type { EspelhoResult } from "@/hooks/useEspelhoFinanceiro";

function fmt(value: number | null, suffix = "") {
  if (value === null || isNaN(value)) return "—";
  return `R$ ${value.toFixed(2)}${suffix}`;
}

function fmtPct(value: number | null) {
  if (value === null || isNaN(value) || !isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function fmtX(value: number | null) {
  if (value === null || isNaN(value) || !isFinite(value)) return "—";
  return `${value.toFixed(2)}x`;
}

interface Props {
  espelho: EspelhoResult;
}

export default function EspelhoFinanceiro({ espelho }: Props) {
  const items = [
    { label: "Valor Repasse", value: fmt(espelho.valor_repasse) },
    { label: "Impostos R$", value: fmt(espelho.impostos_rs) },
    { label: "Custos Fixos R$", value: fmt(espelho.fixos_rs) },
    { label: "Lucro Bruto", value: fmt(espelho.lucro_bruto) },
    { label: "Margem Bruta %", value: fmtPct(espelho.margem_bruta_percent) },
    { label: "Markup COGS %", value: fmtPct(espelho.markup_cogs_percent) },
    { label: "Fator Preço", value: fmtX(espelho.fator_preco_x) },
    { label: "Margem Contribuição", value: fmt(espelho.margem_contribuicao) },
    { label: "Lucro Real", value: fmt(espelho.lucro_real) },
  ];

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Espelho Financeiro</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {items.map((item) => (
          <Card key={item.label} className="bg-muted/50">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-lg font-bold">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
