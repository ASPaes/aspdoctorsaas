import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ExternalLink } from "lucide-react";
import { formatMinUtil, formatMinCal } from "./slaFormat";

export interface LinhaDrilldown {
  journeyId: string;
  cliente: string;
  responsavel: string;
  /** minutos de expediente */
  util: number | null;
  /** minutos de calendário */
  cal: number | null;
  /** consumo do SLA em %, quando existe alvo. `null` quando não existe. */
  pctSla: number | null;
}

/**
 * Painel que mostra de onde veio um número agregado. Sem paginação de propósito:
 * a lista já está em memória — é dela que a média foi calculada — e paginar
 * quebraria a promessa de "isto é tudo que entrou na conta".
 */
export default function DrilldownSheet({
  open, onOpenChange, titulo, regra, linhas, unidade,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  titulo: string;
  /** Uma frase dizendo COMO o número foi calculado. É o que torna a tela rastreável. */
  regra: string;
  linhas: LinhaDrilldown[];
  unidade: "util" | "cal";
}) {
  const valor = (l: LinhaDrilldown) => (unidade === "util" ? l.util : l.cal);
  const medidos = linhas.filter((l) => valor(l) != null);
  const soma = medidos.reduce((s, l) => s + (valor(l) as number), 0);
  const fmt = unidade === "util" ? formatMinUtil : formatMinCal;
  const ordenadas = [...linhas].sort((a, b) => (valor(b) ?? -1) - (valor(a) ?? -1));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>{regra}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 mt-2">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground sticky top-0">
              <tr className="text-left">
                <th className="px-2 py-2 font-medium">Cliente</th>
                <th className="px-2 py-2 font-medium">Responsável</th>
                <th className="px-2 py-2 font-medium text-right">Expediente</th>
                <th className="px-2 py-2 font-medium text-right">Calendário</th>
                <th className="px-2 py-2 font-medium text-right">% SLA</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((l, i) => (
                <tr key={`${l.journeyId}-${i}`} className="border-t border-border hover:bg-muted/20">
                  <td className="px-2 py-2 font-medium">{l.cliente}</td>
                  <td className="px-2 py-2 text-muted-foreground">{l.responsavel}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.util == null ? "—" : formatMinUtil(l.util)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                    {l.cal == null ? "—" : formatMinCal(l.cal)}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums ${l.pctSla != null && l.pctSla >= 100 ? "text-destructive font-medium" : ""}`}>
                    {l.pctSla == null ? "—" : `${l.pctSla}%`}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Link
                      to={`/onboarding-implantacao?journey=${l.journeyId}`}
                      className="text-muted-foreground hover:text-foreground inline-flex"
                      title="Abrir a jornada"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
          {medidos.length === 0 ? (
            `Nenhum dos ${linhas.length} itens tem tempo medido.`
          ) : (
            <>
              A conta: <b className="text-foreground">{fmt(soma)}</b> ÷ {medidos.length} ={" "}
              <b className="text-foreground">{fmt(soma / medidos.length)}</b>
              {medidos.length < linhas.length && (
                <> · {linhas.length - medidos.length} sem tempo medido ficaram fora do numerador</>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
