import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Download, Clock, Coffee, PauseCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";
import {
  useAtendimentoJornada,
  type JornadaDiaRow,
  type JornadaPausaRow,
} from "./useAtendimentoJornada";
import { cn } from "@/lib/utils";

const TZ = "America/Sao_Paulo";

/**
 * Jornada em horas, nunca em dias.
 *
 * `fmtDur` vira "10d 14h" acima de 24h, o que é certo para um atendimento e
 * péssimo aqui: o total da equipe não é tempo corrido, é soma de horas
 * trabalhadas. "254h 30m" é o número que o gestor compara com a escala.
 */
function fmtHoras(seg: number | null | undefined): string {
  if (!seg || seg <= 0) return "—";
  if (seg < 60) return `${Math.round(seg)}s`;
  const totalMin = Math.round(seg / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Hora no fuso de São Paulo: a RPC fecha o dia em SP, a tela tem que concordar. */
function hora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

function dataCurta(dia: string): string {
  if (!dia) return "—";
  try {
    return format(parseISO(dia), "dd/MM EEE", { locale: ptBR });
  } catch {
    return dia;
  }
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((100 * n) / d) : 0;
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function baixarCsv(nome: string, header: string[], rows: any[][]) {
  const linhas = [header, ...rows].map((r) => r.map(csvEscape).join(";"));
  const csv = "﻿" + linhas.join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Minutos com 1 decimal para planilha (o gestor soma na mão depois). */
const min = (seg: number) => (seg / 60).toFixed(1).replace(".", ",");

function Selo({ children, tom }: { children: React.ReactNode; tom: "alerta" | "vivo" }) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium",
        tom === "alerta"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      )}
    >
      {children}
    </span>
  );
}

