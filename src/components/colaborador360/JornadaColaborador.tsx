import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Cartao, Mini, Vazio } from "@/components/clientes/visao360/Visao360Ui";
import type { AtendimentoJornada } from "@/components/atendimento/useAtendimentoJornada";
import { excessoDePausa } from "./colaborador360Analise";

/** Horas sem virar dias: soma de jornada não é tempo corrido. */
function fmtHoras(s: number) {
  if (!s) return "0 min";
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}` : `${m} min`;
}

const INI = 7, FIM = 20; // faixa desenhada: 7h às 20h
const hSP = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  const [h, m] = p.split(":").map(Number);
  return (h % 24) + m / 60;
};
const pos = (h: number) => `${((Math.min(FIM, Math.max(INI, h)) - INI) / (FIM - INI)) * 100}%`;
const larg = (a: number, b: number) => `${((Math.min(FIM, Math.max(INI, b)) - Math.min(FIM, Math.max(INI, a))) / (FIM - INI)) * 100}%`;

/**
 * Jornada e pausas da pessoa. Mesmo dado da aba Jornada / Pausas do Dashboard
 * de Atendimento, com as mesmas ressalvas: o registro é furado em parte dos
 * dias e a RPC trunca no último evento em vez de inventar horário.
 */
export function JornadaColaborador({ jornada }: { jornada: AtendimentoJornada }) {
  const t = jornada.totais;
  const ex = useMemo(() => excessoDePausa(jornada), [jornada]);
  const dias = useMemo(() => [...jornada.dias].sort((a, b) => (a.dia < b.dia ? 1 : -1)).slice(0, 10), [jornada.dias]);
  const pontuais = jornada.dias.filter((d) => d.entrada && !d.sem_entrada).length;

  const motivos = useMemo(() => {
    const m = new Map<string, { real: number; previsto: number; n: number }>();
    for (const p of jornada.pausas) {
      const g = m.get(p.motivo) ?? { real: 0, previsto: 0, n: 0 };
      g.real += p.segundos;
      g.n++;
      if (p.previsto_min != null) g.previsto += p.previsto_min * 60;
      m.set(p.motivo, g);
    }
    return [...m.entries()].sort((a, b) => b[1].real - a[1].real);
  }, [jornada.pausas]);
  const maxMotivo = Math.max(1, ...motivos.map(([, g]) => Math.max(g.real, g.previsto)));

  if (!t.dias) return <Vazio>Nenhum expediente registrado no período.</Vazio>;

  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini rotulo="Tempo em expediente" valor={fmtHoras(t.ativo_seg)} sub={`${t.dias} dia${t.dias === 1 ? "" : "s"} com expediente`} />
        <Mini rotulo="Em pausa" valor={fmtHoras(t.pausa_seg)} sub={`${t.pausas} pausa${t.pausas === 1 ? "" : "s"}`} />
        <Mini
          rotulo="Acima do previsto" valor={fmtHoras(ex.segundos)} tom={ex.segundos >= 30 * 60 ? "ruim" : undefined}
          sub={ex.pausas ? `em ${ex.pausas} pausa${ex.pausas === 1 ? "" : "s"}` : "todas dentro do previsto"}
        />
        <Mini rotulo="Dias com entrada registrada" valor={`${pontuais} de ${t.dias}`} sub={t.dias_incompletos ? `${t.dias_incompletos} dia${t.dias_incompletos === 1 ? "" : "s"} com registro incompleto` : "registro completo"} />
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Cartao
          titulo="Últimos dias"
          acao={
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Expediente</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Pausa</span>
            </div>
          }
        >
          <div className="grid gap-1.5 px-4 pb-4">
            <div className="grid grid-cols-[104px_minmax(0,1fr)_62px] gap-2.5 text-[10.5px] text-muted-foreground">
              <span />
              <div className="flex justify-between"><span>7h</span><span>10h</span><span>13h</span><span>16h</span><span>20h</span></div>
              <span />
            </div>
            {dias.map((d) => {
              const pausas = jornada.pausas.filter((p) => p.dia === d.dia);
              return (
                <div key={d.dia} className="grid grid-cols-[104px_minmax(0,1fr)_62px] items-center gap-2.5 text-xs">
                  <span className="truncate">
                    {format(parseISO(d.dia), "EEE dd/MM", { locale: ptBR })}
                  </span>
                  <div className="relative h-[18px] overflow-hidden rounded-md bg-muted" title={d.sem_entrada ? "Dia sem hora de entrada registrada" : undefined}>
                    {d.entrada && (
                      <span className="absolute inset-y-0 bg-emerald-500/80"
                        style={{ left: pos(hSP(d.entrada)), width: larg(hSP(d.entrada), d.saida ? hSP(d.saida) : hSP(d.entrada) + d.bruto_seg / 3600) }} />
                    )}
                    {pausas.map((p, i) => (
                      <span key={i} className={cn("absolute inset-y-0", p.estimada ? "bg-amber-500/50" : "bg-amber-500")}
                        style={{ left: pos(hSP(p.inicio)), width: larg(hSP(p.inicio), p.fim ? hSP(p.fim) : hSP(p.inicio) + p.segundos / 3600) }}
                        title={`${p.motivo}: ${Math.round(p.segundos / 60)} min${p.previsto_min != null ? ` (previsto ${p.previsto_min})` : ""}`} />
                    ))}
                  </div>
                  <span className="text-right font-bold tabular-nums">{fmtHoras(d.ativo_seg)}</span>
                </div>
              );
            })}
          </div>
        </Cartao>

        <Cartao titulo="Pausas por motivo" sub="real × previsto">
          {motivos.length === 0 ? <Vazio>Nenhuma pausa no período.</Vazio> : (
            <div className="grid gap-3 px-4 pb-4">
              {motivos.map(([nome, g]) => {
                const acima = g.previsto > 0 && g.real > g.previsto * 1.05;
                return (
                  <div key={nome} className="grid gap-1 text-[12.5px]">
                    <div className="flex justify-between gap-2">
                      <span>{nome} <span className="text-muted-foreground">· {g.n}×</span></span>
                      <b className={cn("tabular-nums", acima && "text-amber-600 dark:text-amber-400")}>{fmtHoras(g.real)}</b>
                    </div>
                    <div className="relative h-2 rounded-full bg-muted">
                      <span className={cn("absolute inset-y-0 left-0 rounded-full", acima ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${(g.real / maxMotivo) * 100}%` }} />
                      {g.previsto > 0 && <span className="absolute -top-[3px] h-3.5 w-0.5 rounded bg-muted-foreground/70" style={{ left: `${(g.previsto / maxMotivo) * 100}%` }} title={`previsto: ${fmtHoras(g.previsto)}`} />}
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-muted-foreground">O traço é o total previsto pela duração média de cada motivo. Laranja passa do previsto.</p>
            </div>
          )}
        </Cartao>
      </div>

      <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
        Não é marcação de ponto. Vem do botão de expediente e pausa do chat. Dia em que a pessoa fechou o navegador sem encerrar fica com o fim estimado no último registro.
      </p>
    </div>
  );
}
