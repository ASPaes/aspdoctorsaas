import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageCircle, PauseCircle, Star, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { Cartao, Chips, Vazio } from "@/components/clientes/visao360/Visao360Ui";
import { useState } from "react";
import type { DiaLinha, TipoEvento } from "./colaborador360Analise";

const ICONE: Record<TipoEvento, { Icon: typeof Star; cx: string }> = {
  atendimentos: { Icon: MessageCircle, cx: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  avaliacao: { Icon: Star, cx: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  ticket: { Icon: Ticket, cx: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  pausa: { Icon: PauseCircle, cx: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
};

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export function LinhaDoTempoColaborador({ dias, onAbrirAtendimento, onAbrirTicket }: {
  dias: DiaLinha[];
  onAbrirAtendimento: (id: string) => void;
  onAbrirTicket: (id: string) => void;
}) {
  const [filtro, setFiltro] = useState<"todos" | TipoEvento>("todos");
  const [limite, setLimite] = useState(15);
  const lista = dias
    .map((d) => ({ ...d, eventos: d.eventos.filter((e) => filtro === "todos" || e.tipo === filtro) }))
    .filter((d) => d.eventos.length);

  return (
    <Cartao
      titulo="Tudo o que aconteceu"
      acao={
        <Chips
          valor={filtro}
          onChange={(v) => { setFiltro(v); setLimite(15); }}
          opcoes={[
            { id: "todos", label: "Tudo" },
            { id: "atendimentos", label: "Atendimentos" },
            { id: "avaliacao", label: "Avaliações" },
            { id: "ticket", label: "Tickets" },
            { id: "pausa", label: "Pausas" },
          ]}
        />
      }
    >
      {lista.length === 0 ? <Vazio>Nada no período.</Vazio> : (
        <ul className="px-4 pb-4">
          {lista.slice(0, limite).map((d) => (
            <li key={d.dia}>
              <div className="pb-1.5 pl-10 pt-3 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                {d.dia === hoje() ? "Hoje · " : ""}{format(parseISO(d.dia), "EEEE, dd/MM", { locale: ptBR })}
              </div>
              <ul>
                {d.eventos.map((e, i) => {
                  const ic = ICONE[e.tipo];
                  const alvo = e.ref?.ticket ? () => onAbrirTicket(e.ref!.ticket!) : e.ref?.atendimento ? () => onAbrirAtendimento(e.ref!.atendimento!) : undefined;
                  return (
                    <li key={i} className="relative grid grid-cols-[28px_1fr_auto] gap-3 py-2">
                      {i < d.eventos.length - 1 && <span className="absolute bottom-[-8px] left-[13.5px] top-9 w-px bg-border" />}
                      <span className={cn("grid h-7 w-7 place-items-center rounded-lg", ic.cx)}><ic.Icon className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0">
                        {alvo ? (
                          <button type="button" onClick={alvo} className={cn("text-left text-[13px] font-bold hover:underline", e.tom === "ruim" && "text-red-600 dark:text-red-400")}>
                            {e.titulo}
                          </button>
                        ) : (
                          <div className="text-[13px] font-bold">{e.titulo}</div>
                        )}
                        {e.detalhe && <div className={cn("text-[12.5px] text-muted-foreground", e.tipo === "avaliacao" && "italic")}>{e.detalhe}</div>}
                      </div>
                      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(e.quando))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {lista.length > limite && (
        <div className="border-t px-4 py-2 text-center">
          <button type="button" onClick={() => setLimite((l) => l + 15)} className="text-sm font-semibold text-primary hover:underline">
            Mostrar mais dias ({lista.length - limite} restantes)
          </button>
        </div>
      )}
    </Cartao>
  );
}
