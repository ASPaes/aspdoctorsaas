import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowUp,
  ArrowDown,
  CheckCircle,
  AlertCircle,
  Ban,
  FileText,
  History,
  Clock,
} from "lucide-react";

interface Props {
  clienteId: string;
}

interface LogItem {
  quando: string;
  evento: string;
  entidade: string;
  status: "sucesso" | "erro" | "ignorado" | string;
  erro?: string | null;
  rotulo: string;
  direcao: "Envio ao Omie" | "Recebimento do Omie" | string;
}

interface OmieDadosLog {
  contratoIds: string[];
  codigoClienteOmie: string | number | null;
  codigosContratoOmie: (string | number)[];
}

function statusConfig(status?: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "sucesso" || s === "success") {
    return {
      icon: CheckCircle,
      badge: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900",
      label: "Sucesso",
    };
  }
  if (s === "erro" || s === "error") {
    return {
      icon: AlertCircle,
      badge: "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
      label: "Erro",
    };
  }
  if (s === "ignorado" || s === "ignored" || s === "skip") {
    return {
      icon: Ban,
      badge: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-900/40 dark:text-slate-400 dark:border-slate-700",
      label: "Ignorado",
    };
  }
  return {
    icon: FileText,
    badge: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
    label: status || "Info",
  };
}

function direcaoIcon(direcao?: string | null) {
  const d = (direcao || "").toLowerCase();
  if (d.includes("recebimento") || d.includes("recebido") || d.includes("do omie")) {
    return { Icon: ArrowDown, label: direcao || "Recebimento do Omie" };
  }
  return { Icon: ArrowUp, label: direcao || "Envio ao Omie" };
}

function formatQuando(quando?: string | null): string {
  if (!quando) return "—";
  try {
    const d = new Date(quando);
    if (isNaN(d.getTime())) return quando;
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return quando;
  }
}

export default function OmieIntegrationLogCard({ clienteId }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const dadosQuery = useQuery<OmieDadosLog>({
    queryKey: ["cliente-omie-dados-log", tid, clienteId],
    enabled: !!tid && !!clienteId,
    queryFn: async () => {
      let q = (supabase.from("contratos") as any)
        .select("id")
        .eq("cliente_id", clienteId)
        .eq("status", "ativo");
      if (tid) q = q.eq("tenant_id", tid);
      const { data: contratos, error } = await q;
      if (error) throw error;

      const ids = (contratos ?? []).map((c: any) => c.id);

      let vinculos: any[] = [];
      if (ids.length > 0) {
        const { data: v, error: vError } = await supabase
          .from("reconciliacao_cadastro")
          .select("ds_customer_id, ds_contract_id, codigo_cliente_omie, codigo_contrato_omie")
          .eq("tenant_id", tid)
          .eq("estado_match", "CASADO")
          .not("codigo_contrato_omie", "is", null)
          .in("ds_contract_id", ids);
        if (vError) throw vError;
        vinculos = v ?? [];
      }

      const codigoClienteOmie = vinculos[0]?.codigo_cliente_omie ?? null;
      const codigosContratoOmie = vinculos
        .map((v) => v.codigo_contrato_omie)
        .filter((c): c is string | number => c != null);

      return {
        contratoIds: ids,
        codigoClienteOmie,
        codigosContratoOmie,
      };
    },
  });

  const logsQuery = useQuery<LogItem[]>({
    queryKey: [
      "omie-integration-log",
      tid,
      clienteId,
      dadosQuery.data?.contratoIds,
      dadosQuery.data?.codigoClienteOmie,
      dadosQuery.data?.codigosContratoOmie,
    ],
    enabled: !!tid && !!clienteId && !!dadosQuery.data,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: {
          acao: "listar_log",
          tenant_id: tid,
          dados: {
            ds_customer_id: clienteId,
            ds_contract_ids: dadosQuery.data?.contratoIds ?? [],
            codigo_cliente_omie: dadosQuery.data?.codigoClienteOmie ?? null,
            codigo_contrato_omie: dadosQuery.data?.codigosContratoOmie ?? [],
          },
        },
      });
      if (error) throw error;
      return (data?.resultado?.logs ?? []) as LogItem[];
    },
  });

  if (!tid) return null;

  const logs = logsQuery.data ?? [];
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime()
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Log de Integração Omie
        </CardTitle>
      </CardHeader>
      <CardContent>
        {dadosQuery.isLoading || logsQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : logsQuery.isError ? (
          <div className="text-sm text-muted-foreground">
            Não foi possível carregar o log de integração.
          </div>
        ) : sortedLogs.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nenhuma atividade de integração registrada para este cliente.
          </div>
        ) : (
          <ScrollArea className="h-[320px] pr-3">
            <div className="space-y-3">
              {sortedLogs.map((log, idx) => {
                const { icon: StatusIcon, badge, label } = statusConfig(log.status);
                const { Icon: DirecaoIcon, label: direcaoLabel } = direcaoIcon(log.direcao);
                return (
                  <div
                    key={idx}
                    className="rounded-md border p-3 text-sm space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Clock className="h-3 w-3" />
                        {formatQuando(log.quando)}
                      </div>
                      <Badge variant="outline" className={badge}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {label}
                      </Badge>
                    </div>
                    <div className="flex items-start gap-2">
                      <DirecaoIcon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium">{log.rotulo || log.evento || "Evento"}</div>
                        <div className="text-xs text-muted-foreground">
                          {direcaoLabel}
                          {log.entidade && ` · ${log.entidade}`}
                        </div>
                      </div>
                    </div>
                    {log.erro && (
                      <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-2 py-1.5 text-xs text-red-700 dark:text-red-400">
                        {log.erro}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
