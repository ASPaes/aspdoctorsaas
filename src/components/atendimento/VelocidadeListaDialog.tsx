import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Gauge, ExternalLink, Users } from "lucide-react";
import {
  useAtendimentoVelocidadeLista,
  type VelocidadeItem,
  type VelocidadeMetrica,
} from "./useAtendimentoVelocidadeLista";
import { fmtEspera } from "./TempoRealTab";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";
import { cn } from "@/lib/utils";

interface Props {
  metrica: VelocidadeMetrica | null;
  onOpenChange: (open: boolean) => void;
}

/** O texto de cada métrica. `semValor` explica quem ficou de fora da lista. */
const TEXTOS: Record<VelocidadeMetrica, {
  titulo: string;
  descricao: string;
  coluna: string;
  semValor: string;
}> = {
  tme: {
    titulo: "TME por atendimento",
    descricao: "Espera da abertura até alguém assumir, nos filtros do período.",
    coluna: "Espera",
    semValor: "assumidos na hora, sem espera",
  },
  frt: {
    titulo: "1ª Resposta por atendimento",
    descricao: "Da abertura até a primeira resposta do agente, nos filtros do período.",
    coluna: "1ª resposta",
    semValor: "sem 1ª resposta registrada",
  },
  tma: {
    titulo: "TMA por atendimento",
    descricao: "Tempo com o atendimento nas mãos do agente, nos filtros do período.",
    coluna: "Atendimento",
    semValor: "sem tempo de atendimento",
  },
  tmr: {
    titulo: "TMR por atendimento",
    descricao: "Espera mais atendimento, da abertura ao encerramento, nos filtros do período.",
    coluna: "Resolução",
    semValor: "sem tempo registrado",
  },
};

const n = (v: number) => v.toLocaleString("pt-BR");

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });

/** Os tetos são sempre horas cheias (2h, 4h, 10h). */
const fmtTeto = (seg: number) => `${Math.round(seg / 3600)}h`;

export function VelocidadeListaDialog({ metrica, onOpenChange }: Props) {
  const navigate = useNavigate();
  const open = metrica !== null;
  const { data, isLoading, isError, error } = useAtendimentoVelocidadeLista(metrica, open);
  const [chatAberto, setChatAberto] = useState<VelocidadeItem | null>(null);
  const t = metrica ? TEXTOS[metrica] : null;

  const abrirNoWhatsApp = (conversationId: string) => {
    onOpenChange(false);
    navigate(`/whatsapp?conversation=${conversationId}`);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              {t?.titulo ?? "Atendimentos"}
              {data && (
                <span className="text-sm font-normal tabular-nums text-muted-foreground">
                  · {n(data.total_lista)} atendimento{data.total_lista === 1 ? "" : "s"}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t?.descricao}
              {data && data.p50 !== null && (
                <> Mediana {fmtEspera(data.p50)}
                  {data.p90 !== null && <> · p90 {fmtEspera(data.p90)}</>}.
                </>
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
          ) : data.itens.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              Nenhum atendimento com tempo medido no período.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] tabular-nums text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  <b className="font-semibold">{n(data.total_no_calculo)}</b> no cálculo da mediana
                </span>
                {data.total_fora_cap > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] tabular-nums text-amber-600 dark:text-amber-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    <b className="font-semibold">{n(data.total_fora_cap)}</b> acima de {fmtTeto(data.cap_seconds)}, fora do cálculo
                  </span>
                )}
                {data.total_sem_valor > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                    <b className="font-semibold">{n(data.total_sem_valor)}</b> {t?.semValor}
                  </span>
                )}
              </div>

              <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr>
                      {["Atendimento", "Abertura", "Contato / Cliente", "Agente"].map((h) => (
                        <th
                          key={h}
                          className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                      <th className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t?.coluna}
                      </th>
                      <th className="sticky top-0 z-10 border-b border-border bg-background" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.itens.map((it) => (
                      <tr
                        key={it.attendance_id}
                        onClick={() => setChatAberto(it)}
                        className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                          {it.attendance_code ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {fmtData(it.opened_at)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex max-w-[280px] items-center gap-1.5 truncate text-sm font-medium">
                            {it.is_group && <Users className="h-3 w-3 shrink-0 text-muted-foreground" />}
                            <span className="truncate">{it.contato}</span>
                          </div>
                          <div className="max-w-[280px] truncate text-[11px] text-muted-foreground">
                            {[it.cliente_nome, it.departamento].filter(Boolean).join(" · ") || "Sem cliente vinculado"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {it.agente ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <span
                            className={cn(
                              "text-sm font-semibold tabular-nums",
                              it.no_calculo ? "text-foreground" : "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {fmtEspera(it.seg)}
                          </span>
                          {!it.no_calculo && (
                            <span className="block text-[9px] font-medium uppercase tracking-wide text-amber-600/75 dark:text-amber-400/75">
                              fora do cálculo
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            aria-label="Abrir no WhatsApp"
                            title="Abrir no WhatsApp"
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirNoWhatsApp(it.conversation_id);
                            }}
                            className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">
                {data.truncado
                  ? `Mostrando os ${n(data.itens.length)} maiores de ${n(data.total_lista)} atendimentos.`
                  : `${n(data.itens.length)} de ${n(data.total_lista)} atendimentos, do maior tempo para o menor.`}
                {" "}Clique numa linha para abrir o histórico do chat.
              </p>
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
