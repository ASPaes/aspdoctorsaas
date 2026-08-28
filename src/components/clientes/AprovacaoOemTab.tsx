import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAprovacaoOemStatus } from "@/hooks/useAprovacaoOem";
import { useLinhaDestacada, CLASSE_DESTAQUE } from "@/hooks/useDeepLinkIntegracao";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Clock, Loader2, RefreshCw, ShieldCheck, X,
} from "lucide-react";
import { toast } from "sonner";

type Pedido = {
  id: string;
  acao: "ativar" | "quantidade" | "cancelar" | string;
  status: string;
  situacao: "aguardando" | "aprovado" | "recusado";
  cliente_id: string | null;
  cliente: string | null;
  unidade_base_id: number | null;
  unidade: string | null;
  produto: string | null;
  modulo: string | null;
  quantidade: number | null;
  quantidade_atual: number | null;
  quantidade_cancelar: number | null;
  vlr_mensal: number | null;
  vlr_custo: number | null;
  vlr_ativacao: number | null;
  valor_downsell: number | null;
  motivo: string | null;
  pedido_por: string | null;
  enfileirado_em: string;
  decidido_por: string | null;
  decidido_em: string | null;
  motivo_recusa: string | null;
  ultimo_erro: string | null;
};

const fmtBRL = (v: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);

const dataHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const ACAO_LABEL: Record<string, string> = {
  ativar: "Adicionar módulo",
  quantidade: "Alterar quantidade",
  cancelar: "Cancelar módulo",
};

/**
 * O que acontece se este pedido for aprovado, em uma frase.
 *
 * É o mesmo texto do aviso no sino, de propósito: quem clica na notificação e
 * chega aqui tem que ler a mesma coisa, senão fica em dúvida sobre qual das
 * duas telas está certa.
 */
function efeito(p: Pedido): string {
  if (p.acao === "ativar") {
    const qtd = Math.max(Number(p.quantidade) || 1, 1);
    const base = qtd > 1 ? `Ativa ${qtd} unidades na licença` : "Ativa o módulo na licença";
    const mrr = Number(p.vlr_mensal) > 0
      ? ` e soma ${fmtBRL((Number(p.vlr_mensal) || 0) * qtd)}/mês no MRR`
      : " (sem valor mensal: não mexe no MRR)";
    const at = Number(p.vlr_ativacao) > 0 ? `, com ${fmtBRL(p.vlr_ativacao)} de ativação` : "";
    return base + mrr + at;
  }
  if (p.acao === "quantidade") {
    const de = p.quantidade_atual ?? 0;
    const para = p.quantidade ?? 0;
    const delta = Number(para) - Number(de);
    const mrr = Number(p.vlr_mensal) > 0 && delta > 0
      ? `, somando ${fmtBRL((Number(p.vlr_mensal) || 0) * delta)}/mês no MRR`
      : "";
    const at = Number(p.vlr_ativacao) > 0 ? `, com ${fmtBRL(p.vlr_ativacao)} de ativação` : "";
    return `Muda a quantidade na licença de ${de} para ${para}${mrr}${at}`;
  }
  if (p.acao === "cancelar") {
    const saem = Number(p.quantidade_cancelar) || 1;
    const sobram = Number(p.quantidade) || 0;
    const resto = sobram > 0 ? `sobram ${sobram} na licença` : "zera o módulo na licença";
    const mrr = Number(p.valor_downsell) > 0
      ? `e tira ${fmtBRL(p.valor_downsell)}/mês do MRR`
      : "e NÃO mexe no MRR (baixa informada: zero)";
    return `Dá baixa de ${saem} ${saem > 1 ? "unidades" : "unidade"} (${resto}) ${mrr}`;
  }
  return "Aplica a alteração no parceiro";
}

