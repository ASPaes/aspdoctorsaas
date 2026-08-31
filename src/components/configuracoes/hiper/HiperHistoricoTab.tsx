import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronRight, Loader2, Undo2 } from "lucide-react";
import { Explica, Vazio, brl, num } from "./ui";

/**
 * A trilha do que a integração escreveu no cadastro.
 *
 * Este módulo muda dado de cliente a partir do que um portal externo diz. Sem
 * saber quem mudou, quando e qual era o valor antes, um erro de análise vira um
 * número trocado que ninguém consegue explicar nem voltar.
 *
 * O agrupamento é por LOTE — o que saiu de um clique volta junto, do jeito que
 * foi feito. Desfazer não apaga a trilha: grava a volta e marca a linha.
 */
const ROTULO: Record<string, string> = {
  tipo_contrato: "Tipo de contrato",
  custo: "Custo",
  mrr: "Mensalidade",
  razao_social: "Razão social",
  modulos: "Módulo",
};

const valor = (v: any, acao: string) => {
  if (v === null || v === undefined) return "—";
  if (acao === "modulos" && typeof v === "object") {
    return `${brl(v.vlr_custo)}${v.quantidade > 1 ? ` · ${v.quantidade}×` : ""}`;
  }
  if (acao === "custo" || acao === "mrr") return brl(Number(v));
  return String(v);
};

export default function HiperHistoricoTab({ tid, log }: { tid: string | null; log: any[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<any | null>(null);

  const lotes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const m = new Map<string, any>();
    for (const l of log) {
      const g = m.get(l.lote_id) ?? {
        lote_id: l.lote_id, feito_em: l.feito_em, feito_por: l.feito_por,
        linhas: [] as any[], clientes: new Set<string>(), revertidos: 0,
      };
      g.linhas.push(l);
      if (l.cliente_id) g.clientes.add(l.cliente_id);
      if (l.revertido_em) g.revertidos++;
      if (l.feito_em > g.feito_em) g.feito_em = l.feito_em;
      m.set(l.lote_id, g);
    }
    return Array.from(m.values())
      .filter((g) => !q || g.linhas.some((l: any) =>
        String(l.cliente_nome ?? "").toLowerCase().includes(q)
        || String(l.codigo_sequencial ?? "") === q))
      .sort((a, b) => (a.feito_em < b.feito_em ? 1 : -1));
  }, [log, busca]);

  const desfazer = async () => {
    if (!confirmar) return;
    setDesfazendo(confirmar.lote_id);
    try {
      const { data, error } = await supabase.rpc("hiper_reverter_lote" as any, {
        p_tenant_id: tid, p_lote_id: confirmar.lote_id,
      } as any);
      if (error) throw error;
      const r = data as any;
      if (!r?.ok) throw new Error(r?.erro || "Não foi possível desfazer.");
      setConfirmar(null);
      const falhas = (r.falhas ?? []) as any[];
      toast({
        title: `${num(r.revertidos)} ${r.revertidos === 1 ? "alteração desfeita" : "alterações desfeitas"}`,
        description: falhas.length ? `${falhas.length} não voltaram: ${falhas[0].motivo}` : undefined,
        variant: falhas.length ? "destructive" : undefined,
      });
      ["hiper_log", "hiper_recon"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      toast({ title: "Não foi possível desfazer", description: e.message, variant: "destructive" });
    } finally { setDesfazendo(null); }
  };

  return (
    <div className="space-y-3">
      <Explica>
        Tudo o que a integração gravou no cadastro, agrupado por clique. Cada linha guarda o
        <strong> valor que estava lá antes</strong> — é ele que permite voltar. Desfazer não apaga
        o histórico: grava a volta e marca o que foi revertido.
      </Explica>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Código do cadastro ou nome do cliente…" value={busca}
          onChange={(e) => setBusca(e.target.value)} className="max-w-sm" />
        <span className="text-sm text-muted-foreground ml-auto">
          {num(lotes.length)} {lotes.length === 1 ? "aplicação" : "aplicações"}
        </span>
      </div>

      {lotes.length === 0 ? (
        <Vazio>
          {log.length === 0
            ? "Nada foi gravado no cadastro por esta integração ainda."
            : "Nenhuma aplicação com esse filtro."}
        </Vazio>
      ) : (
        <div className="rounded-lg border divide-y">
          {lotes.map((g) => {
            const abertoAqui = aberto === g.lote_id;
            const tudoRevertido = g.revertidos === g.linhas.length;
            return (
              <div key={g.lote_id}>
                <button type="button" onClick={() => setAberto(abertoAqui ? null : g.lote_id)}
                  className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/30 transition-colors">
                  <ChevronRight className={`h-4 w-4 mt-0.5 shrink-0 text-muted-foreground transition-transform ${abertoAqui ? "rotate-90" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">
                      {new Date(g.feito_em).toLocaleString("pt-BR")}
                      {tudoRevertido && (
                        <Badge variant="outline" className="ml-2 text-[10px]">desfeita</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {num(g.clientes.size)} {g.clientes.size === 1 ? "cliente" : "clientes"} ·{" "}
                      {num(g.linhas.length)} {g.linhas.length === 1 ? "campo" : "campos"}
                      {g.revertidos > 0 && !tudoRevertido && ` · ${num(g.revertidos)} já desfeitos`}
                    </p>
                  </div>
                  {!tudoRevertido && (
                    <Button size="sm" variant="outline" className="shrink-0"
                      disabled={desfazendo === g.lote_id}
                      onClick={(e) => { e.stopPropagation(); setConfirmar(g); }}>
                      {desfazendo === g.lote_id
                        ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                      Desfazer
                    </Button>
                  )}
                </button>

                {abertoAqui && (
                  <div className="border-t bg-muted/20 p-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 text-left font-medium">Cliente</th>
                          <th className="px-2 py-1 text-left font-medium">O quê</th>
                          <th className="px-2 py-1 text-right font-medium">Antes</th>
                          <th className="px-2 py-1 text-right font-medium">Depois</th>
                          <th className="px-2 py-1 text-left font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.linhas.map((l: any) => (
                          <tr key={l.id} className="border-t border-border/50">
                            <td className="px-2 py-1.5">
                              {l.codigo_sequencial != null && (
                                <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                                  {l.codigo_sequencial}
                                </span>
                              )}
                              {l.cliente_nome}
                            </td>
                            <td className="px-2 py-1.5">
                              {ROTULO[l.acao] ?? l.acao}
                              {l.acao === "modulos" && l.campo && `: ${l.campo}`}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                              {l.valor_antes === null ? <em>não existia</em> : valor(l.valor_antes, l.acao)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {valor(l.valor_depois, l.acao)}
                            </td>
                            <td className="px-2 py-1.5">
                              {l.revertido_em && (
                                <Badge variant="outline" className="text-[10px]">desfeito</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer esta aplicação</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Os valores voltam ao que eram antes de{" "}
                  <strong>{confirmar && new Date(confirmar.feito_em).toLocaleString("pt-BR")}</strong>:{" "}
                  {num(confirmar?.linhas.length)} campos em {num(confirmar?.clientes.size)}{" "}
                  {confirmar?.clientes.size === 1 ? "cliente" : "clientes"}.
                </p>
                <p>
                  Módulo que foi <strong>inserido</strong> é removido; valor que foi trocado volta
                  ao anterior; o contrato acompanha. O histórico não some — a linha fica marcada
                  como desfeita.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={!!desfazendo}
              onClick={(e) => { e.preventDefault(); desfazer(); }}>
              {desfazendo && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Desfazer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
