import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Timer, ExternalLink, Users, Download } from "lucide-react";
import { toast } from "sonner";
import {
  useAtendimentoLatenciaAgente,
  fetchLatenciaAgente,
  LATENCIA_LIMITE_EXPORT,
  type LatenciaRespostaItem,
} from "./useAtendimentoLatenciaAgente";
import type { AgenteRow } from "./useAtendimentoAgentes";
import { fmtDur } from "./fmtDuracao";
import { CORES_FAIXA_LATENCIA } from "./LatenciaHistograma";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";
import { exportLatenciaAgenteXlsx } from "@/lib/exportLatenciaXlsx";
import { cn } from "@/lib/utils";

interface Props {
  agente: AgenteRow | null;
  onOpenChange: (open: boolean) => void;
}

const n = (v: number) => v.toLocaleString("pt-BR");

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });

/** O teto é sempre hora cheia (hoje 4h). */
const fmtTeto = (seg: number) => `${Math.round(seg / 3600)}h`;

/** Cor da barra e do valor: a mesma escala verde -> vermelho do histograma da aba. */
function corDaFaixa(seg: number): string {
  const limites = [30, 60, 120, 300, 600, 1800];
  let i = 0;
  while (i < limites.length && seg >= limites[i]) i++;
  return CORES_FAIXA_LATENCIA[i] ?? CORES_FAIXA_LATENCIA[CORES_FAIXA_LATENCIA.length - 1];
}

