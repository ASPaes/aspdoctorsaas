import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatSlaHuman } from "./utils";

/**
 * Faixa do trilho: quanto tempo a jornada inteira está configurada para levar, somando
 * só a JANELA contada — da etapa que inicia o SLA até a que encerra, atravessando
 * Onboarding → Implantação → Acompanhamento. Espelha `fn_onb_trilho_sla_min`.
 *
 * O prazo do Tipo de Demanda NÃO gera data nenhuma desde 01/08: é a metade "baseline"
 * do padrão planejado-vs-comprometido. Serve só para acusar que o plano de etapas não
 * cabe na promessa comercial — quem decide o que arrumar é o admin.
 */
export function TrilhoSummary({
  tenantId,
  produtoId,
}: {
  tenantId: string;
  produtoId: number | null;
}) {
  const trilhoQuery = useQuery({
    queryKey: ["onb-trilho-sla", tenantId, produtoId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_onb_trilho_sla_min", {
        p_tenant_id: tenantId,
        p_produto_id: produtoId ?? null,
      });
      if (error) throw error;
      return (data as number | null) ?? 0;
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

  const trilhoMin = trilhoQuery.data ?? 0;

  // Só compara com quem declarou promessa: tipo inativo ou com prazo 0 não diz nada.
  const divergentes = (prometidosQuery.data ?? []).filter(
    (d) => d.ativo && (d.sla_total_minutos ?? 0) > 0 && d.sla_total_minutos !== trilhoMin,
  );

  if (trilhoQuery.isLoading) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Somando o trilho…
      </div>
    );
  }

  if (!trilhoMin) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Nenhuma etapa com SLA na janela contada — o go-live não pode ser calculado.
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">
        Trilho completo ·{" "}
        <span className="font-mono font-semibold text-foreground">{formatSlaHuman(trilhoMin)}</span>{" "}
        úteis até o encerramento da contagem
      </p>
      {divergentes.map((d) => {
        const prometido = d.sla_total_minutos ?? 0;
        const acima = trilhoMin > prometido;
        return (
          <p key={d.id} className="flex items-start gap-1.5 text-[11px] text-amber-500">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>
              prazo prometido em «{d.nome}»: {formatSlaHuman(prometido)} — plano{" "}
              {formatSlaHuman(Math.abs(trilhoMin - prometido))}{" "}
              {acima ? "acima da promessa" : "abaixo da promessa"}
            </span>
          </p>
        );
      })}
    </div>
  );
}