export function JornadaTab() {
  const { data, isLoading, isError, error } = useAtendimentoJornada();
  const { dateRange, agentes, agentId } = useAtendimentoFilter();
  const [view, setView] = useState("agentes");

  const sufixo = useMemo(() => {
    const de = format(dateRange.from, "yyyy-MM-dd");
    const ate = format(dateRange.to, "yyyy-MM-dd");
    const ag = agentId ? (agentes.find((a) => a.user_id === agentId)?.nome ?? "agente") : "equipe";
    return `${ag.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}_${de}_${ate}`;
  }, [dateRange, agentId, agentes]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">Não foi possível carregar a jornada.</p>
        {error instanceof Error && <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>}
      </div>
    );
  }

  const t = data.totais;

  if (t.dias === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Nenhum registro de expediente ou pausa no período.
        <p className="mt-1 text-xs">
          O histórico começa em 26/03/2026, quando o registro de presença entrou no ar.
        </p>
      </div>
    );
  }

  const estimadoSeg = t.ativo_est_seg + t.pausa_est_seg;
  const pctPausa = pct(t.pausa_seg, t.bruto_seg);

  const exportarAgentes = () =>
    baixarCsv(
      `jornada_por_agente_${sufixo}.csv`,
      ["Agente", "Dias", "Jornada efetiva (min)", "Em pausa (min)", "Presença (min)", "% em pausa", "Pausas", "Média por pausa (min)", "Dias com registro incompleto"],
      data.agentes.map((a) => [
        a.nome,
        a.dias,
        min(a.ativo_seg),
        min(a.pausa_seg),
        min(a.bruto_seg),
        `${pct(a.pausa_seg, a.bruto_seg)}%`,
        a.pausas,
        a.pausas > 0 ? min(a.pausa_seg / a.pausas) : "",
        a.dias_incompletos,
      ]),
    );

  const exportarDias = () =>
    baixarCsv(
      `jornada_por_dia_${sufixo}.csv`,
      ["Agente", "Data", "Entrada", "Saída", "Jornada efetiva (min)", "Em pausa (min)", "Presença (min)", "Pausas", "Observação"],
      data.dias.map((d) => [
        d.nome,
        d.dia,
        hora(d.entrada),
        hora(d.saida),
        min(d.ativo_seg),
        min(d.pausa_seg),
        min(d.bruto_seg),
        d.pausas,
        obsDia(d),
      ]),
    );

  const exportarPausas = () =>
    baixarCsv(
      `pausas_${sufixo}.csv`,
      ["Agente", "Data", "Início", "Fim", "Duração (min)", "Motivo", "Previsto (min)", "Observação"],
      data.pausas.map((p) => [
        p.nome,
        p.dia,
        hora(p.inicio),
        hora(p.fim),
        min(p.segundos),
        p.motivo,
        p.previsto_min ?? "",
        p.em_andamento ? "em andamento" : p.estimada ? "duração estimada (sem encerramento)" : "",
      ]),
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPICardEnhanced
          label="Jornada Efetiva"
          helpKey="atendimento_jornada_efetiva"
          value={fmtHoras(t.ativo_seg)}
          subtitle={`${t.dias.toLocaleString("pt-BR")} dias de ${t.agentes} agente${t.agentes === 1 ? "" : "s"}`}
          icon={<Clock className="h-4 w-4" />}
        />
        <KPICardEnhanced
          label="Tempo em Pausa"
          helpKey="atendimento_jornada_pausa"
          value={fmtHoras(t.pausa_seg)}
          subtitle={`${pctPausa}% da presença registrada`}
          variant={pctPausa > 25 ? "warning" : "dark"}
          icon={<Coffee className="h-4 w-4" />}
        />
        <KPICardEnhanced
          label="Pausas no Período"
          helpKey="atendimento_jornada_qtd_pausas"
          value={t.pausas.toLocaleString("pt-BR")}
          subtitle={t.pausas > 0 ? `média de ${fmtHoras(t.pausa_seg / t.pausas)} cada` : "nenhuma pausa registrada"}
          icon={<PauseCircle className="h-4 w-4" />}
        />
        <KPICardEnhanced
          label="Registro Incompleto"
          helpKey="atendimento_jornada_incompleto"
          value={t.dias_incompletos.toLocaleString("pt-BR")}
          subtitle={
            t.dias_incompletos > 0
              ? `${pct(t.dias_incompletos, t.dias)}% dos dias · ${fmtHoras(estimadoSeg)} estimados`
              : "todos os dias com entrada e saída"
          }
          variant={t.dias_incompletos > 0 ? "warning" : "dark"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      {t.dias_incompletos > 0 && (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              Isto não é marcação de ponto. {t.dias_sem_entrada > 0 && `${t.dias_sem_entrada} dia(s) sem hora de entrada`}
              {t.dias_sem_entrada > 0 && t.dias_sem_saida > 0 && " e "}
              {t.dias_sem_saida > 0 && `${t.dias_sem_saida} dia(s) sem encerramento`}.
            </p>
            <p className="text-muted-foreground">
              Quem fecha o navegador sem encerrar o expediente, ou pausa e só volta no dia seguinte, não
              deixa o horário registrado. Nesses casos a conta para no último evento daquele dia e a linha
              recebe o selo <span className="font-medium">sem entrada</span> ou{" "}
              <span className="font-medium">sem saída</span>. Nenhum horário é inventado, e os{" "}
              {fmtHoras(estimadoSeg)} estimados estão separados na coluna própria.
            </p>
          </div>
        </div>
      )}

      {data.motivos.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Pausas por Motivo</h3>
            <KpiHelpPopover kpiKey="atendimento_jornada_motivos" />
          </div>
          <div className="space-y-2">
            {data.motivos.map((m) => {
              const p = pct(m.segundos, t.pausa_seg);
              return (
                <div key={m.motivo} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 truncate" title={m.motivo}>
                    {m.motivo}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-500"
                      style={{
                        width: `${p}%`,
                        transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)",
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{p}%</span>
                  <span className="w-20 shrink-0 text-right tabular-nums">{fmtHoras(m.segundos)}</span>
                  <span className="w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {m.pausas} × {fmtHoras(m.media_seg)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <Tabs value={view} onValueChange={setView}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="agentes">Por agente</TabsTrigger>
              <TabsTrigger value="dias">Por dia</TabsTrigger>
              <TabsTrigger value="pausas">Pausas ({t.pausas.toLocaleString("pt-BR")})</TabsTrigger>
            </TabsList>
            <Button
              variant="outline"
              size="sm"
              onClick={
                view === "agentes" ? exportarAgentes : view === "dias" ? exportarDias : exportarPausas
              }
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>

          <TabsContent value="agentes" className="mt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Agente</th>
                    <th className="py-2 px-3 text-right font-medium">Dias</th>
                    <th className="py-2 px-3 text-right font-medium">Jornada efetiva</th>
                    <th className="py-2 px-3 text-right font-medium">Em pausa</th>
                    <th className="py-2 px-3 text-right font-medium">% pausa</th>
                    <th className="py-2 px-3 text-right font-medium">Pausas</th>
                    <th className="py-2 px-3 text-right font-medium">Média/pausa</th>
                    <th className="py-2 pl-3 text-right font-medium">Estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agentes.map((a) => {
                    const p = pct(a.pausa_seg, a.bruto_seg);
                    return (
                      <tr key={a.user_id} className="border-b border-border/50 last:border-0">
                        {/* O nome trunca, o selo nunca: `truncate` na célula
                            inteira levava o selo embora junto com o texto em
                            tela de 1280, e é justo o selo que avisa que o
                            número daquele agente está por baixo. */}
                        <td className="max-w-[20rem] py-2 pr-3">
                          <div className="flex min-w-0 items-center">
                            <span className="truncate" title={a.nome}>
                              {a.nome}
                            </span>
                            {a.dias_incompletos > 0 && (
                              <Selo tom="alerta">{a.dias_incompletos} dia(s) sem registro completo</Selo>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{a.dias}</td>
                        <td className="py-2 px-3 text-right font-medium tabular-nums">{fmtHoras(a.ativo_seg)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{fmtHoras(a.pausa_seg)}</td>
                        <td
                          className={cn(
                            "py-2 px-3 text-right tabular-nums",
                            p > 25 && "text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {p}%
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{a.pausas}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {a.pausas > 0 ? fmtHoras(a.pausa_seg / a.pausas) : "—"}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                          {a.est_seg > 0 ? fmtHoras(a.est_seg) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="dias" className="mt-0">
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Agente</th>
                    <th className="py-2 px-3 font-medium">Data</th>
                    <th className="py-2 px-3 text-right font-medium">Entrada</th>
                    <th className="py-2 px-3 text-right font-medium">Saída</th>
                    <th className="py-2 px-3 text-right font-medium">Jornada efetiva</th>
                    <th className="py-2 px-3 text-right font-medium">Em pausa</th>
                    <th className="py-2 pl-3 text-right font-medium">Pausas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dias.map((d) => (
                    <tr key={`${d.user_id}-${d.dia}`} className="border-b border-border/50 last:border-0">
                      <td className="max-w-[14rem] truncate py-2 pr-3">{d.nome}</td>
                      <td className="whitespace-nowrap py-2 px-3">{dataCurta(d.dia)}</td>
                      <td className="whitespace-nowrap py-2 px-3 text-right tabular-nums">
                        {hora(d.entrada)}
                        {d.sem_entrada && <Selo tom="alerta">sem entrada</Selo>}
                      </td>
                      <td className="whitespace-nowrap py-2 px-3 text-right tabular-nums">
                        {hora(d.saida)}
                        {d.em_andamento ? (
                          <Selo tom="vivo">em curso</Selo>
                        ) : (
                          d.sem_saida && <Selo tom="alerta">sem saída</Selo>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-medium tabular-nums">{fmtHoras(d.ativo_seg)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {d.pausa_seg > 0 ? fmtHoras(d.pausa_seg) : "—"}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">{d.pausas || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="pausas" className="mt-0">
            {data.pausas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma pausa registrada no período.
              </p>
            ) : (
              <>
                {data.pausas_limitadas && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Mostrando as 5.000 pausas mais recentes do período. Estreite o filtro para ver o resto.
                  </p>
                )}
                <div className="max-h-[32rem] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Agente</th>
                        <th className="py-2 px-3 font-medium">Data</th>
                        <th className="py-2 px-3 text-right font-medium">Início</th>
                        <th className="py-2 px-3 text-right font-medium">Fim</th>
                        <th className="py-2 px-3 text-right font-medium">Duração</th>
                        <th className="py-2 px-3 font-medium">Motivo</th>
                        <th className="py-2 pl-3 text-right font-medium">Previsto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pausas.map((p, i) => {
                        const estourou =
                          p.previsto_min !== null &&
                          !p.em_andamento &&
                          p.segundos > p.previsto_min * 60 + 300;
                        return (
                          <tr
                            key={`${p.user_id}-${p.inicio}-${i}`}
                            className="border-b border-border/50 last:border-0"
                          >
                            <td className="max-w-[14rem] truncate py-2 pr-3">{p.nome}</td>
                            <td className="whitespace-nowrap py-2 px-3">{dataCurta(p.dia)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{hora(p.inicio)}</td>
                            <td className="whitespace-nowrap py-2 px-3 text-right tabular-nums">
                              {hora(p.fim)}
                              {p.em_andamento ? (
                                <Selo tom="vivo">em curso</Selo>
                              ) : (
                                p.estimada && <Selo tom="alerta">estimado</Selo>
                              )}
                            </td>
                            <td
                              className={cn(
                                "py-2 px-3 text-right font-medium tabular-nums",
                                estourou && "text-amber-600 dark:text-amber-400",
                              )}
                              title={estourou ? "Passou do tempo que o agente pediu" : undefined}
                            >
                              {fmtHoras(p.segundos)}
                            </td>
                            <td className="max-w-[12rem] truncate py-2 px-3" title={p.motivo}>
                              {p.motivo}
                            </td>
                            <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                              {p.previsto_min !== null ? `${p.previsto_min} min` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function obsDia(d: JornadaDiaRow): string {
  const obs: string[] = [];
  if (d.sem_entrada) obs.push("sem hora de entrada");
  if (d.em_andamento) obs.push("em curso");
  else if (d.sem_saida) obs.push("sem encerramento");
  return obs.join(" / ");
}

export type { JornadaPausaRow };
