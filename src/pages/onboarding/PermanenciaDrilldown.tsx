import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { exportDrilldownPermanenciaXlsx } from "@/lib/exportOnboardingDrilldownXlsx";
import type { ClientePermanencia } from "./permanencia";

/**
 * De onde veio o número da permanência. Sem paginação, pelo mesmo motivo do
 * `DrilldownSheet` de SLA: a lista JÁ está em memória — é dela que a conta saiu —
 * e paginar quebraria a promessa de "isto é tudo que entrou".
 *
 * É esta lista que o tenant confere para pagar a comissão, então ela mostra a data
 * da entrega e os DIAS exatos até a saída, não só o mês.
 */
export default function PermanenciaDrilldown({
  open, onOpenChange, titulo, regra, linhas, nomeCliente, nomeImplantador,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  titulo: string;
  /** Uma frase dizendo COMO o número foi calculado. */
  regra: string;
  linhas: ClientePermanencia[];
  nomeCliente: (journeyId: string) => string;
  nomeImplantador: (userId: string | null) => string;
}) {
  const fmt = (d: string) => d.split("-").reverse().join("/");
  // Quem saiu primeiro no topo; quem permanece no fim.
  const ordenadas = [...linhas].sort((a, b) => (a.dias ?? Infinity) - (b.dias ?? Infinity));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader className="pr-8">
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>{regra}</SheetDescription>
        </SheetHeader>

        <div className="flex justify-end mt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={ordenadas.length === 0}
            onClick={() => exportDrilldownPermanenciaXlsx({ titulo, linhas: ordenadas, nomeCliente, nomeImplantador })}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar Excel
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto mt-2">
          {ordenadas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhum cliente nesta conta.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 font-medium">Cliente</th>
                  <th className="py-2 font-medium">Implantador</th>
                  <th className="py-2 pl-3 font-medium text-right">Entrega</th>
                  <th className="py-2 pl-3 font-medium text-right">Saída</th>
                  <th className="py-2 pl-3 font-medium text-right">Dias</th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((c) => (
                  <tr key={c.clienteId} className="border-b border-border/50">
                    <td className="py-2 pr-2">{nomeCliente(c.journeyId)}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{nomeImplantador(c.implantadorId)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{fmt(c.entrega)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{c.saida ? fmt(c.saida) : "—"}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-medium">
                      {c.dias == null ? (
                        <span className="text-[hsl(142_71%_45%)]">na base</span>
                      ) : (
                        c.dias
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
          {ordenadas.length} {ordenadas.length === 1 ? "cliente" : "clientes"}
        </p>
      </SheetContent>
    </Sheet>
  );
}
