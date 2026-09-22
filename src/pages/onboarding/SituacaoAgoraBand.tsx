import { useState } from "react";
import { FolderOpen, FolderPlus, CheckCircle2, XCircle } from "lucide-react";
import KpiCard from "./KpiCard";
import JornadasDrilldown from "./JornadasDrilldown";
import type { LinhaJornada } from "./jornadaLinha";
import type { ContagemSituacao } from "./dashMetrics";

/** As jornadas por trás de cada número, na mesma ordem dos quatro cartões. */
export interface LinhasSituacao {
  emAberto: LinhaJornada[];
  abertasNoPeriodo: LinhaJornada[];
  concluidas: LinhaJornada[];
  canceladas: LinhaJornada[];
}

/**
 * Faixa de situação. Os quatro cartões NÃO seguem a mesma regra, e isso é deliberado:
 *
 *  - **Em aberto** é foto do agora — quanto está na mão da equipe hoje. Ignora o
 *    período, e o próprio cartão avisa.
 *  - **Abertas no período** é a entrada do fluxo: nasceu dentro do período, esteja em
 *    que situação estiver hoje. É a contrapartida dos dois desfechos.
 *  - **Concluídas** e **canceladas** são desfechos, e desfecho tem data: contam o que
 *    terminou dentro do período.
 *
 * Entrada e desfecho se sobrepõem de propósito: jornada aberta e concluída no mesmo
 * mês conta nos dois. Por isso o "% das N" do cartão de canceladas ignora a entrada.
 *
 * Até 25/08 os cartões de então ignoravam o período, e os dois de desfecho viravam
 * total desde que o módulo existe — nunca mudavam ao trocar a data. Foi a queixa do
 * cliente. O cartão de entrada entrou em 11/09 (DEM-0327), pelo mesmo motivo: o
 * dashboard mostrava as saídas do período e nenhuma entrada.
 *
 * Desde 21/09 (DEM-0439) cada número abre a lista dos clientes que ele conta. As
 * listas chegam prontas da página, separadas pelo MESMO predicado que produziu a
 * contagem (`listarSituacao`) — recontar aqui abriria espaço para a lista discordar
 * do número que ela explica.
 */
export default function SituacaoAgoraBand({ contagem, linhas }: { contagem: ContagemSituacao; linhas?: LinhasSituacao }) {
  const c = contagem;
  const [drill, setDrill] = useState<{ titulo: string; regra: string; linhas: LinhaJornada[]; ordem: "abertura" | "desfecho" } | null>(null);
  /** Só vira botão quando há lista e ela tem alguém: cartão zerado não abre painel vazio. */
  const abrir = (d: { titulo: string; regra: string; linhas: LinhaJornada[] | undefined; ordem: "abertura" | "desfecho" }) =>
    d.linhas && d.linhas.length ? () => setDrill({ ...d, linhas: d.linhas! }) : undefined;
  const partes = [
    c.emAndamento > 0 ? `${c.emAndamento} em andamento` : null,
    c.naoIniciadas > 0 ? `${c.naoIniciadas} ${c.naoIniciadas === 1 ? "não iniciada" : "não iniciadas"}` : null,
    c.paradas > 0 ? `${c.paradas} ${c.paradas === 1 ? "parada" : "paradas"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Situação das jornadas
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={FolderOpen}
          label="Jornadas em aberto"
          value={String(c.emAberto)}
          sub={`${partes || "nenhuma em aberto"} · hoje, não do período`}
          tone="info"
          subTone="muted"
          onClick={abrir({
            titulo: "Jornadas em aberto",
            regra: `As ${c.emAberto} jornadas que estão na mão da equipe HOJE — não iniciadas, em andamento e paradas. Este cartão ignora o período de propósito: jornada aberta antes dele e ainda rodando continua na mão.`,
            linhas: linhas?.emAberto,
            ordem: "abertura",
          })}
        />
        <KpiCard
          icon={FolderPlus}
          label="Jornadas abertas no período"
          value={String(c.abertasNoPeriodo)}
          sub="abertas no período · em qualquer situação hoje"
          tone="default"
          subTone="muted"
          onClick={abrir({
            titulo: "Jornadas abertas no período",
            regra: `As ${c.abertasNoPeriodo} jornadas cuja ABERTURA caiu no período, na situação em que estiverem hoje — inclui as que já foram concluídas ou canceladas.`,
            linhas: linhas?.abertasNoPeriodo,
            ordem: "abertura",
          })}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Jornadas concluídas"
          value={String(c.concluidas)}
          sub="concluídas no período"
          tone="success"
          subTone="muted"
          onClick={abrir({
            titulo: "Jornadas concluídas",
            regra: `As ${c.concluidas} jornadas cuja CONCLUSÃO caiu no período. A data de abertura pode ser anterior a ele.`,
            linhas: linhas?.concluidas,
            ordem: "desfecho",
          })}
        />
        <KpiCard
          icon={XCircle}
          label="Jornadas canceladas"
          value={String(c.canceladas)}
          sub={`canceladas no período · ${c.pctCanceladas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das ${c.total} · fora dos indicadores abaixo`}
          tone={c.canceladas === 0 ? "default" : "danger"}
          subTone="muted"
          onClick={abrir({
            titulo: "Jornadas canceladas",
            regra: `As ${c.canceladas} jornadas canceladas dentro do período. O carimbo de cancelamento vem do evento do ticket — a jornada não guarda essa data.${c.canceladasSemData > 0 ? ` ${c.canceladasSemData} sem esse carimbo ${c.canceladasSemData === 1 ? "ficou" : "ficaram"} fora desta lista.` : ""}`,
            linhas: linhas?.canceladas,
            ordem: "desfecho",
          })}
        />
      </div>
      {c.canceladasSemData > 0 && (
        <p className="text-[11px] text-muted-foreground mt-2">
          {c.canceladasSemData} {c.canceladasSemData === 1 ? "jornada cancelada não tem" : "jornadas canceladas não têm"} data
          de cancelamento registrada e {c.canceladasSemData === 1 ? "fica" : "ficam"} fora da contagem por período.
        </p>
      )}

      <JornadasDrilldown
        open={drill != null}
        onOpenChange={(v) => { if (!v) setDrill(null); }}
        titulo={drill?.titulo ?? ""}
        regra={drill?.regra ?? ""}
        linhas={drill?.linhas ?? []}
        ordem={drill?.ordem ?? "abertura"}
      />
    </section>
  );
}