export default function AprovacaoOemTab() {
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeIds, viewKey, unidadeFilterReady } = useUnidadeFilter();

  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [agindo, setAgindo] = useState(false);
  const [recusaAberta, setRecusaAberta] = useState(false);
  const [motivoRecusa, setMotivoRecusa] = useState("");
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const statusQ = useAprovacaoOemStatus(true);

  const listaQ = useQuery<Pedido[]>({
    queryKey: ["oem-aprovacao-lista", tid, viewKey],
    enabled: !!tid && unidadeFilterReady,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_aprovacao_listar", {
        p_tenant_id: tid,
        p_unidades: selectedUnidadeIds.length ? selectedUnidadeIds : null,
        p_limite: 200,
        p_historico: 30,
      });
      if (error) throw error;
      return (data ?? []) as Pedido[];
    },
  });

  const itens = listaQ.data ?? [];
  const aguardando = useMemo(() => itens.filter((i) => i.situacao === "aguardando"), [itens]);
  const decididos = useMemo(() => itens.filter((i) => i.situacao !== "aguardando"), [itens]);

  // Linha apontada pela notificação (?fila=<id>).
  const { destacarId, refDestaque } = useLinhaDestacada(!listaQ.isLoading);
  const destacada = destacarId ? itens.find((i) => i.id === destacarId) : undefined;
  // Já decidida: quem clicou no aviso precisa saber disso, não procurar numa lista.
  const destacadaJaDecidida = !!destacada && destacada.situacao !== "aguardando";

  const atualizar = () => {
    statusQ.refetch();
    listaQ.refetch();
  };

  const invalidarTudo = () => {
    qc.invalidateQueries({ queryKey: ["oem-aprovacao-lista"] });
    qc.invalidateQueries({ queryKey: ["oem-aprovacao-status"] });
    // A ficha do cliente mostra o selo "aguardando aprovação" na linha do módulo.
    qc.invalidateQueries({ queryKey: ["oem_pendencias_cliente"] });
  };

  // Só o que está na tela pode ser marcado: manter marcação de linha que já
  // saiu da lista faria o botão prometer um número que não existe mais.
  const marcadosVisiveis = useMemo(
    () => aguardando.filter((i) => marcados.has(i.id)).map((i) => i.id),
    [aguardando, marcados],
  );
  const todosMarcados = aguardando.length > 0 && marcadosVisiveis.length === aguardando.length;

  const alternar = (id: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const alternarTodos = () =>
    setMarcados(todosMarcados ? new Set() : new Set(aguardando.map((i) => i.id)));

  /**
   * Pede o envio ao parceiro logo depois de aprovar, em vez de deixar o cron de
   * 2 em 2 minutos levar: quem aprovou está com a tela aberta esperando aquilo
   * acontecer.
   *
   * A `fn_oem_fila_claim` reivindica 20 linhas por chamada, então um lote maior
   * precisa de mais de uma volta. Para quando não sobrar nada, e tem um teto
   * para não virar laço infinito se o processador devolver sempre o mesmo.
   */
  async function processarAgora(quantas: number) {
    let ok = 0, erros = 0;
    const voltas = Math.min(Math.ceil(quantas / 20) + 1, 10);
    for (let i = 0; i < voltas; i++) {
      const { data } = await supabase.functions.invoke("oem-sync-processar", { body: {} });
      const r = (data ?? {}) as { processadas?: number; ok_count?: number; erros?: number };
      ok += r.ok_count ?? 0;
      erros += r.erros ?? 0;
      if (!r.processadas) break;
    }
    return { ok, erros };
  }

  async function aprovar() {
    const ids = marcadosVisiveis;
    if (!ids.length) return;
    setAgindo(true);
    try {
      const { data, error } = await (supabase.rpc as any)("fn_oem_aprovacao_aprovar", { p_ids: ids });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { aprovadas?: number; ignoradas?: number };
      const aprovadas = r.aprovadas ?? 0;

      if (!aprovadas) {
        toast.warning("Nada foi aprovado", {
          description: "Estes pedidos já tinham sido decididos por outra pessoa.",
        });
        setMarcados(new Set());
        invalidarTudo();
        return;
      }

      const { ok, erros } = await processarAgora(aprovadas);

      if (erros > 0) {
        toast.warning(`${aprovadas} aprovado(s), ${erros} não foi(ram) ao OEM`, {
          description:
            "O que falhou ficou na fila com o motivo, em Configurações › Integrações › OEM › Sincronização. O cron tenta de novo sozinho.",
        });
      } else if (ok > 0) {
        toast.success(`${ok} aplicado(s) no OEM e na ficha`);
      } else {
        toast.success(`${aprovadas} aprovado(s)`, {
          description: "Enviado ao OEM. A ficha muda quando o parceiro confirmar.",
        });
      }
      if (r.ignoradas) {
        toast.info(`${r.ignoradas} pedido(s) já tinham sido decididos e ficaram de fora.`);
      }
      setMarcados(new Set());
      invalidarTudo();
    } catch (e: any) {
      toast.error("Não deu para aprovar", { description: e?.message });
    } finally {
      setAgindo(false);
    }
  }

  async function recusar() {
    const ids = marcadosVisiveis;
    if (!ids.length) return;
    setAgindo(true);
    try {
      const { data, error } = await (supabase.rpc as any)("fn_oem_aprovacao_recusar", {
        p_ids: ids,
        p_motivo: motivoRecusa.trim(),
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { recusadas?: number; ignoradas?: number };
      toast.success(`${r.recusadas ?? 0} pedido(s) recusado(s)`, {
        description: "Nada foi enviado ao OEM e nada entrou na ficha. O motivo fica no histórico.",
      });
      setRecusaAberta(false);
      setMotivoRecusa("");
      setMarcados(new Set());
      invalidarTudo();
    } catch (e: any) {
      toast.error("Não deu para recusar", { description: e?.message });
    } finally {
      setAgindo(false);
    }
  }

  const n = marcadosVisiveis.length;
  const geradoEm = statusQ.dataUpdatedAt || listaQ.dataUpdatedAt;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Aprovação OEM
            {geradoEm > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                · {new Date(geradoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </span>
            )}
          </CardTitle>
          <Button
            size="sm" variant="outline" className="gap-1"
            onClick={atualizar}
            disabled={statusQ.isFetching || listaQ.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${statusQ.isFetching || listaQ.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Adição, alteração de quantidade e cancelamento de módulo de cliente com licença no OEM
          esperam aqui. Enquanto não for aprovado, nada foi enviado ao parceiro e nada entrou na
          ficha do cliente.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {listaQ.isLoading ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            {/* Clique de notificação que caiu numa linha já resolvida. Dizer isso
                é melhor que deixar a pessoa procurando o que já saiu da fila. */}
            {destacarId && (!destacada || destacadaJaDecidida) && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {destacadaJaDecidida
                    ? `O pedido apontado pelo aviso já foi ${destacada!.situacao}. Ele está no histórico, abaixo.`
                    : "O pedido apontado pelo aviso não está mais aqui."}
                </AlertDescription>
              </Alert>
            )}

            {/* Barra de ação em lote. Só aparece com algo marcado: botão que não
                faz nada ocupando a tela ensina a ignorar botão. */}
            {n > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
                <span className="text-sm">
                  <strong>{n}</strong> {n > 1 ? "pedidos marcados" : "pedido marcado"}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm" variant="outline" className="gap-1.5"
                    onClick={() => setRecusaAberta(true)}
                    disabled={agindo}
                  >
                    <X className="h-3.5 w-3.5" />
                    Recusar ({n})
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={aprovar} disabled={agindo}>
                    {agindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Aprovar ({n})
                  </Button>
                </div>
              </div>
            )}

            {aguardando.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nenhum pedido esperando aprovação.
              </div>
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
                  <Checkbox checked={todosMarcados} onCheckedChange={alternarTodos} />
                  Marcar todos ({aguardando.length})
                </label>

                <div className="space-y-2">
                  {aguardando.map((p) => (
                    <div
                      key={p.id}
                      ref={p.id === destacarId ? (refDestaque as any) : undefined}
                      className={`flex gap-3 rounded-lg border p-3 ${p.id === destacarId ? CLASSE_DESTAQUE : ""}`}
                    >
                      <Checkbox
                        className="mt-1 shrink-0"
                        checked={marcados.has(p.id)}
                        onCheckedChange={() => alternar(p.id)}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{p.cliente ?? "—"}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {ACAO_LABEL[p.acao] ?? p.acao}
                          </Badge>
                          {p.unidade && (
                            <span className="text-[11px] text-muted-foreground">{p.unidade}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.modulo ?? "Módulo"}
                          {p.produto ? ` · ${p.produto}` : ""}
                        </div>
                        <div className="text-xs">{efeito(p)}</div>
                        {p.motivo && (
                          <div className="text-xs text-muted-foreground">Motivo: {p.motivo}</div>
                        )}
                        <div className="text-[11px] text-muted-foreground">
                          Pedido por {p.pedido_por ?? "—"} em {dataHora(p.enfileirado_em)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {decididos.length > 0 && (
              <Collapsible open={historicoAberto} onOpenChange={setHistoricoAberto}>
                <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  {historicoAberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Já decididos ({decididos.length})
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-1">
                  {decididos.map((p) => (
                    <div
                      key={p.id}
                      ref={p.id === destacarId ? (refDestaque as any) : undefined}
                      className={`rounded border px-3 py-2 text-xs ${p.id === destacarId ? CLASSE_DESTAQUE : ""}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{p.cliente ?? "—"}</span>
                        <span className="text-muted-foreground">
                          {ACAO_LABEL[p.acao] ?? p.acao}
                          {p.modulo ? ` · ${p.modulo}` : ""}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            p.situacao === "recusado"
                              ? "border-destructive/40 text-destructive"
                              : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {p.situacao === "recusado" ? "Recusado" : "Aprovado"}
                        </Badge>
                        <span className="ml-auto text-muted-foreground">
                          {p.decidido_por ?? "—"} · {dataHora(p.decidido_em)}
                        </span>
                      </div>
                      {p.situacao === "recusado" && p.motivo_recusa && (
                        <div className="mt-1 text-muted-foreground">Motivo: {p.motivo_recusa}</div>
                      )}
                      {/* Aprovado aqui e recusado LÁ são coisas diferentes, e a
                          tela não pode juntar as duas: o admin autorizou, quem
                          disse não foi o parceiro. */}
                      {p.situacao === "aprovado" && p.ultimo_erro && (
                        <div className="mt-1 flex items-start gap-1 text-destructive">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>O OEM não aceitou: {p.ultimo_erro}</span>
                        </div>
                      )}
                      {p.situacao === "aprovado" && !p.ultimo_erro && p.status !== "ok" && (
                        <div className="mt-1 flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Aguardando o parceiro
                        </div>
                      )}
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={recusaAberta} onOpenChange={(o) => !o && setRecusaAberta(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recusar {n} {n > 1 ? "pedidos" : "pedido"}</DialogTitle>
            <DialogDescription>
              Nada será enviado ao OEM e nada entra na ficha do cliente. O pedido pode ser refeito
              depois de corrigido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Motivo *</label>
            <Textarea
              rows={3}
              maxLength={500}
              autoFocus
              placeholder="Ex.: valor mensal não confere com o contrato"
              value={motivoRecusa}
              onChange={(e) => setMotivoRecusa(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Fica no histórico, junto com quem recusou e quando. É por ele que quem pediu descobre
              o que corrigir.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRecusaAberta(false)} disabled={agindo}>
              Voltar
            </Button>
            <Button
              variant="destructive" className="gap-1.5"
              onClick={recusar}
              disabled={agindo || !motivoRecusa.trim()}
            >
              {agindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              Recusar ({n})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
