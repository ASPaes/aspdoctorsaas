// O que está agendado nesta conversa, logo acima do compositor.
//
// Fica onde a próxima mensagem apareceria, de propósito: o operador vê o que
// vai sair sem precisar procurar em lugar nenhum. Fechado é uma linha; aberto,
// a lista com hora, texto e as três ações (editar, enviar agora, cancelar).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CalendarClock, ChevronDown, ChevronUp, Pencil, Trash2, Send,
  Paperclip, AlertTriangle, EyeOff,
} from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { ScheduledMessage } from "../hooks/useScheduledMessages";

interface Props {
  agendadas: ScheduledMessage[];
  editandoId: string | null;
  onEditar: (a: ScheduledMessage) => void;
  onCancelar: (a: ScheduledMessage) => void;
  onEnviarAgora: (a: ScheduledMessage) => void;
  ocupado?: boolean;
}

export function quandoLegivel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return `hoje às ${format(d, "HH:mm")}`;
  if (isTomorrow(d)) return `amanhã às ${format(d, "HH:mm")}`;
  return format(d, "dd/MM 'às' HH:mm", { locale: ptBR });
}

export function ScheduledMessagesPanel({
  agendadas, editandoId, onEditar, onCancelar, onEnviarAgora, ocupado,
}: Props) {
  const [aberto, setAberto] = useState(false);

  if (agendadas.length === 0) return null;

  const falhadas = agendadas.filter((a) => a.status === "failed");
  const vivas = agendadas.filter((a) => a.status !== "failed");
  const proxima = vivas[0];

  return (
    <div className={cn(
      "mx-4 mb-2 rounded-lg border text-xs overflow-hidden",
      falhadas.length > 0
        ? "border-destructive/40 bg-destructive/5"
        : "border-violet-500/40 bg-violet-500/5",
    )}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-violet-500/10 transition-colors"
        aria-expanded={aberto}
      >
        <CalendarClock className={cn(
          "h-3.5 w-3.5 shrink-0",
          falhadas.length > 0 ? "text-destructive" : "text-violet-600 dark:text-violet-400",
        )} />
        <span className="font-medium text-foreground">
          {agendadas.length === 1 ? "1 mensagem agendada" : `${agendadas.length} mensagens agendadas`}
        </span>
        {proxima && (
          <span className="text-muted-foreground truncate">
            · próxima {quandoLegivel(proxima.scheduled_at)}
          </span>
        )}
        {falhadas.length > 0 && (
          <span className="flex items-center gap-1 text-destructive font-medium">
            <AlertTriangle className="h-3 w-3" />
            {falhadas.length} não {falhadas.length === 1 ? "saiu" : "saíram"}
          </span>
        )}
        <span className="ml-auto text-muted-foreground">
          {aberto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {aberto && (
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {agendadas.map((a) => {
            const falhou = a.status === "failed";
            const saindo = a.status === "sending";
            const emEdicao = editandoId === a.id;
            return (
              <li
                key={a.id}
                className={cn(
                  "flex items-start gap-2 px-3 py-2",
                  emEdicao && "bg-violet-500/10",
                  falhou && "bg-destructive/5",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn(
                      "font-medium",
                      falhou ? "text-destructive" : "text-violet-700 dark:text-violet-300",
                    )}>
                      {falhou ? "Não foi enviada" : saindo ? "Saindo agora" : quandoLegivel(a.scheduled_at)}
                    </span>
                    {a.message_type !== "text" && (
                      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <Paperclip className="h-2.5 w-2.5" />
                        {a.media_file_name || a.message_type}
                      </span>
                    )}
                    {a.cancel_if_client_replies && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            <EyeOff className="h-2.5 w-2.5" />
                            some se ele responder
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Se o cliente escrever antes da hora marcada, esta mensagem é cancelada.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">
                    {a.content || <span className="italic">sem texto, só o anexo</span>}
                  </p>

                  {falhou && a.last_error && (
                    <p className="mt-0.5 text-[10px] text-destructive/80">
                      Motivo: {a.last_error}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="h-7 w-7"
                        disabled={saindo || ocupado}
                        onClick={() => onEditar(a)}
                        aria-label="Editar agendamento"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{falhou ? "Reagendar" : "Editar texto e horário"}</TooltipContent>
                  </Tooltip>

                  {!falhou && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button" variant="ghost" size="icon"
                          className="h-7 w-7"
                          disabled={saindo || ocupado}
                          onClick={() => onEnviarAgora(a)}
                          aria-label="Enviar agora"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Enviar agora, sem esperar a hora marcada</TooltipContent>
                    </Tooltip>
                  )}

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        disabled={saindo || ocupado}
                        onClick={() => onCancelar(a)}
                        aria-label="Cancelar agendamento"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cancelar</TooltipContent>
                  </Tooltip>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
