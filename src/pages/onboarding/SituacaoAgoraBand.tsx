import { FolderOpen, FolderPlus, CheckCircle2, XCircle } from "lucide-react";
import KpiCard from "./KpiCard";
import type { ContagemSituacao } from "./dashMetrics";

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
 */
export default function SituacaoAgoraBand({ contagem }: { contagem: ContagemSituacao }) {
  const c = contagem;
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
        />
        <KpiCard
          icon={FolderPlus}
          label="Jornadas abertas no período"
          value={String(c.abertasNoPeriodo)}
          sub="abertas no período · em qualquer situação hoje"
          tone="default"
          subTone="muted"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Jornadas concluídas"
          value={String(c.concluidas)}
          sub="concluídas no período"
          tone="success"
          subTone="muted"
        />
        <KpiCard
          icon={XCircle}
          label="Jornadas canceladas"
          value={String(c.canceladas)}
          sub={`canceladas no período · ${c.pctCanceladas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das ${c.total} · fora dos indicadores abaixo`}
          tone={c.canceladas === 0 ? "default" : "danger"}
          subTone="muted"
        />
      </div>
      {c.canceladasSemData > 0 && (
        <p className="text-[11px] text-muted-foreground mt-2">
          {c.canceladasSemData} {c.canceladasSemData === 1 ? "jornada cancelada não tem" : "jornadas canceladas não têm"} data
          de cancelamento registrada e {c.canceladasSemData === 1 ? "fica" : "ficam"} fora da contagem por período.
        </p>
      )}
    </section>
  );
}
