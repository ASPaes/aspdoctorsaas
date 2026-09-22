import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink } from "lucide-react";
import { exportDrilldownJornadasXlsx } from "@/lib/exportOnboardingDrilldownXlsx";
import { COR_SITUACAO, dataCurta, diasDeVida, rotuloSituacao, type LinhaJornada } from "./jornadaLinha";

export type { LinhaJornada };

/**
 * Painel com os clientes por trás de um cartão de CONTAGEM da faixa de situação.
 *
 * Irmão do `DrilldownSheet`, não substituto: lá o número é uma média de tempo e as
 * colunas falam de minutos; aqui o número é "quantas jornadas", e o que o usuário
 * precisa ver é quem são elas, em que situação estão e há quanto tempo. Forçar as
 * duas perguntas no mesmo componente encheria a tabela de coluna vazia.
 *
 * Sem paginação, pelo mesmo motivo dos outros painéis: a lista JÁ está em memória —
 * é dela que a contagem saiu — e paginar quebraria a promessa de "isto é tudo que
 * entrou na conta".
 */
export default function JornadasDrilldown({
  open, onOpenChange, titulo, regra, linhas, ordem = "abertura",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  titulo: string;
  /** Uma frase dizendo COMO o cartão contou. É o que torna a tela rastreável. */
  regra: string;
  linhas: LinhaJornada[];
  /**
   * `abertura`: mais antiga primeiro — o que interessa no estoque em aberto é quem
   * está esperando há mais tempo. `desfecho`: mais recente primeiro, que é como se
   * lê uma lista do que terminou.
   */
  ordem?: "abertura" | "desfecho";
}) {
  const ts = (v: string | null) => (v ? new Date(v).getTime() : null);
  const ordenadas = [...linhas].sort((a, b) => {
    if (ordem === "desfecho") return (ts(b.fechadaEm) ?? -Infinity) - (ts(a.fechadaEm) ?? -Infinity);
    return (ts(a.abertaEm) ?? Infinity) - (ts(b.abertaEm) ?? Infinity);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col">
        <SheetHeader className="pr-8">
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>{regra}</SheetDescription>
        </SheetHeader>

        <div className="flex justify-end mt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={ordenadas.length === 0}
            onClick={() => exportDrilldownJornadasXlsx({ titulo, linhas: ordenadas })}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar Excel
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 mt-2">
          {ordenadas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma jornada nesta conta.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground sticky top-0">
                <tr className="text-left">
                  <th className="px-2 py-2 font-medium">Cliente</th>
                  <th className="px-2 py-2 font-medium">Responsável</th>
                  <th className="px-2 py-2 font-medium">Situação</th>
                  <th className="px-2 py-2 font-medium text-right">Aberta</th>
                  <th className="px-2 py-2 font-medium text-right">Desfecho</th>
                  <th className="px-2 py-2 font-medium text-right">Dias</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((l, i) => {
                  const dias = diasDeVida(l);
                  return (
                    <tr key={`${l.journeyId}-${i}`} className="border-t border-border hover:bg-muted/20">
                      <td className="px-2 py-2 font-medium">{l.cliente}</td>
                      <td className="px-2 py-2 text-muted-foreground">{l.responsavel}</td>
                      <td className={`px-2 py-2 whitespace-nowrap ${COR_SITUACAO[l.situacao ?? ""] ?? "text-muted-foreground"}`}>
                        {rotuloSituacao(l.situacao)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{dataCurta(l.abertaEm)}</td>
                      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                        {dataCurta(l.fechadaEm)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{dias == null ? "—" : dias}</td>
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
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
          <b className="text-foreground">{ordenadas.length}</b>{" "}
          {ordenadas.length === 1 ? "jornada" : "jornadas"} · Dias conta da abertura até o desfecho, ou até hoje
          quando a jornada segue aberta
        </div>
      </SheetContent>
    </Sheet>
  );
}
