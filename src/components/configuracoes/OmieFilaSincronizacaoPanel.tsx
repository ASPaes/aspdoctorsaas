import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Clock, Pause, TestTube2, ExternalLink, RotateCw, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

type ReprocessarResp = {
  ok?: boolean;
  acao?: string;
  mensagem?: string;
  erro?: string;
  aviso?: string;
  revalidou?: boolean;
  motivos?: string[];
};

/**
 * Pergunta ao Omie, ANTES de reenfileirar, se a causa realmente saiu do caminho.
 *
 * Por que isto existe: o omie_fila_reprocessar revalida chamando montar_payload_contrato_omie,
 * que só enxerga o lado DS. Os três bloqueios que mais matam linha — troca_de_produto,
 * sem_depara e depara_aponta_cancelado — são decididos no ds-omie-contrato-alterar, no projeto
 * DoctorOMIE, e passavam batido. Efeito medido na DEM-0237: a linha do LANCHES PEREIRA E SILVA
 * (bloqueio:troca_de_produto) voltava para 'pendente', tomava o mesmo bloqueio ~2min depois e
 * voltava para 'invalido'. O botão parecia agir e não agia — loop manual sem fim.
 *
 * O dry_run já existia inteiro no omie-integration-call (acao criar_cliente_contrato): ele não
 * escreve nada no Omie e devolve o `bloqueado` real do momento. Só faltava alguém perguntar.
 */
