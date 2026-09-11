// Mensagens agendadas dentro da conversa, no fim da lista — onde elas vão cair
// quando saírem. Borda tracejada até a hora chegar; quando a mensagem real
// chega pelo realtime, a bolha some no mesmo instante (casamento pelo
// `metadata.scheduled_message_id`), sem esperar o refetch da lista.
//
// RECOLHIDO NÃO OCUPA NADA DA CONVERSA (pedido do Alexandre em 11/09, com
// print): quem mostra que existe agendada é o botão "N agendadas" da barra de
// sugestões (input/ScheduledPill). Aqui só aparece quando `expandido` — aba
// "Agendar" ativa, clique no botão, ou uma agendada em edição. Quem decide é o
// ChatAreaFull, que enxerga o compositor e a conversa ao mesmo tempo.
//
// Recolhido, o componente continua montado (só não desenha): é ele que pede a
// lista de novo logo depois da hora marcada, e o botão da barra depende disso
// para trocar "próxima 15:00" pelo estado real.
//
// As ações (editar, enviar agora, cancelar) não moram aqui: editar devolve o
// texto para o campo de mensagem, e a confirmação de enviar/cancelar é a mesma
// do compositor. Sem compositor na tela, `acoes` chega undefined e os botões
// ficam desligados em vez de mudos.
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, CalendarClock, EyeOff, Paperclip, Pencil, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useScheduledMessages, scheduledKey, type ScheduledMessage } from "../hooks/useScheduledMessages";
import type { Message } from "../hooks/useWhatsAppMessages";

export interface AcoesAgendada {
  editar: (a: ScheduledMessage) => void;
  pedir: (tipo: "cancelar" | "enviar", a: ScheduledMessage) => void;
}

interface Props {
  conversationId: string;
  messages: Message[];
  acoes?: AcoesAgendada;
  editandoId?: string | null;
  /** Mostrar as bolhas. Falso = não desenha nada na conversa. */
  expandido: boolean;
  /**
   * Avisado quando a altura muda. `forcar` = as bolhas acabaram de aparecer
   * (ou chegou uma nova com elas abertas): rola até elas mesmo longe do fim.
   */
  onMudou?: (forcar?: boolean) => void;
}

function quando(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return `hoje às ${format(d, "HH:mm")}`;
  if (isTomorrow(d)) return `amanhã às ${format(d, "HH:mm")}`;
  return format(d, "dd/MM 'às' HH:mm", { locale: ptBR });
}

const TRACEJADO = "h-px flex-1 bg-[repeating-linear-gradient(90deg,currentColor_0_5px,transparent_5px_9px)] opacity-50";

export function ScheduledBubbles({ conversationId, messages, acoes, editandoId, expandido, onMudou }: Props) {
  const { agendadas } = useScheduledMessages(conversationId);
  const queryClient = useQueryClient();

  // Já chegou pelo realtime? Então a bolha é redundante: some agora.
  const jaSairam = useMemo(() => {
    const ids = new Set<string>();
    for (const m of messages) {
      const id = m.metadata?.scheduled_message_id;
      if (id) ids.add(String(id));
    }
    return ids;
  }, [messages]);

  const visiveis = useMemo(
    () => agendadas.filter((a) => !jaSairam.has(a.id)),
    [agendadas, jaSairam],
  );

  // Relógio da tela: vira "Saindo agora" na hora marcada e pede a lista de novo
  // logo depois do minuto do cron (o envio leva ~3s a partir do :00).
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const proxima = visiveis
      .filter((a) => a.status === "pending")
      .map((a) => new Date(a.scheduled_at).getTime())
      .filter((t) => t > Date.now())
      .sort((x, y) => x - y)[0];
    if (!proxima) return;
    const espera = proxima - Date.now();
    // Mais de 1h de espera: o refetch de 60s do hook já cobre.
    if (espera > 60 * 60 * 1000) return;
    const recarregar = () => queryClient.invalidateQueries({ queryKey: scheduledKey(conversationId) });
    const timers = [
      setTimeout(() => setAgora(Date.now()), espera + 500),
      setTimeout(recarregar, espera + 6_000),
      setTimeout(recarregar, espera + 65_000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [visiveis, conversationId, queryClient]);

  useEffect(() => {
    onMudou?.(expandido);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiveis.length, expandido]);

  if (!expandido || visiveis.length === 0) return null;

  const semAcoes = !acoes;

  return (
    <div
      className="pb-2 animate-in fade-in slide-in-from-bottom-3 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      aria-label="Mensagens agendadas"
    >
      <div className="flex items-center gap-3 my-3 text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
        <span className={TRACEJADO} />
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="h-3 w-3" />
          {visiveis.length === 1 ? "1 agendada" : `${visiveis.length} agendadas`}
        </span>
        <span className={TRACEJADO} />
      </div>

      <div className="flex flex-col gap-2">
        {visiveis.map((a) => {
          const falhou = a.status === "failed";
          const saindo = !falhou && (a.status === "sending" || new Date(a.scheduled_at).getTime() <= agora);
          const emEdicao = editandoId === a.id;
          const travado = semAcoes || saindo;
          const motivoTravado = semAcoes
            ? "Indisponível enquanto o campo de mensagem está fechado"
            : saindo ? "Essa mensagem já está saindo" : undefined;

          return (
            <div key={a.id} className="flex justify-end">
              <div
                className={cn(
                  "max-w-[75%] rounded-lg rounded-tr-sm border-[1.5px] border-dashed px-3 pt-2 pb-1.5 text-sm shadow-sm",
                  "transition-[box-shadow,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  falhou
                    ? "border-destructive/60 bg-destructive/5"
                    : "border-violet-500/60 bg-emerald-500/10",
                  emEdicao && "ring-2 ring-violet-500/70 ring-offset-2 ring-offset-background",
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  {falhou ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Não foi enviada
                    </span>
                  ) : saindo ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60 motion-safe:animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
                      </span>
                      Saindo agora
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Sai {quando(a.scheduled_at)}
                    </span>
                  )}
                  {emEdicao && (
                    <span className="text-[11px] text-violet-600 dark:text-violet-400">· editando no campo abaixo</span>
                  )}
                  {a.cancel_if_client_replies && !falhou && (
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

                {a.message_type !== "text" && (
                  <span className="mb-1 inline-flex w-fit items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    <Paperclip className="h-3 w-3" />
                    {a.media_file_name || a.message_type}
                  </span>
                )}

                {a.content ? (
                  <p className="whitespace-pre-wrap break-words text-foreground">{a.content}</p>
                ) : (
                  <p className="italic text-muted-foreground">Sem texto, só o anexo</p>
                )}

                {falhou && a.last_error && (
                  <p className="mt-1 text-[11px] text-destructive/80">Motivo: {a.last_error}</p>
                )}

                <div
                  className={cn(
                    "mt-2 flex flex-wrap items-center gap-0.5 border-t border-dashed pt-1",
                    falhou ? "border-destructive/30" : "border-violet-500/30",
                  )}
                  title={motivoTravado}
                >
                  <button
                    type="button"
                    disabled={travado}
                    onClick={() => acoes?.editar(a)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Pencil className="h-3 w-3" />
                    {falhou ? "Reagendar" : "Editar"}
                  </button>
                  {!falhou && (
                    <button
                      type="button"
                      disabled={travado}
                      onClick={() => acoes?.pedir("enviar", a)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Send className="h-3 w-3" />
                      Enviar agora
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={travado}
                    onClick={() => acoes?.pedir("cancelar", a)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" />
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
