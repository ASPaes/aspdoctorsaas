import { Fragment } from "react";
import { Loader2, MessageSquare, Repeat, ArrowDownLeft, Tag } from "lucide-react";
import { useAtendimentoVolume } from "./useAtendimentoVolume";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const CANAL_LABEL: Record<string, string> = {
  customer: "Cliente",
  agent: "Agente",
  operator: "Operador",
  out_of_hours: "Fora do horário",
  billing_automation: "Cobrança (auto)",
  ticket: "Ticket",
  "(sem origem)": "Sem origem",
};

export function VolumeTab() {
  const { data, isLoading, isError, error } = useAtendimentoVolume();

  const pct = (n: number, base: number) =>
    base > 0 ? `${Math.round((100 * n) / base)}%` : "—";

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !data ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível carregar o volume.</p>
          {error instanceof Error && (
            <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          )}
        </div>
      ) : data.total === 0 ? (
        <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Nenhum atendimento no período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICardEnhanced
              label="Total no Período"
              value={data.total.toLocaleString("pt-BR")}
              helpKey="atendimento_volume_total"
              icon={<MessageSquare className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Novos vs Recorrentes"
              value={`${data.novos.toLocaleString("pt-BR")} / ${data.recorrentes.toLocaleString("pt-BR")}`}
              subtitle={`${pct(data.novos, data.total)} novos`}
              helpKey="atendimento_novos_recorrentes"
              icon={<Repeat className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Proativo vs Reativo"
              value={`${data.proativo.toLocaleString("pt-BR")} / ${data.reativo.toLocaleString("pt-BR")}`}
              subtitle={`${pct(data.proativo, data.proativo + data.reativo)} proativo`}
              helpKey="atendimento_proativo_reativo"
              icon={<ArrowDownLeft className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Top Motivo"
              value={data.top_motivos[0]?.tag ?? "—"}
              subtitle={
                data.top_motivos[0]
                  ? `${data.top_motivos[0].qtd.toLocaleString("pt-BR")} atendimento(s)`
                  : "sem tag"
              }
              helpKey="atendimento_top_motivos"
              icon={<Tag className="h-4 w-4" />}
              variant="dark"
            />
          </div>

          {/* Heatmap */}
          <div className="rounded-lg border border-border bg-card p-4">
            {/* O eixo muda com o filtro de Horário: em "Só plantão" o mapa passa a
                usar a hora do trabalho fora do expediente, e não a de abertura.
                Sem dizer isso na tela, um atendimento aberto sexta 16h cujo
                plantão foi na quinta 21h20 se lia como "plantão na sexta". */}
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">
                  {data.heatmap_eixo === "plantao"
                    ? "Mapa de Calor — quando houve plantão"
                    : "Mapa de Calor — hora × dia"}
                </h3>
                <KpiHelpPopover kpiKey="atendimento_heatmap" />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {data.heatmap_eixo === "plantao"
                  ? "Hora em que houve trabalho fora do expediente — não a hora de abertura do atendimento."
                  : "Hora de abertura do atendimento (horário de Brasília)."}
              </p>
            </div>
            {(() => {
              const max = Math.max(1, ...data.heatmap.map((c) => c.qtd));
              const lookup = new Map<string, number>();
              const detalhes = new Map<string, typeof data.heatmap[number]["detalhes"]>();
              data.heatmap.forEach((c) => {
                lookup.set(`${c.dow}-${c.hora}`, c.qtd);
                detalhes.set(`${c.dow}-${c.hora}`, c.detalhes);
              });

              // A célula é por HORA, mas a tolerância do plantão é de 30 min: um
              // plantão às 18:32 cai no balde "18" e parece dia de trabalho. E
              // cada setor fecha num horário — o Onboarding às 17:00 na sexta, o
              // Suporte às 22:00 no sábado. Sem hora:minuto e setor, a célula não
              // se explica.
              const tituloCelula = (d: number, h: number, label: string, q: number) => {
                const base = `${label} ${h}h — ${q} atendimento(s)`;
                const det = detalhes.get(`${d}-${h}`);
                if (!det || det.length === 0) return base;
                const linhas = det.map((x) =>
                  [x.hora, x.setor, x.fecha ? `fecha ${x.fecha}` : null]
                    .filter(Boolean)
                    .join(" · "),
                );
                const resto = q - det.length;
                return [base, ...linhas, resto > 0 ? `+${resto}` : null]
                  .filter(Boolean)
                  .join("\n");
              };
              return (
                <div className="overflow-x-auto">
                  <div className="inline-block min-w-full">
                    <div className="grid grid-cols-[40px_repeat(24,minmax(18px,1fr))] gap-[2px] items-center">
                      <div />
                      {Array.from({ length: 24 }).map((_, h) => (
                        <div key={`h-${h}`} className="text-[10px] text-muted-foreground text-center">
                          {h % 3 === 0 ? h : ""}
                        </div>
                      ))}
                      {DOW.map((label, d) => (
                        <Fragment key={`row-${d}`}>
                          <div className="text-[10px] text-muted-foreground pr-1 text-right">
                            {label}
                          </div>
                          {Array.from({ length: 24 }).map((_, h) => {
                            const q = lookup.get(`${d}-${h}`) ?? 0;
                            const alpha = q === 0 ? 0 : 0.12 + 0.88 * (q / max);
                            return (
                              <div
                                key={`c-${d}-${h}`}
                                className="h-5 rounded-[2px] border border-border/40"
                                style={{
                                  background:
                                    q > 0 ? `hsl(var(--primary) / ${alpha})` : "transparent",
                                }}
                                title={tituloCelula(d, h, label, q)}
                              />
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Canais */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Canais de Abertura</h3>
                <KpiHelpPopover kpiKey="atendimento_canais" />
              </div>
              {(() => {
                const max = Math.max(1, ...data.canais.map((c) => c.qtd));
                return (
                  <div className="space-y-2">
                    {data.canais.map((c) => (
                      <div
                        key={c.canal}
                        className="grid grid-cols-[140px_1fr_60px] items-center gap-2 text-xs"
                      >
                        <span className="truncate">{CANAL_LABEL[c.canal] ?? c.canal}</span>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${(100 * c.qtd) / max}%` }}
                          />
                        </div>
                        <span className="text-right tabular-nums">
                          {c.qtd.toLocaleString("pt-BR")}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Top motivos */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Top Motivos</h3>
                <KpiHelpPopover kpiKey="atendimento_top_motivos" />
              </div>
              {data.top_motivos.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem tags no período.</p>
              ) : (
                <>
                  {(() => {
                    const max = Math.max(1, ...data.top_motivos.map((m) => m.qtd));
                    return (
                      <div className="space-y-2">
                        {data.top_motivos.map((m) => (
                          <div
                            key={m.tag}
                            className="grid grid-cols-[140px_1fr_60px] items-center gap-2 text-xs"
                          >
                            <span className="truncate" title={m.tag}>
                              {m.tag}
                            </span>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${(100 * m.qtd) / max}%` }}
                              />
                            </div>
                            <span className="text-right tabular-nums">
                              {m.qtd.toLocaleString("pt-BR")}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {data.motivos_cobertura !== null && (
                    <p className="mt-3 text-[11px] text-muted-foreground italic">
                      Cobertura: {data.motivos_cobertura}% dos atendimentos têm tag.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
