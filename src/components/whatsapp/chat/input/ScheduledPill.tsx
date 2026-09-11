// Botão "N agendadas" na barra de sugestões, entre a conversa e o compositor.
//
// Mora aqui, e não no fim da conversa, de propósito: recolhida, a agendada não
// pode tomar nem uma linha do chat (pedido do Alexandre em 11/09, com print).
// Clicar abre as bolhas DENTRO da conversa, subindo a partir daqui; clicar de
// novo recolhe. Na aba "Agendar" o botão nem aparece — lá as bolhas já estão
// abertas.
//
// O resumo mostra a coisa mais urgente primeiro: falha (vermelho) > saindo
// agora (ponto pulsando) > próxima da fila.
import { AlertTriangle, CalendarClock, ChevronDown, ChevronUp } from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { ScheduledMessage } from "../../hooks/useScheduledMessages";

function quando(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return `hoje às ${format(d, "HH:mm")}`;
  if (isTomorrow(d)) return `amanhã às ${format(d, "HH:mm")}`;
  return format(d, "dd/MM 'às' HH:mm", { locale: ptBR });
}

interface Props {
  agendadas: ScheduledMessage[];
  aberto: boolean;
  onToggle: () => void;
}

export function ScheduledPill({ agendadas, aberto, onToggle }: Props) {
  if (agendadas.length === 0) return null;

  const agora = Date.now();
  const saindo = (a: ScheduledMessage) =>
    a.status !== "failed" && (a.status === "sending" || new Date(a.scheduled_at).getTime() <= agora);

  const falhadas = agendadas.filter((a) => a.status === "failed").length;
  const algumaSaindo = agendadas.some(saindo);
  const proxima = agendadas.find((a) => a.status !== "failed" && !saindo(a));
  const rotulo = agendadas.length === 1 ? "1 agendada" : `${agendadas.length} agendadas`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={aberto}
      title={aberto ? "Recolher as mensagens agendadas" : "Ver as mensagens agendadas na conversa"}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium",
        "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        falhadas > 0
          ? "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/60"
          : "border-violet-500/40 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 focus-visible:ring-violet-500/60 dark:text-violet-300",
      )}
    >
      {falhadas > 0 ? (
        <AlertTriangle className="h-3 w-3 shrink-0" />
      ) : algumaSaindo ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
        </span>
      ) : (
        <CalendarClock className="h-3 w-3 shrink-0" />
      )}
      <span className="shrink-0 font-semibold">{rotulo}</span>
      <span className="truncate opacity-80">
        {falhadas > 0
          ? `· ${falhadas === 1 ? "1 não saiu" : `${falhadas} não saíram`}`
          : algumaSaindo
          ? "· saindo agora"
          : proxima
          ? `· próxima ${quando(proxima.scheduled_at)}`
          : ""}
      </span>
      {aberto ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronUp className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}
