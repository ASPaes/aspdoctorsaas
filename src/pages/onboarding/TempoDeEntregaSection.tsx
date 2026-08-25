import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Flag, Rocket, MessageSquare } from "lucide-react";
import KpiCard from "./KpiCard";
import { formatMinUtil, formatMinCal } from "./slaFormat";
import DrilldownSheet, { type LinhaDrilldown } from "./DrilldownSheet";
import {
  coorteConcluidas, coorteImplantacao, mediaTempo, minutosEntre, pct,
  type JourneyTempo,
} from "./dashMetrics";

interface FirstContactRow {
  journey_id: string;
  distribuido_em: string | null;
  primeiro_contato_em: string | null;
  minutos_corridos: number | null;
  minutos_uteis: number | null;
}

/**
 * Três medidas de "quanto levou". A COORTE destes cards é diferente do resto do
 * painel — aqui só entra o que terminou dentro da janela — e por isso cada card diz
 * no subtítulo de quantas jornadas ele está falando.
 *
 * Tempo total e tempo de implantação saem em CALENDÁRIO: é o que o cliente sente
 * ("levou 5 dias") e é a única base em que os dois carimbos existem. O 1º contato
 * sai em EXPEDIENTE, porque é cobrança de resposta de agente e cai dentro do horário
 * de trabalho; o calendário vai junto no subtítulo.
 */
export default function TempoDeEntregaSection({
  journeys, tenantId, dateRange, allowedJourneyIds, nomes,
}: {
  journeys: JourneyTempo[];
  tenantId: string | null;
  dateRange: { from: Date; to: Date };
  allowedJourneyIds: Set<string>;
  /** Cliente e responsável por journey_id, para o drill-down. */
  nomes: { cliente: (id: string) => string; responsavel: (id: string) => string };
}) {
  const [drill, setDrill] = useState<{ titulo: string; regra: string; linhas: LinhaDrilldown[]; unidade: "util" | "cal" } | null>(null);

  const linha = useCallback(
    (journeyId: string, util: number | null, cal: number | null): LinhaDrilldown => ({
      journeyId,
      cliente: nomes.cliente(journeyId),
      responsavel: nomes.responsavel(journeyId),
      util,
      cal,
      pctSla: null, // estes cards não têm alvo cadastrado: são medida, não cobrança
    }),
    [nomes],
  );

  const firstContactQ = useQuery({
    queryKey: ["onb-first-contact", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_onboarding_first_contact", { p_tenant_id: tenantId });
      if (error) throw error;
      return (data ?? []) as FirstContactRow[];
    },
  });

  const total = useMemo(() => {
    const c = coorteConcluidas(journeys, dateRange);
    return {
      cal: mediaTempo(c.map((j) => minutosEntre(j.aberta_em, j.concluido_em))),
      n: c.length,
      linhas: c.map((j) => linha(j.journey_id, null, minutosEntre(j.aberta_em, j.concluido_em))),
    };
  }, [journeys, dateRange, linha]);

  const implantacao = useMemo(() => {
    const c = coorteImplantacao(journeys, dateRange);
    const min = (j: JourneyTempo) => minutosEntre(j.implantacao_iniciada_em, j.implantacao_concluida_em);
    return {
      cal: mediaTempo(c.map(min)),
      n: c.length,
      linhas: c.map((j) => linha(j.journey_id, null, min(j))),
    };
  }, [journeys, dateRange, linha]);

  const contato = useMemo(() => {
    const de = dateRange.from.getTime();
    const ate = dateRange.to.getTime() + 24 * 60 * 60 * 1000 - 1;
    const linhas = (firstContactQ.data ?? []).filter((r) => {
      if (!allowedJourneyIds.has(r.journey_id)) return false;
      if (!r.distribuido_em) return false;
      const t = new Date(r.distribuido_em).getTime();
      return t >= de && t <= ate;
    });
    return {
      util: mediaTempo(linhas.map((r) => r.minutos_uteis)),
      cal: mediaTempo(linhas.map((r) => r.minutos_corridos)),
      linhas: linhas.map((r) => linha(r.journey_id, r.minutos_uteis, r.minutos_corridos)),
    };
  }, [firstContactQ.data, dateRange, allowedJourneyIds, linha]);

  const cobertura = pct(contato.util.n, contato.util.total);
  const semContato = contato.util.total - contato.util.n;

  return (
    <section>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Tempo de entrega · só jornadas que terminaram no período
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          icon={Flag}
          label="Tempo total"
          value={total.cal.media == null ? "—" : formatMinCal(total.cal.media)}
          sub={`${total.n} ${total.n === 1 ? "jornada concluída" : "jornadas concluídas"} · abertura até conclusão`}
          tone="info"
          subTone="muted"
          onClick={total.n ? () => setDrill({
            titulo: "Tempo total",
            regra: `Média de (conclusão − abertura) das ${total.n} jornadas concluídas no período. Jornada ainda aberta não entra.`,
            linhas: total.linhas, unidade: "cal",
          }) : undefined}
        />
        <KpiCard
          icon={Rocket}
          label="Tempo de implantação"
          value={implantacao.cal.media == null ? "—" : formatMinCal(implantacao.cal.media)}
          sub={`${implantacao.n} ${implantacao.n === 1 ? "jornada" : "jornadas"} · amostra menor que o card ao lado`}
          tone="info"
          subTone="muted"
          onClick={implantacao.n ? () => setDrill({
            titulo: "Tempo de implantação",
            regra: `Média de (implantação concluída − implantação iniciada) das ${implantacao.n} jornadas com os dois carimbos.`,
            linhas: implantacao.linhas, unidade: "cal",
          }) : undefined}
        />
        <KpiCard
          icon={MessageSquare}
          label="1º contato com o cliente"
          value={contato.util.media == null ? "—" : formatMinUtil(contato.util.media)}
          sub={
            contato.util.total === 0
              ? "nenhuma jornada distribuída no período"
              : `${contato.util.n} de ${contato.util.total} com contato registrado · calendário ${contato.cal.media == null ? "—" : formatMinCal(contato.cal.media)}`
          }
          tone={contato.util.media == null ? "default" : "success"}
          subTone={contato.util.total > 0 && cobertura < 70 ? "warning" : "muted"}
          onClick={contato.util.total ? () => setDrill({
            titulo: "1º contato com o cliente",
            regra: `Média de (1ª mensagem do responsável ao cliente − distribuição) em horário útil. ${contato.util.n} de ${contato.util.total} jornadas distribuídas no período têm contato registrado; as outras ficam fora do numerador.`,
            linhas: contato.linhas, unidade: "util",
          }) : undefined}
        />
      </div>
      {semContato > 0 && cobertura < 70 && (
        <p className="text-[11px] text-muted-foreground mt-2">
          {semContato} de {contato.util.total} jornadas não têm mensagem do responsável ao cliente no WhatsApp.
          A média fala só das {contato.util.n} que têm.
        </p>
      )}

      <DrilldownSheet
        open={drill != null}
        onOpenChange={(v) => { if (!v) setDrill(null); }}
        titulo={drill?.titulo ?? ""}
        regra={drill?.regra ?? ""}
        linhas={drill?.linhas ?? []}
        unidade={drill?.unidade ?? "util"}
      />
    </section>
  );
}
