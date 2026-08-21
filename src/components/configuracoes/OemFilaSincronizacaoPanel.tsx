import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ChevronDown, ChevronRight, Clock, RefreshCw, RotateCw, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

type Item = {
  id: string;
  acao: string;
  status: string;
  tentativas: number;
  ultimo_erro: string | null;
  http: number | null;
  quantidade: number | null;
  oem_modulo_codigo: number | null;
  empresa_codigo: string | null;
  filial_codigo: string | null;
  enfileirado_em: string;
  processado_em: string | null;
  proxima_tentativa_em: string | null;
  cliente: string | null;
  produto: string | null;
  modulo: string | null;
};

type Status = {
  pendentes: number; erros: number; invalidos: number; ok: number;
  cron_ultima: string | null; cron_saudavel: boolean | null;
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Na fila", processando: "Enviando", ok: "OK",
  erro: "Vai tentar de novo", invalido: "Parado", ignorado: "Ignorado",
};

const STATUS_STYLE: Record<string, string> = {
  pendente: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
  processando: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
  ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  erro: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  invalido: "bg-destructive/10 text-destructive border-destructive/30",
  ignorado: "bg-muted text-muted-foreground border-border",
};

const ACAO_LABEL: Record<string, string> = {
  ativar: "Ativar módulo", quantidade: "Alterar quantidade", cancelar: "Cancelar módulo",
};

const dataHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }) : "—";

