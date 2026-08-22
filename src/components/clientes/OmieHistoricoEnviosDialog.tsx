import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOmieContaDoCliente } from "@/hooks/useOmieContaDoCliente";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle,
  AlertCircle,
  Ban,
  FileText,
  History,
  Clock,
  Link2,
  AlertTriangle,
} from "lucide-react";

interface Props {
  clienteId: string;
}

interface LogResponse {
  campos_enviados?: string[] | null;
  acao?: string | null;
  bloqueado?: string | null;
  omie_contract_id?: string | number | null;
  omie_contract_id_anterior?: string | number | null;
  omie_customer_id?: string | number | null;
  mrr?: number | null;
  modelo_contrato?: string | null;
  [k: string]: any;
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
  response?: LogResponse | null;
  campos_enviados?: string[] | null;
  payload?: Record<string, any> | null;
}

interface OmieDadosLog {
  contratoIds: string[];
  codigoClienteOmie: string | number | null;
  codigosContratoOmie: (string | number)[];
}

type FiltroTipo = "todos" | "enviados" | "nao_enviados" | "falhas" | "vinculos";

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

const VINCULO_LABELS: Record<string, string> = {
  vinculo_criado: "Contrato vinculado ao Omie",
  vinculo_reconfirmado: "Vínculo reconfirmado",
  vinculo_trocado: "⚠️ Vínculo TROCADO",
};

const BLOQUEIO_LABELS: Record<string, string> = {
  documento_invalido: "Não enviado — CPF/CNPJ inválido",
  data_ativacao: "Não enviado — contrato anterior à data de ativação",
  sem_modelo: "Não enviado — contrato sem modelo",
  modelo_nao_permitido: "Não enviado — modelo não habilitado",
  sem_modelos_permitidos: "Não enviado — nenhum modelo permitido",
  integracao_pausada: "Não enviado — integração pausada",
  falha_vinculo_previo: "Falhou — não deu para criar o de/para",
  colisao_no_lote: "Vínculo recusado — conflito",
  colisao_com_existente: "Vínculo recusado — conflito",
};

function eventoLabel(log: LogItem): string {
  const ev = (log.evento || "").toLowerCase();
  const en = (log.entidade || "").toLowerCase();
  if (ev === "testar") return "Teste de conexão";
  if (ev === "vincular") {
    const acao = (log.response?.acao || "").toLowerCase();
    return VINCULO_LABELS[acao] || "Vínculo atualizado";
  }
  const key = `${ev}|${en}`;
  if (EVENTO_LABELS[key]) return EVENTO_LABELS[key];
  // Bloqueio: se status ignorado com response.bloqueado
  if ((log.status || "").toLowerCase() === "ignorado" && log.response?.bloqueado) {
    return BLOQUEIO_LABELS[log.response.bloqueado] || "Não enviado";
  }
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

const brl = (v: any) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));

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

function VinculoDetalhe({ log }: { log: LogItem }) {
  const r = log.response || {};
  const acao = (r.acao || "").toLowerCase();
  const omieId = r.omie_contract_id;
  const omieAnterior = r.omie_contract_id_anterior;

  if (acao === "vinculo_trocado") {
    return (
      <div className="rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          antes apontava para <strong className="font-mono">{String(omieAnterior ?? "—")}</strong>,
          agora aponta para <strong className="font-mono">{String(omieId ?? "—")}</strong>
        </span>
      </div>
    );
  }

  const parts: string[] = [];
  if (omieId != null) parts.push(`Omie ${omieId}`);
  if (r.mrr != null) parts.push(brl(r.mrr));
  if (r.modelo_contrato) parts.push(String(r.modelo_contrato));
  if (parts.length === 0) return null;
  return (
    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
      <Link2 className="h-3 w-3" />
      {parts.join(" · ")}
    </div>
  );
}

/**
 * O histórico de envios ao Omie, em modal.
 *
 * Era o terceiro card empilhado na ficha do cliente ("Histórico de envios"), com 320px de lista
 * aberta o tempo todo. Virou um botão no cabeçalho do card "Integração": a ficha ficou legível e a
 * `omie-integration-call` só é chamada quando alguém abre o histórico, em vez de a cada abertura
 * de ficha de cliente de tenant com Omie.
 */
