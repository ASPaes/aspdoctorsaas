import { FolderOpen, CheckCircle2, XCircle } from "lucide-react";
import KpiCard from "./KpiCard";
import type { ContagemSituacao } from "./dashMetrics";

/**
 * Foto do estado atual das jornadas. Ignora o DateRangePicker DE PROPÓSITO — é o
 * número operacional ("quantas estão na minha mão agora"), não um recorte de
 * intervalo. O resto do dashboard respeita o período; esta faixa diz na tela que não.
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
        Situação agora · ignora o período selecionado
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          icon={FolderOpen}
          label="Jornadas em aberto"
          value={String(c.emAberto)}
          sub={partes || "nenhuma em aberto"}
          tone="info"
          subTone="muted"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Jornadas concluídas"
          value={String(c.concluidas)}
          sub={`de ${c.total} no total`}
          tone="success"
          subTone="muted"
        />
        <KpiCard
          icon={XCircle}
          label="Jornadas canceladas"
          value={String(c.canceladas)}
          sub={`${c.pctCanceladas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das ${c.total} · fora dos indicadores abaixo`}
          tone={c.canceladas === 0 ? "default" : "danger"}
          subTone="muted"
        />
      </div>
    </section>
  );
}
