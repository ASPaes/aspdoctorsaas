import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatSlaHuman } from "./utils";

type Resumo = {
  total_min: number;
  tem_encerra: boolean;
  tem_inicia: boolean;
  inicia_nome: string | null;
  encerra_nome: string | null;
  segmentos: Array<{ jornada: string; min: number }>;
};

/**
 * Faixa do trilho: quanto a JORNADA INTEIRA está configurada para levar — Onboarding →
 * Implantação → Acompanhamento — somando só a janela contada (da etapa que inicia o SLA
 * até a que encerra). Espelha `fn_onb_trilho_resumo`.
 *
 * A conta vem ABERTA de propósito. A primeira versão mostrava só o total ("53d 6h") no
 * cabeçalho da coluna de um pipeline de 4d 6h, e lia como se fosse daquele pipeline. O
 * número estava certo; o rótulo escondia que 45 dos 53 dias vinham do Acompanhamento.
 *
 * O prazo do Tipo de Demanda não gera data nenhuma desde 01/08: é a metade "baseline" do
 * padrão planejado-vs-comprometido, e só serve para acusar divergência.
 */
export function TrilhoSummary({
  tenantId,
  produtoId,
}: {
  tenantId: string;
  produtoId: number | null;
}) {
  const resumoQuery = useQuery({
    queryKey: ["onb-trilho-resumo", tenantId, produtoId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_onb_trilho_resumo", {
        p_tenant_id: tenantId,
        p_produto_id: produtoId ?? null,
      });
      if (error) throw error;
      return (data ?? null) as Resumo | null;
    },
  });

  const prometidosQuery = useQuery({
    queryKey: ["onb-demand-prazos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_demand_types" as any) as any)
        .select("id, nome, sla_total_minutos, ativo")
        .eq("tenant_id", tenantId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; nome: string; sla_total_minutos: number | null; ativo: boolean;
      }>;
    },
  });

  const resumo = resumoQuery.data;
  const totalMin = resumo?.total_min ?? 0;
  const segmentos = resumo?.segmentos ?? [];

  // Só compara com quem declarou promessa: tipo inativo ou com prazo 0 não diz nada.
  const divergentes = (prometidosQuery.data ?? []).filter(
    (d) => d.ativo && (d.sla_total_minutos ?? 0) > 0 && d.sla_total_minutos !== totalMin,
  );

  if (resumoQuery.isLoading) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Somando o trilho…
      </div>
    );
  }

  if (!totalMin) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Nenhuma etapa com SLA na janela contada — o go-live não pode ser calculado.
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <span className="uppercase tracking-wide text-[9px]">Jornada completa</span>{" "}
        <span className="text-muted-foreground/70">(todas as fases, não só este pipeline)</span>
        <br />
        {segmentos.map((s, i) => (
          <span key={s.jornada}>
            {i > 0 && <span className="text-muted-foreground/60"> + </span>}
            {s.jornada}{" "}
            <span className="font-mono text-foreground">{formatSlaHuman(s.min)}</span>
          </span>
        ))}
        <span className="text-muted-foreground/60"> = </span>
        <span className="font-mono font-semibold text-foreground">{formatSlaHuman(totalMin)}</span>{" "}
        úteis
      </p>

      {resumo?.tem_encerra ? (
        <p className="text-[11px] text-muted-foreground">
          Contagem: «{resumo.inicia_nome}» → «{resumo.encerra_nome}»
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-[11px] text-sky-400">
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            Nenhuma etapa marcada para <strong>encerrar a contagem</strong> — o relógio corre
            até o fim da última fase. Marque a etapa onde o compromisso com o cliente termina
            para o total parar ali.
          </span>
        </p>
      )}

      {divergentes.map((d) => {
        const prometido = d.sla_total_minutos ?? 0;
        const acima = totalMin > prometido;
        return (
          <p key={d.id} className="flex items-start gap-1.5 text-[11px] text-amber-500">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>
              prazo prometido em «{d.nome}»: {formatSlaHuman(prometido)} — plano{" "}
              {formatSlaHuman(Math.abs(totalMin - prometido))}{" "}
              {acima ? "acima da promessa" : "abaixo da promessa"}
            </span>
          </p>
        );
      })}
    </div>
  );
}
