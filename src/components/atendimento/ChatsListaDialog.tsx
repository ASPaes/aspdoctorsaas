import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ExternalLink, MessagesSquare, Users } from "lucide-react";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";
import { useAtendimentoChatsLista, type ChatListaItem } from "./useAtendimentoChatsLista";
import { fmtEspera } from "./TempoRealTab";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closedReasons: string[];
  hasTicket: "all" | "with" | "without";
  sentiments: string[];
  resolucoes: string[];
}

const SENTIMENTO: Record<string, { texto: string; classe: string }> = {
  positive: { texto: "positivo", classe: "bg-primary/15 text-primary" },
  neutral:  { texto: "neutro",   classe: "bg-muted text-muted-foreground" },
  negative: { texto: "negativo", classe: "bg-destructive/15 text-destructive" },
};

/**
 * Mesmos valores de RESOL_OPTS/RESOL_LABEL em ChatsTab.tsx — que é quem manda
 * esses códigos para a RPC como p_resolucoes. Mantidos aqui em vez de
 * importados de lá porque ChatsTab já importa este arquivo, e o par viraria
 * import circular. Mexeu num, confira o outro.
 */
const RESOLUCAO: Record<string, string> = {
  resolvido: "Resolvido",
  parcial: "Parcial",
  nao_resolvido: "Sem solução",
  sem_resposta_agente: "Agente não respondeu",
  sem_resposta_cliente: "Cliente não retornou",
  "(sem)": "Sem análise",
};

function fmtData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function ChatsListaDialog({
  open, onOpenChange, closedReasons, hasTicket, sentiments, resolucoes,
}: Props) {
  const navigate = useNavigate();
  const [chatAberto, setChatAberto] = useState<ChatListaItem | null>(null);
  const { data, isLoading, isError } = useAtendimentoChatsLista({
    closedReasons, hasTicket, sentiments, resolucoes, enabled: open,
  });

  const abrirAoVivo = (conversationId: string) => {
    onOpenChange(false);
    navigate(`/whatsapp?conversation=${conversationId}`);
  };

  const restantes = data ? data.total - data.itens.length : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessagesSquare className="h-4 w-4" />
              Atendimentos do período
            </DialogTitle>
            <DialogDescription>
              Os atendimentos que formam o total do card, com os mesmos filtros da aba.
              Clique em um para ver a conversa.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="py-8 text-center text-sm text-destructive">
              Erro ao carregar a lista.
            </div>
          ) : !data || data.itens.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum atendimento com esses filtros.
            </div>
          ) : (
            <>
              <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
                {data.itens.map((i) => (
                  <li key={i.attendance_id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setChatAberto(i)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {i.is_group && <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          <span className="truncate text-sm font-medium">{i.contato}</span>
                          {i.attendance_code && (
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {i.attendance_code}
                            </span>
                          )}
                          {i.plantao && (
                            // Mostra QUANDO houve trabalho fora do expediente, não só que
                            // houve: um atendimento pode abrir 16h de uma sexta (dentro) e
                            // o plantão acontecer na quinta seguinte às 21h20.
                            <span
                              className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground"
                              title={i.plantao_em ? `Trabalho fora do expediente em ${fmtData(i.plantao_em)}` : undefined}
                            >
                              {i.plantao_em ? `plantão · ${fmtData(i.plantao_em)}` : "plantão"}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {i.sentimento && SENTIMENTO[i.sentimento] && (
                            <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-medium", SENTIMENTO[i.sentimento].classe)}>
                              {SENTIMENTO[i.sentimento].texto}
                            </span>
                          )}
                          <span className="truncate">
                            {[
                              i.cliente_nome,
                              i.agente ?? "sem atendente",
                              i.departamento,
                              i.resolucao ? (RESOLUCAO[i.resolucao] ?? i.resolucao) : null,
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[11px] tabular-nums text-muted-foreground">{fmtData(i.opened_at)}</div>
                        <div className="text-[11px] tabular-nums text-muted-foreground">{fmtEspera(i.duracao_seg)}</div>
                      </div>
                    </button>
                    {i.conversation_id && (
                      <button
                        type="button"
                        onClick={() => abrirAoVivo(i.conversation_id!)}
                        title="Abrir o chat ao vivo"
                        className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {data.truncado && (
                <p className="pt-1 text-xs text-muted-foreground">
                  Mostrando os {data.itens.length.toLocaleString("pt-BR")} atendimentos mais
                  recentes — {restantes.toLocaleString("pt-BR")} a mais no período. Aperte o
                  filtro para chegar no que você procura.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AttendanceChatHistoryModal
        open={chatAberto !== null}
        onOpenChange={(v) => !v && setChatAberto(null)}
        conversationId={chatAberto?.conversation_id ?? null}
        attendanceCode={chatAberto?.attendance_code ?? ""}
        contactName={chatAberto?.contato}
        openedAt={chatAberto?.opened_at ?? null}
        closedAt={chatAberto?.closed_at ?? null}
      />
    </>
  );
}