export function LatenciaAgenteDialog({ agente, onOpenChange }: Props) {
  const navigate = useNavigate();
  const open = agente !== null;
  const { data, isLoading, isError, error } = useAtendimentoLatenciaAgente(agente?.agent_id ?? null, open);
  const [chatAberto, setChatAberto] = useState<LatenciaRespostaItem | null>(null);
  const [exportando, setExportando] = useState(false);

  const { effectiveTenantId: tid } = useTenantFilter();
  const { dateRange, tipoAtendimento, plantao, categoryIds, subcategoryIds } = useAtendimentoFilter();

  const abrirNoWhatsApp = (conversationId: string) => {
    onOpenChange(false);
    navigate(`/whatsapp?conversation=${conversationId}`);
  };

  // A tela carrega 200 linhas; a exportação busca de novo, com o teto alto, para
  // o arquivo não sair cortado sem ninguém perceber.
  const exportar = async () => {
    if (!agente || !tid) return;
    setExportando(true);
    try {
      const completo = await fetchLatenciaAgente({
        tenantId: tid,
        agentId: agente.agent_id,
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
        isGroup: tipoAtendimento === "all" ? null : tipoAtendimento === "group",
        plantao: plantao === "all" ? null : plantao,
        categoryIds,
        subcategoryIds,
        limit: LATENCIA_LIMITE_EXPORT,
      });
      if (completo.itens.length === 0) {
        toast.info("Nada para exportar neste período.");
        return;
      }
      exportLatenciaAgenteXlsx({
        nome: agente.nome,
        itens: completo.itens,
        from: dateRange.from,
        to: dateRange.to,
      });
      if (completo.truncado) {
        toast.warning(`Arquivo com as ${n(LATENCIA_LIMITE_EXPORT)} maiores latências de ${n(completo.total_lista)}.`);
      }
    } catch (e: any) {
      toast.error("Falha ao exportar: " + (e?.message ?? String(e)));
    } finally {
      setExportando(false);
    }
  };

  const maxFaixa = data ? Math.max(1, ...data.faixas.map((f) => f.qtd)) : 1;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3 pr-6">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">Latência de {agente?.nome ?? "agente"}</span>
                  {data && (
                    <span className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground">
                      · {n(data.total_lista)} resposta{data.total_lista === 1 ? "" : "s"}
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Intervalo entre a mensagem do cliente e a primeira resposta do agente, nos filtros do período, contando só o tempo dentro do horário de atendimento do setor.
                  {data && data.p50 !== null && (
                    <> Mediana {fmtDur(data.p50)}
                      {data.p90 !== null && <> · p90 {fmtDur(data.p90)}</>}.
                    </>
                  )}
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={exportar}
                disabled={exportando || isLoading || !data || data.total_lista === 0}
              >
                {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Exportar XLSX
              </Button>
            </div>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError || !data ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Não foi possível carregar o detalhe da latência.</p>
              {error instanceof Error && (
                <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
              )}
            </div>
          ) : data.itens.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              Nenhuma resposta com latência medida no período.
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
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  em <b className="font-semibold">{n(data.total_conversas)}</b> conversa{data.total_conversas === 1 ? "" : "s"}
                </span>
              </div>

              {/* Histograma do agente: as mesmas 7 faixas da aba, só que dele. */}
              <div className="grid grid-cols-7 items-end gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 pb-1.5 pt-2.5">
                {data.faixas.map((f) => (
                  <div key={f.idx} className="flex min-w-0 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-muted-foreground">{f.qtd}</span>
                    <div
                      className="w-full rounded-t-sm"
                      style={{
                        height: `${Math.max(3, Math.round((f.qtd / maxFaixa) * 48))}px`,
                        background: CORES_FAIXA_LATENCIA[f.idx] ?? CORES_FAIXA_LATENCIA[CORES_FAIXA_LATENCIA.length - 1],
                      }}
                    />
                    <span className="max-w-full truncate text-[9.5px] text-muted-foreground">{f.faixa}</span>
                  </div>
                ))}
              </div>

              <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[680px] border-collapse">
                  <thead>
                    <tr>
                      {["Quando", "Contato / Cliente", "Mensagem do cliente"].map((h) => (
                        <th
                          key={h}
                          className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                      <th className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Respondeu em
                      </th>
                      <th className="sticky top-0 z-10 border-b border-border bg-background" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.itens.map((it) => (
                      <tr
                        key={`${it.conversation_id}-${it.cli_first}`}
                        onClick={() => setChatAberto(it)}
                        className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {fmtData(it.cli_first)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex max-w-[220px] items-center gap-1.5 truncate text-sm font-medium">
                            {it.is_group && <Users className="h-3 w-3 shrink-0 text-muted-foreground" />}
                            <span className="truncate">{it.contato}</span>
                          </div>
                          <div className="max-w-[220px] truncate text-[11px] text-muted-foreground">
                            {[it.cliente_nome, it.departamento].filter(Boolean).join(" · ") || "Sem cliente vinculado"}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="block max-w-[260px] truncate text-[11.5px] text-muted-foreground">
                            {it.preview ?? "—"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <span
                            className="text-sm font-semibold tabular-nums"
                            style={{ color: it.no_calculo ? corDaFaixa(it.seg) : undefined }}
                          >
                            <span className={cn(!it.no_calculo && "text-amber-600 dark:text-amber-400")}>
                              {fmtDur(it.seg)}
                            </span>
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
                  ? `Mostrando as ${n(data.itens.length)} maiores de ${n(data.total_lista)} respostas.`
                  : `${n(data.itens.length)} de ${n(data.total_lista)} respostas, da maior latência para a menor.`}
                {" "}Clique numa linha para abrir o histórico do chat. A exportação leva a lista inteira.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* O histórico abre na janela da troca: 15 min antes da pergunta até 10 min
          depois da resposta — o suficiente para ler o contexto sem puxar o chat inteiro. */}
      <AttendanceChatHistoryModal
        open={chatAberto !== null}
        onOpenChange={(v) => !v && setChatAberto(null)}
        conversationId={chatAberto?.conversation_id ?? null}
        attendanceCode={chatAberto ? `Respondeu em ${fmtDur(chatAberto.seg)} úteis` : ""}
        contactName={chatAberto?.contato}
        openedAt={
          chatAberto ? new Date(new Date(chatAberto.cli_first).getTime() - 15 * 60_000).toISOString() : null
        }
        closedAt={
          chatAberto ? new Date(new Date(chatAberto.agt_first).getTime() + 10 * 60_000).toISOString() : null
        }
      />
    </>
  );
}
