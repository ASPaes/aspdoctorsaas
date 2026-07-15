import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
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
  status: "sucesso" | "erro" | "ignorado" | string;
  evento?: string | null;
  entidade?: string | null;
  error_message?: string | null;
  erro?: string | null;
  detalhe?: string | null;
  direcao_texto?: string | null;
  response?: { campos_enviados?: string[] | null } | null;
  campos_enviados?: string[] | null;
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
      badge:
        "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900",
      label: "Enviado",
    };
  }
  if (s === "erro" || s === "error") {
    return {
      icon: AlertCircle,
      badge:
        "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
      label: "Falhou",
    };
  }
  if (s === "ignorado" || s === "ignored" || s === "skip") {
    return {
      icon: Ban,
      badge:
        "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
      label: "Não enviado",
    };
  }
  return {
    icon: FileText,
    badge:
      "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
    label: status || "Info",
  };
}

const EVENTO_LABELS: Record<string, string> = {
  "criar|cliente": "Cliente criado no Omie",
  "atualizar|cliente": "Cadastro do cliente atualizado no Omie",
  "criar|contrato": "Contrato criado no Omie",
  "atualizar|contrato": "Contrato atualizado no Omie",
  "cancelar|contrato": "Contrato cancelado no Omie",
  "reativar|contrato": "Contrato reativado no Omie",
};

function eventoLabel(log: LogItem): string {
  const ev = (log.evento || "").toLowerCase();
  const en = (log.entidade || "").toLowerCase();
  if (ev === "testar") return "Teste de conexão";
  const key = `${ev}|${en}`;
  if (EVENTO_LABELS[key]) return EVENTO_LABELS[key];
  // Fallback para logs antigos
  return log.direcao_texto || "Integração";
}

const CAMPO_LABELS: Record<string, string> = {
  endereco: "endereço",
  endereco_numero: "número",
  nome_fantasia: "nome fantasia",
  cnpj_cpf: "CNPJ/CPF",
  razao_social: "razão social",
  telefone1_numero: "telefone",
  telefone: "telefone",
  cep: "CEP",
  bairro: "bairro",
  complemento: "complemento",
  cidade: "cidade",
  estado: "estado",
  contato: "contato",
  email: "e-mail",
};

function traduzCampo(c: string): string {
  return CAMPO_LABELS[c] ?? c.replace(/_/g, " ");
}

function camposEnviados(log: LogItem): string[] {
  const arr =
    (Array.isArray(log.response?.campos_enviados) && log.response?.campos_enviados) ||
    (Array.isArray(log.campos_enviados) && log.campos_enviados) ||
    [];
  return (arr as string[]).filter(Boolean);
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
          Histórico de envios
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
            Não foi possível carregar o histórico de envios.
          </div>
        ) : sortedLogs.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nenhum envio registrado para este cliente.
          </div>
        ) : (
          <ScrollArea className="h-[320px] pr-3">
            <div className="space-y-3">
              {sortedLogs.map((log, idx) => {
                const { icon: StatusIcon, badge, label } = statusConfig(log.status);
                const titulo = eventoLabel(log);
                const campos = camposEnviados(log);
                const mensagem = log.error_message || log.erro || log.detalhe || null;
                return (
                  <div key={idx} className="rounded-md border p-3 text-sm space-y-1.5">
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
                    <div className="min-w-0">
                      <div className="font-medium">{titulo}</div>
                      {campos.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {campos.map(traduzCampo).join(", ")}
                        </div>
                      )}
                    </div>
                    {mensagem && (
                      <div
                        className={
                          (log.status || "").toLowerCase() === "erro"
                            ? "rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-2 py-1.5 text-xs text-red-700 dark:text-red-400"
                            : "rounded bg-muted/60 border px-2 py-1.5 text-xs text-muted-foreground"
                        }
                      >
                        {mensagem}
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
