import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ChevronDown, ChevronRight, ExternalLink, UserX } from "lucide-react";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";
import { useAtendimentoNaoAtendidos, type NaoAtendidoChat } from "./useAtendimentoNaoAtendidos";
import { fmtEspera } from "./TempoRealTab";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ChatAberto = { chat: NaoAtendidoChat; contato: string };

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });

export function NaoAtendidosDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { agentId } = useAtendimentoFilter();
  const { data, isLoading, isError, error } = useAtendimentoNaoAtendidos(open);
  const [aberto, setAberto] = useState<string | null>(null);
  const [chatAberto, setChatAberto] = useState<ChatAberto | null>(null);

  const abrirNoWhatsApp = (conversationId: string) => {
    onOpenChange(false);
    navigate(`/whatsapp?conversation=${conversationId}`);
  };

  const semResposta = data?.total_sem_resposta ?? 0;
  const respondidosSemAssumir = Math.max((data?.total_card ?? 0) - semResposta, 0);
  const restantes = (data?.total_contatos ?? 0) - (data?.contatos.length ?? 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-muted-foreground" />
              Clientes no vácuo
            </DialogTitle>
            <DialogDescription className="text-xs">
              {data && respondidosSemAssumir > 0 ? (
                <span data-testid="reconciliacao">
                  {semResposta.toLocaleString("pt-BR")} chats sem nenhuma resposta ·{" "}
                  outros {respondidosSemAssumir.toLocaleString("pt-BR")} tiveram resposta mas
                  ninguém assumiu (o card conta os {data.total_card.toLocaleString("pt-BR")}).
                </span>
              ) : (
                "Atendimentos em que o cliente escreveu e ninguém respondeu."
              )}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError || !data ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Não foi possível carregar a lista.</p>
              {error instanceof Error && (
                <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
              )}
            </div>
          ) : data.contatos.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              {agentId
                ? "Nenhum resultado: o filtro de agente exclui atendimentos não atendidos, que por definição não têm agente."
                : "Nenhum cliente ficou sem resposta no período."}
            </div>
          ) : (
            <>
              <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto pr-1">
                {data.contatos.map((c, i) => {
                  const key = `${c.telefone ?? c.contato}-${i}`;
                  const isOpen = aberto === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setAberto(isOpen ? null : key)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{c.contato}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[c.cliente_nome, c.telefone].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                        {c.qtd > 1 && (
                          <span className="shrink-0 rounded-md bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                            {c.qtd} chats
                          </span>
                        )}
                      </button>

                      {isOpen && (
                        <ul className="mb-1 ml-7 border-l border-border pl-3">
                          {c.chats.map((ch) => (
                            <li key={ch.attendance_id} className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setChatAberto({ chat: ch, contato: c.contato })}
                                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium">{fmtData(ch.opened_at)}</div>
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {[ch.departamento ?? "Sem setor",
                                      `${ch.msg_customer_count} msg do cliente`].join(" · ")}
                                  </div>
                                </div>
                                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                  {fmtEspera(ch.aberto_seg)}
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label="Abrir no WhatsApp"
                                title="Abrir no WhatsApp"
                                onClick={() => abrirNoWhatsApp(ch.conversation_id)}
                                className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-primary"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              {data.truncado && restantes > 0 && (
                <p className="text-xs text-muted-foreground">
                  Mostrando os {data.contatos.length.toLocaleString("pt-BR")} contatos com mais
                  ocorrências — {restantes.toLocaleString("pt-BR")} contatos a mais no período.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AttendanceChatHistoryModal
        open={chatAberto !== null}
        onOpenChange={(v) => !v && setChatAberto(null)}
        conversationId={chatAberto?.chat.conversation_id ?? null}
        attendanceCode={chatAberto?.chat.attendance_code ?? ""}
        contactName={chatAberto?.contato}
        openedAt={chatAberto?.chat.opened_at ?? null}
        closedAt={chatAberto?.chat.closed_at ?? null}
      />
    </>
  );
}
