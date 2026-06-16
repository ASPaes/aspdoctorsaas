import { useState, type ReactNode } from "react";
import { useAtendimentoRealtime } from "./useAtendimentoRealtime";
import { VerChatsDialog } from "./VerChatsDialog";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";
import { cn } from "@/lib/utils";
import { Loader2, Users, AlertTriangle } from "lucide-react";

export function fmtEspera(seg: number): string {
  if (!seg || seg <= 0) return "—";
  if (seg > 86400) {
    const d = Math.floor(seg / 86400);
    const h = Math.floor((seg % 86400) / 3600);
    return `${d}d ${h}h`;
  }
  if (seg > 3600) {
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.max(1, Math.floor(seg / 60));
  return `${m}m`;
}

interface KpiCardProps {
  kpiKey: string;
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  tone?: "default" | "danger" | "warning";
  onVerChats?: () => void;
}

function KpiCard({ kpiKey, label, value, subtitle, tone = "default", onVerChats }: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        tone === "danger" && "border-destructive/40 bg-destructive/5",
        tone === "warning" && "border-amber-500/40 bg-amber-500/5"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <KpiHelpPopover kpiKey={kpiKey} />
      </div>
      <div
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-amber-600 dark:text-amber-400"
        )}
      >
        {value}
      </div>
      {subtitle && (
        <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      )}
      {onVerChats && (
        <button
          type="button"
          onClick={onVerChats}
          className="mt-2 text-xs font-medium text-primary hover:underline focus:outline-none"
        >
          Ver chats →
        </button>
      )}
    </div>
  );
}

export function TempoRealTab() {
  const { data, isLoading, isError, error } = useAtendimentoRealtime();
  const [verBucket, setVerBucket] = useState<{ bucket: string; title: string } | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Não foi possível carregar os indicadores em tempo real.
        {error instanceof Error && <div className="mt-1 text-xs opacity-80">{error.message}</div>}
      </div>
    );
  }

  const agentesOrdenados = [...data.atendendo_por_agente].sort((a, b) => b.qtd - a.qtd);
  const cargaMax = agentesOrdenados[0]?.qtd ?? 0;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          kpiKey="atendimento_fila"
          label="Fila Agora"
          value={data.fila}
          subtitle={
            data.fila_fora_hora > 0
              ? `+${data.fila_fora_hora} fora do horário`
              : "dentro do horário"
          }
          onVerChats={data.fila > 0 ? () => setVerBucket({ bucket: "fila", title: "Fila Agora" }) : undefined}
        />
        <KpiCard
          kpiKey="atendimento_espera_mais_antigo"
          label="Espera Mais Antiga"
          value={fmtEspera(data.espera_mais_antigo_seg)}
          subtitle="cliente aguardando há mais tempo"
        />
        <KpiCard
          kpiKey="atendimento_em_atendimento"
          label="Em Atendimento"
          value={data.em_atendimento}
          subtitle="conversas ativas com agente"
          onVerChats={data.em_atendimento > 0 ? () => setVerBucket({ bucket: "em_atendimento", title: "Em Atendimento" }) : undefined}
        />
        <KpiCard
          kpiKey="atendimento_sla_estourando"
          label="Estourando SLA"
          value={data.sla_estourando}
          subtitle="acima do limite de 1ª resposta"
          tone={data.sla_estourando > 0 ? "danger" : "default"}
          onVerChats={data.sla_estourando > 0 ? () => setVerBucket({ bucket: "sla_estourando", title: "Estourando SLA" }) : undefined}
        />
        <KpiCard
          kpiKey="atendimento_parados_24h"
          label="Parados > 24h"
          value={data.parados_24h}
          subtitle="precisam de ação imediata"
          tone={data.parados_24h > 0 ? "warning" : "default"}
          onVerChats={data.parados_24h > 0 ? () => setVerBucket({ bucket: "parados_24h", title: "Parados > 24h" }) : undefined}
        />
      </div>

      {/* Listas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ativos por departamento */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Ativos por Departamento</h3>
            </div>
            <KpiHelpPopover kpiKey="atendimento_ativos_depto" />
          </div>
          {data.ativos_por_depto.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Ninguém em atendimento agora.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.ativos_por_depto.map((d) => (
                <li
                  key={d.department_id ?? "sem-depto"}
                  className="flex items-center justify-between py-2"
                >
                  <span className="text-sm truncate">{d.nome ?? "Sem departamento"}</span>
                  <span className="text-sm font-semibold tabular-nums">{d.qtd}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Atendendo por agente */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Atendendo por Agente</h3>
            </div>
            <KpiHelpPopover kpiKey="atendimento_atendendo_agente" />
          </div>
          {agentesOrdenados.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Fila vazia / ninguém atendendo.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {agentesOrdenados.map((a) => {
                const sobrecarga = cargaMax >= 5 && a.qtd >= Math.max(5, Math.ceil(cargaMax * 0.8));
                return (
                  <li
                    key={a.agent_id}
                    className={cn(
                      "flex items-center justify-between py-2",
                      sobrecarga && "text-amber-600 dark:text-amber-400"
                    )}
                  >
                    <span className="text-sm truncate flex items-center gap-1.5">
                      {sobrecarga && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                      {a.nome ?? "Sem nome"}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{a.qtd}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 text-xs text-muted-foreground italic">
            Presença (online/ocioso) em breve.
          </div>
        </div>
      </div>
    </div>
  );
}