export default function OemFilaSincronizacaoPanel() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [filtro, setFiltro] = useState<string | null>(null);
  const [abertoOk, setAbertoOk] = useState(false);
  const [reprocessando, setReprocessando] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  const statusQ = useQuery<Status>({
    queryKey: ["oem-fila-status", tid],
    // A fila anda de 2 em 2 minutos; olhar a cada 30s é o suficiente para a tela
    // parecer viva sem transformar o painel em fonte de carga.
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_fila_status", {
        p_tenant_id: tid ?? null,
      });
      if (error) throw error;
      return (data ?? {}) as Status;
    },
  });

  const listaQ = useQuery<Item[]>({
    queryKey: ["oem-fila-lista", tid],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_fila_listar", {
        p_tenant_id: tid ?? null, p_limite: 200,
      });
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  const atualizar = () => { statusQ.refetch(); listaQ.refetch(); };

  const itens = listaQ.data ?? [];
  // 'ok' é histórico: mostrar junto com o que precisa de atenção esconderia o
  // que importa atrás de centenas de linhas que deram certo.
  const paraTratar = itens.filter(i => i.status !== "ok");
  const okRecentes = itens.filter(i => i.status === "ok").slice(0, 20);
  const visiveis = filtro ? paraTratar.filter(i => i.status === filtro) : paraTratar;

  const s = statusQ.data;
  const chips: [string, number][] = s
    ? ([["invalido", s.invalidos], ["erro", s.erros], ["pendente", s.pendentes], ["ok", s.ok]] as [string, number][])
        .filter(([, n]) => Number(n) > 0)
    : [];

  async function reprocessar(id: string) {
    setReprocessando(id);
    try {
      const { data, error } = await (supabase.rpc as any)("fn_oem_fila_reprocessar", { p_id: id });
      if (error) throw error;
      const r = (data ?? {}) as { ok?: boolean; mensagem?: string };
      if (r.ok === false) { toast.warning(r.mensagem ?? "Nada a fazer."); return; }
      toast.success(r.mensagem ?? "Linha devolvida para a fila.");
      // Devolver para a fila e esperar 2 minutos seria o mesmo botão que não
      // age; pede o processamento na hora.
      await supabase.functions.invoke("oem-sync-processar", { body: {} }).catch(() => null);
      atualizar();
    } catch (e: any) {
      toast.error(e?.message ?? "Não deu para reprocessar.");
    } finally {
      setReprocessando(null);
    }
  }

  async function processarAgora() {
    setRodando(true);
    try {
      const { data, error } = await supabase.functions.invoke("oem-sync-processar", { body: {} });
      if (error) throw error;
      const r = (data ?? {}) as { processadas?: number; ok_count?: number; erros?: number };
      toast.success(
        r.processadas
          ? `${r.processadas} linha(s): ${r.ok_count ?? 0} no OEM, ${r.erros ?? 0} com erro.`
          : "Nada pendente na fila.",
      );
      atualizar();
    } catch (e: any) {
      toast.error(e?.message ?? "Não deu para rodar o processador.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Fila de sincronização
            <span className="text-xs font-normal text-muted-foreground">
              · roda de 2 em 2 minutos
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={processarAgora} disabled={rodando}>
              {rodando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Processar agora
            </Button>
            <Button
              size="sm" variant="outline" className="gap-1"
              onClick={atualizar}
              disabled={statusQ.isFetching || listaQ.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${statusQ.isFetching || listaQ.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {listaQ.isLoading ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            {/* O silêncio do processador é pior que o erro: sem este aviso, uma
                fila parada parece uma fila vazia. */}
            {s?.cron_saudavel === false && (
              <Alert className="border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  O processador não roda desde {dataHora(s.cron_ultima)} — a fila não está andando.
                </AlertDescription>
              </Alert>
            )}

            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chips.map(([st, qtd]) => {
                  const ativo = filtro === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setFiltro(ativo ? null : st)}
                      disabled={st === "ok"}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                        STATUS_STYLE[st] ?? "bg-muted text-foreground border-border"
                      } ${ativo ? "ring-2 ring-offset-1 ring-primary/40" : "opacity-90 hover:opacity-100"} ${
                        st === "ok" ? "cursor-default" : ""
                      }`}
                    >
                      {STATUS_LABEL[st] ?? st}
                      <span className="font-semibold">{Number(qtd).toLocaleString("pt-BR")}</span>
                    </button>
                  );
                })}
                {filtro && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setFiltro(null)}>
                    Limpar filtro
                  </Button>
                )}
              </div>
            )}

            {visiveis.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {filtro ? "Nenhum item neste status." : "Nada parado. Tudo que foi alterado já está no OEM."}
              </div>
            ) : (
              <div className="space-y-2">
                {visiveis.map((i) => (
                  <div key={i.id} className="rounded-lg border p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{i.cliente ?? "—"}</span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
                          STATUS_STYLE[i.status] ?? "bg-muted text-foreground border-border"
                        }`}>
                          {STATUS_LABEL[i.status] ?? i.status}
                        </span>
                        {i.tentativas > 1 && (
                          <span className="text-[11px] text-muted-foreground">
                            {i.tentativas} tentativas
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {ACAO_LABEL[i.acao] ?? i.acao}
                        {i.modulo ? ` · ${i.modulo}` : ""}
                        {i.quantidade != null ? ` · para ${i.quantidade}` : ""}
                        {i.produto ? ` · ${i.produto}` : ""}
                        {i.filial_codigo ? ` · OEM ${i.empresa_codigo ?? "?"}·${i.filial_codigo}` : ""}
                      </div>
                      {i.ultimo_erro && (
                        <div className="text-xs text-destructive break-words">
                          {i.ultimo_erro}
                          {i.http ? ` (HTTP ${i.http})` : ""}
                        </div>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        Enfileirado {dataHora(i.enfileirado_em)}
                        {i.status === "erro" && i.proxima_tentativa_em
                          ? ` · próxima tentativa ${dataHora(i.proxima_tentativa_em)}`
                          : ""}
                      </div>
                    </div>
                    {(i.status === "erro" || i.status === "invalido") && (
                      <Button
                        size="sm" variant="outline" className="gap-1 shrink-0"
                        onClick={() => reprocessar(i.id)}
                        disabled={reprocessando === i.id}
                      >
                        {reprocessando === i.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <RotateCw className="h-3.5 w-3.5" />}
                        Tentar de novo
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {okRecentes.length > 0 && (
              <Collapsible open={abertoOk} onOpenChange={setAbertoOk}>
                <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  {abertoOk ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Últimas sincronizações ({okRecentes.length})
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-1">
                  {okRecentes.map((i) => (
                    <div key={i.id} className="rounded border px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                      <span className="font-medium">{i.cliente ?? "—"}</span>
                      <span className="text-muted-foreground">
                        {ACAO_LABEL[i.acao] ?? i.acao}{i.modulo ? ` · ${i.modulo}` : ""}
                      </span>
                      <span className="ml-auto text-muted-foreground">{dataHora(i.processado_em)}</span>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
