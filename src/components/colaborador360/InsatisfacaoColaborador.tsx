import { format, parseISO } from "date-fns";
import { SquareArrowOutUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cartao, Etiqueta, Mini, Vazio } from "@/components/clientes/visao360/Visao360Ui";
import { cn } from "@/lib/utils";
import type { InsatisfacaoColaborador as Item } from "./useColaborador360";

/**
 * Clientes que se mostraram insatisfeitos com o atendimento enquanto o chat
 * era desta pessoa, com a frase do cliente. Conta atendimentos: a mesma
 * irritação percebida de novo no mesmo atendimento é uma só.
 */
export function InsatisfacaoColaborador({ itens, encerrados, onAbrir }: {
  itens: Item[];
  encerrados: number | null;
  onAbrir: (attendanceId: string) => void;
}) {
  const clientes = new Set(itens.map((i) => i.cliente ?? i.attendance_id)).size;
  const pct = encerrados ? Math.round((itens.length / encerrados) * 1000) / 10 : null;
  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Mini rotulo="Atendimentos com cliente insatisfeito" valor={itens.length} tom={itens.length >= 3 ? "ruim" : undefined} sub="no período" />
        <Mini rotulo="Dos encerrados" valor={pct != null ? `${String(pct).replace(".", ",")}%` : "—"} sub={encerrados ? `de ${encerrados} encerrados` : "sem encerrados no período"} />
        <Mini rotulo="Clientes diferentes" valor={clientes} sub={itens.length > clientes ? "algum cliente se repetiu" : "nenhum se repetiu"} />
      </div>
      <Cartao titulo="Clientes insatisfeitos com o atendimento" sub="o que a IA percebeu na conversa, com a frase do cliente">
        {itens.length === 0 ? (
          <Vazio>Nenhum cliente se mostrou insatisfeito com o atendimento no período.</Vazio>
        ) : (
          <ul className="px-4 pb-2">
            {itens.map((o, i) => (
              <li key={o.id} className={cn("py-3", i > 0 && "border-t")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Etiqueta tom="ruim">Insatisfeito</Etiqueta>
                  <span className="min-w-0 truncate text-[13px] font-semibold">{o.cliente ?? "Cliente sem cadastro"}</span>
                  <span className="text-xs text-muted-foreground">{format(parseISO(o.detectado_em), "dd/MM/yy HH:mm")}</span>
                  <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={() => onAbrir(o.attendance_id)}>
                    <SquareArrowOutUpRight className="h-3.5 w-3.5" />Ver atendimento
                  </Button>
                </div>
                <p className="mt-1.5 break-words text-[13px] leading-snug">"{o.trecho}"</p>
                {o.motivo && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{o.motivo}</p>}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