function HistoricoConteudo({ clienteId, aberto }: Props & { aberto: boolean }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [filtro, setFiltro] = useState<FiltroTipo>("todos");

  // A conta Omie vem da UNIDADE DO CLIENTE, não do tenant: com duas contas, o .maybeSingle()
  // por tenant erra ("multiple rows returned"), a query falha e o histórico some da tela.
  const contaOmieQuery = useOmieContaDoCliente(clienteId);
  const omieAtivo = contaOmieQuery.data?.ativo === true;

  const dadosQuery = useQuery<OmieDadosLog>({
    queryKey: ["cliente-omie-dados-log", tid, clienteId],
    enabled: aberto && !!tid && !!clienteId && omieAtivo,
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
    enabled: aberto && !!tid && !!clienteId && omieAtivo && !!dadosQuery.data,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: {
          acao: "listar_log",
          tenant_id: tid,
          // Conta Omie sai do cliente (cliente -> unidade -> conta). Ver resolverConta v16.
          cliente_id: clienteId,
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

  const logs = logsQuery.data ?? [];
  const sortedLogs = useMemo(
    () =>
      [...logs].sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime()),
    [logs]
  );

  const filteredLogs = useMemo(() => {
    return sortedLogs.filter((l) => {
      const s = (l.status || "").toLowerCase();
      const ev = (l.evento || "").toLowerCase();
      switch (filtro) {
        case "enviados":
          return s === "sucesso" && ev !== "vincular";
        case "nao_enviados":
          return s === "ignorado";
        case "falhas":
          return s === "erro";
        case "vinculos":
          return ev === "vincular";
        default:
          return true;
      }
    });
  }, [sortedLogs, filtro]);

  return (
    <>
      <div className="flex shrink-0 items-center justify-end">
        {sortedLogs.length > 0 && (
          <Select value={filtro} onValueChange={(v) => setFiltro(v as FiltroTipo)}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Tudo</SelectItem>
              <SelectItem value="enviados">Enviados</SelectItem>
              <SelectItem value="nao_enviados">Não enviados</SelectItem>
              <SelectItem value="falhas">Falhas</SelectItem>
              <SelectItem value="vinculos">Vínculos</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
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
        ) : filteredLogs.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nenhum registro neste filtro.
          </div>
        ) : (
          <ScrollArea className="h-full pr-3">
            <div className="space-y-3">
              {filteredLogs.map((log, idx) => {
                const { icon: StatusIcon, badge, label } = statusConfig(log.status);
                const titulo = eventoLabel(log);
                const campos = camposEnviados(log);
                const mensagem = log.error_message || log.erro || log.detalhe || null;
                const isVinculo = (log.evento || "").toLowerCase() === "vincular";
                const isTrocado =
                  isVinculo && (log.response?.acao || "").toLowerCase() === "vinculo_trocado";
                return (
                  <div
                    key={idx}
                    className={
                      "rounded-md border p-3 text-sm space-y-1.5 " +
                      (isTrocado
                        ? "border-amber-400 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20"
                        : "")
                    }
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
                    <div className="min-w-0">
                      <div className="font-medium">{titulo}</div>
                      {campos.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {campos.map(traduzCampo).join(", ")}
                        </div>
                      )}
                      {isVinculo && <VinculoDetalhe log={log} />}
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
      </div>
    </>
  );
}

/**
 * O botão que abre o histórico. Some junto com a integração: sem conta Omie que atenda este
 * cliente não há o que listar.
 */
export default function OmieHistoricoEnviosButton({ clienteId }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [aberto, setAberto] = useState(false);
  const contaOmieQuery = useOmieContaDoCliente(clienteId);

  if (!tid || contaOmieQuery.data?.ativo !== true) return null;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setAberto(true)}>
        <History className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">Histórico de envios</span>
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        {/*
          O DialogContent do projeto é `overflow-y-auto` com teto de altura. Com a lista dentro
          dele, o modal inteiro virava um segundo rolável — e, como o Radix leva o foco para o
          primeiro campo ao abrir (o filtro), o navegador rolava até lá e o título sumia para fora
          da tela. Aqui o modal não rola: ele é uma coluna com teto de altura e só a lista rola.
          O foco fica no próprio diálogo (Esc e Tab seguem funcionando) em vez de no filtro.
        */}
        <DialogContent
          className="max-w-2xl max-h-[85dvh] flex flex-col overflow-hidden"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Histórico de envios
            </DialogTitle>
          </DialogHeader>
          {/* Montado só com o modal aberto: assim as consultas nascem junto com ele e o estado do
              filtro volta ao padrão a cada abertura. */}
          {aberto && <HistoricoConteudo clienteId={clienteId} aberto={aberto} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