async function conferirBloqueioAtual(
  contratoId: string,
  tenantId: string | null | undefined
): Promise<{ bloqueado: string | null; mensagem: string | null; precisaCriar: boolean }> {
  const ler = (b: any) => ({
    bloqueado: (b?.bloqueado as string) ?? null,
    mensagem:
      (b?.error as string) ??
      (Array.isArray(b?.erros) && b.erros.length ? b.erros.join("\n• ") : null),
    precisaCriar: b?.operacao === "criar",
  });
  try {
    const { data, error } = await supabase.functions.invoke("omie-integration-call", {
      // tenant_id é obrigatório aqui: a função resolve o tenant pelo PERFIL de quem chama e só
      // aceita outro se for super admin. Sem ele, o super admin simulando um tenant consultaria
      // a chave Omie da ASP contra um contrato que não é dela.
      body: {
        acao: "criar_cliente_contrato",
        modo: "dry_run",
        contrato_id: contratoId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
    });
    if (error) {
      // 409 (bloqueado) e 422 (validação) chegam aqui; o motivo real está no corpo.
      const corpo = await (error as any)?.context?.json?.().catch(() => null);
      if (corpo) return ler(corpo);
      // Não deu para saber: não inventa bloqueio, deixa o fluxo normal seguir.
      return { bloqueado: null, mensagem: null, precisaCriar: false };
    }
    return ler(data);
  } catch {
    return { bloqueado: null, mensagem: null, precisaCriar: false };
  }
}

function ReprocessarButton({
  filaId,
  contratoId,
  tenantId,
  onDone,
}: {
  filaId: string;
  contratoId?: string | null;
  tenantId: string | null | undefined;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    try {
      // 1) A causa saiu do caminho? Se não, não reenfileira — e diz o porquê de verdade.
      if (contratoId) {
        const chk = await conferirBloqueioAtual(contratoId, tenantId);
        if (chk.bloqueado) {
          toast.warning("Reprocessar não vai resolver: a causa continua ativa no Omie.", {
            description: chk.mensagem ?? "O Omie ainda recusa esta alteração.",
            duration: 12000,
          });
          return;
        }
        if (chk.precisaCriar) {
          toast.warning("Este contrato ainda não existe no Omie.", {
            description:
              "A fila automática nunca cria contrato — só altera o que já está vinculado. " +
              "Vincule na Conferência ou use “Enviar ao Omie” na tela do cliente.",
            duration: 12000,
          });
          return;
        }
      }

      const { data, error } = await (supabase.rpc as any)("omie_fila_reprocessar", { p_fila_id: filaId });
      if (error) {
        toast.error("Falha ao reprocessar. Tente novamente.");
        return;
      }
      const r = (data ?? {}) as ReprocessarResp;
      if (r.ok) {
        toast.success(r.mensagem ?? (r.acao === "absorvido" ? "Item absorvido em outro da fila." : "Item devolvido para a fila."));
        if (r.aviso) toast.warning(r.aviso);
        onDone();
        return;
      }
      if (r.revalidou === false) {
        const motivos = Array.isArray(r.motivos) && r.motivos.length ? r.motivos.join("\n• ") : "Sem detalhes.";
        toast.warning("A causa ainda não foi resolvida.", { description: `• ${motivos}` });
        return;
      }
      toast.error(r.erro ?? "Não foi possível reprocessar.");
    } catch {
      toast.error("Falha ao reprocessar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="secondary" className="gap-1 shrink-0" onClick={handle} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
            {loading ? "Conferindo…" : "Reprocessar"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Confere no Omie se a causa saiu do caminho e, só então, devolve o item para a fila.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type FilaItem = {
  prio?: string | number | null;
  fila_id?: string | null;
  cliente_id?: string | null;
  contrato_id?: string | null;
  cliente?: string | null;
  cnpj?: string | null;
  origem?: string | null;
  status?: string | null;
  tentativas?: number | null;
  enfileirado_em?: string | null;
  processado_em?: string | null;
  proxima_tentativa_em?: string | null;
  motivo?: string | null;
};

type OkRecente = {
  cliente?: string | null;
  origem?: string | null;
  processado_em?: string | null;
};

type Saude = {
  sync_ativo?: boolean | null;
  pausado?: boolean | null;
  modo_teste?: boolean | null;
  bloqueado_ate?: string | null;
  cron_ultima?: string | null;
  cron_saudavel?: boolean | null;
};

type FilaStatus = {
  gerado_em?: string | null;
  saude?: Saude | null;
  resumo?: Record<string, number> | null;
  itens?: FilaItem[] | null;
  ok_recentes?: OkRecente[] | null;
};

const ORIGEM_LABEL: Record<string, string> = {
  reajuste: "Reajuste",
  estorno_reajuste: "Estorno de reajuste",
  movimento_upsell: "Upsell",
  movimento_downsell: "Downsell",
  movimento_cross_sell: "Cross-sell",
  churn: "Cancelamento",
  reativacao: "Reativação",
  cadastro: "Alteração cadastral",
  // Origens que já existem em produção e vinham caindo no fallback, aparecendo cruas na tela.
  observacao: "Observação",
  manual: "Envio manual",
  movimento_reajuste: "Reajuste",
  valor: "Alteração de valor",
};

function labelOrigem(o?: string | null) {
  if (!o) return "—";
  return ORIGEM_LABEL[o] ?? o;
}

function formatCNPJ(v?: string | null): string {
  if (!v) return "";
  const d = String(v).replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v;
}

function formatDateTime(v?: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("pt-BR");
  } catch {
    return v;
  }
}

function relativeTime(v?: string | null): string {
  if (!v) return "—";
  try {
    const then = new Date(v).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const abs = Math.abs(diffMs);
    const min = Math.round(abs / 60000);
    const suffix = diffMs >= 0 ? "atrás" : "em";
    const prefix = diffMs >= 0 ? "há " : "em ";
    if (abs < 60_000) return diffMs >= 0 ? "agora mesmo" : "em instantes";
    if (min < 60) return `${prefix}${min} min${suffix === "em" ? "" : ""}`.replace("em ", "em ").trim();
    const h = Math.round(min / 60);
    if (h < 48) return diffMs >= 0 ? `há ${h}h` : `em ${h}h`;
    const d = Math.round(h / 24);
    return diffMs >= 0 ? `há ${d}d` : `em ${d}d`;
  } catch {
    return v;
  }
}

const STATUS_STYLE: Record<string, string> = {
  erro: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  ignorado: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  processando: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  pendente: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  ok: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
};

const STATUS_LABEL: Record<string, string> = {
  erro: "Erro",
  ignorado: "Ignorado",
  processando: "Processando",
  pendente: "Pendente",
  ok: "OK",
};

function StatusBadge({ status }: { status?: string | null }) {
  const s = (status || "").toLowerCase();
  const cls = STATUS_STYLE[s] ?? "bg-muted text-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {STATUS_LABEL[s] ?? status ?? "—"}
    </span>
  );
}

export default function OmieFilaSincronizacaoPanel({
  tid,
  onIrParaEscolherCandidato,
}: {
  tid: string | null | undefined;
  onIrParaEscolherCandidato?: (cnpj: string) => void;
}) {
  const [filtroStatus, setFiltroStatus] = useState<string | null>(null);
  const [okOpen, setOkOpen] = useState(false);

  const query = useQuery({
    queryKey: ["omie-fila-status", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("omie_fila_status" as any, { p_tenant_id: tid });
      if (error) throw error;
      return (data ?? {}) as FilaStatus;
    },
  });

  const data = query.data;
  const itens = data?.itens ?? [];
  const resumo = data?.resumo ?? {};
  const saude = data?.saude ?? {};
  const okRecentes = data?.ok_recentes ?? [];

  const temAtivo = useMemo(
    () => (resumo.pendente ?? 0) > 0 || (resumo.processando ?? 0) > 0,
    [resumo]
  );

  // Auto-refresh 30s enquanto houver pendente/processando
  useEffect(() => {
    if (!temAtivo) return;
    const id = setInterval(() => {
      query.refetch();
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temAtivo]);

  const itensFiltrados = useMemo(() => {
    if (!filtroStatus) return itens;
    return itens.filter((i) => (i.status || "").toLowerCase() === filtroStatus);
  }, [itens, filtroStatus]);

  // Erro de permissão / falha
  if (query.isError) {
    const msg = (query.error as any)?.message || "Falha ao carregar a fila.";
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Fila de sincronização
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{msg}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const resumoEntries = Object.entries(resumo).filter(([, v]) => Number(v) > 0);
  const orderStatus = ["erro", "ignorado", "processando", "pendente", "ok"];
  resumoEntries.sort(
    ([a], [b]) => (orderStatus.indexOf(a) === -1 ? 99 : orderStatus.indexOf(a)) - (orderStatus.indexOf(b) === -1 ? 99 : orderStatus.indexOf(b))
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Fila de sincronização
            {data?.gerado_em && (
              <span className="text-xs font-normal text-muted-foreground">
                · {formatDateTime(data.gerado_em)}
              </span>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            {/* Faixa de saúde */}
            {saude.pausado && (
              <Alert variant="destructive">
                <Pause className="h-4 w-4" />
                <AlertDescription>
                  ⏸️ Integração pausada — nada está sendo enviado ao Omie. A fila está acumulando.
                </AlertDescription>
              </Alert>
            )}
            {!saude.pausado && saude.sync_ativo === false && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  ⚠️ Sincronização automática desligada — alterações não estão sendo enfileiradas.
                </AlertDescription>
              </Alert>
            )}
            {!saude.pausado && saude.sync_ativo !== false && saude.cron_saudavel === false && (
              <Alert className="border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  ⚠️ O processador não roda desde {formatDateTime(saude.cron_ultima)} — a fila não está andando.
                </AlertDescription>
              </Alert>
            )}
            {saude.bloqueado_ate && new Date(saude.bloqueado_ate).getTime() > Date.now() && (
              <Alert className="border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
                <Clock className="h-4 w-4" />
                <AlertDescription>
                  ⏳ Omie pediu espera até {formatDateTime(saude.bloqueado_ate)}. Volta sozinho.
                </AlertDescription>
              </Alert>
            )}
            {saude.modo_teste && (
              <Alert className="border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
                <TestTube2 className="h-4 w-4" />
                <AlertDescription>
                  🧪 Modo teste: só os contratos da whitelist são processados. O resto fica na fila.
                </AlertDescription>
              </Alert>
            )}

            {/* Resumo (chips) */}
            {resumoEntries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {resumoEntries.map(([status, qtd]) => {
                  const s = status.toLowerCase();
                  const ativo = filtroStatus === s;
                  const cls = STATUS_STYLE[s] ?? "bg-muted text-foreground border-border";
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setFiltroStatus(ativo ? null : s)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${cls} ${
                        ativo ? "ring-2 ring-offset-1 ring-primary/40" : "opacity-90 hover:opacity-100"
                      }`}
                    >
                      {STATUS_LABEL[s] ?? status}
                      <span className="font-semibold">{Number(qtd).toLocaleString("pt-BR")}</span>
                    </button>
                  );
                })}
                {filtroStatus && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setFiltroStatus(null)}
                  >
                    Limpar filtro
                  </Button>
                )}
              </div>
            )}

            {/* Lista */}
            {itensFiltrados.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {filtroStatus
                  ? "Nenhum item neste status."
                  : "Nada parado. Tudo que foi alterado já está no Omie."}
              </div>
            ) : (
              <div className="space-y-2">
                {itensFiltrados.map((item, i) => {
                  const status = (item.status || "").toLowerCase();
                  const isIgnorado = status === "ignorado";
                  const canReprocess = (status === "ignorado" || status === "invalido" || status === "erro") && !!item.fila_id;
                  return (
                    <div
                      key={item.fila_id ?? i}
                      className="rounded-lg border p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{item.cliente || "—"}</span>
                          {item.cnpj && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {formatCNPJ(item.cnpj)}
                            </span>
                          )}
                          <StatusBadge status={item.status} />
                          <Badge variant="outline" className="text-[10px]">
                            {labelOrigem(item.origem)}
                          </Badge>
                          {(item.tentativas ?? 0) > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {item.tentativas} tentativa{(item.tentativas ?? 0) > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        {item.motivo && (
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                            {item.motivo}
                          </p>
                        )}
                        <div className="text-[11px] text-muted-foreground">
                          Enfileirado {relativeTime(item.enfileirado_em)}
                          {item.proxima_tentativa_em && (
                            <> · Próxima tentativa {relativeTime(item.proxima_tentativa_em)}</>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {isIgnorado && item.cnpj && onIrParaEscolherCandidato && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => onIrParaEscolherCandidato(item.cnpj as string)}
                          >
                            <ExternalLink className="h-3 w-3" />
                            Resolver na Conferência
                          </Button>
                        )}
                        {canReprocess && (
                          <ReprocessarButton
                            filaId={item.fila_id as string}
                            contratoId={item.contrato_id}
                            tenantId={tid}
                            onDone={() => query.refetch()}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* OK recentes */}
            {okRecentes.length > 0 && (
              <Collapsible open={okOpen} onOpenChange={setOkOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {okOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Últimas sincronizações ({okRecentes.length})
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="rounded-lg border divide-y">
                    {okRecentes.map((r, i) => (
                      <div
                        key={i}
                        className="px-3 py-2 text-xs flex items-center justify-between gap-2 flex-wrap"
                      >
                        <span className="font-medium truncate">{r.cliente || "—"}</span>
                        <span className="text-muted-foreground">
                          {labelOrigem(r.origem)} · {relativeTime(r.processado_em)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
