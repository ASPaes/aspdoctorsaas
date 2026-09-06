import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronRight, Loader2, Undo2, User } from "lucide-react";

// ============================================================================
// Integrações › OEM › Histórico
//
// A trilha do que esta aba fez, no mesmo desenho da do Hiper. O motivo é o
// mesmo: aqui se muda dado de cliente a partir do que um portal externo diz, e
// sem saber quem mudou, quando e qual era o valor antes, um clique errado vira
// um número que ninguém consegue explicar nem voltar.
//
// O agrupamento é por LOTE — o que saiu de um clique volta junto, do jeito que
// foi feito. "Aplicar custo em todos" é um lote com centenas de linhas; uma
// correção de nome é um lote de uma. Desfazer não apaga a trilha: grava a volta
// e marca a linha.
//
// Nem tudo tem volta, e a tela diz qual é qual em vez de esconder o que não
// pode. A gravação no sistema do PARCEIRO é o caso claro: desfazer aquilo é
// outra gravação lá, não um UPDATE aqui.
// ============================================================================

type Linha = {
  id: string;
  lote_id: string;
  feito_em: string;
  acao: string;
  campo: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  filial_codigo: string | null;
  valor_antes: any;
  valor_depois: any;
  reversivel: boolean;
  revertido_em: string | null;
  feito_por: string | null;
  feito_por_id: string | null;
};

const brl = (v: any) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const num = (v: number) => v.toLocaleString("pt-BR");

const ROTULO: Record<string, string> = {
  custo: "Custo",
  nome: "Nome fantasia",
  cnpj: "CNPJ",
  vinculo: "Licença vinculada",
  desvinculo: "Licença desvinculada",
  codigo_filial: "Código da filial",
  ignorar_divergencia: "Divergência marcada como certa",
  reexibir_divergencia: "Divergência de volta na lista",
  chave: "Chave da integração",
  // As duas de baixo não mudaram nada aqui: mudaram no OEM.
  parceiro_nome: "Nome corrigido no OEM",
  parceiro_cnpj: "CNPJ corrigido no OEM",
};

/** As que escreveram no sistema do parceiro, e não no cadastro daqui. */
const NO_PARCEIRO = new Set(["parceiro_nome", "parceiro_cnpj"]);

function valor(v: any, acao: string): string {
  if (v === null || v === undefined) return "—";
  if (acao === "custo") return brl(v);
  if (acao === "vinculo" || acao === "desvinculo") {
    return typeof v === "object" ? (v.cliente_nome ?? (v.cliente_id ? "outro cliente" : "—")) : String(v);
  }
  if (acao === "codigo_filial" && typeof v === "object") {
    return [v.grupo, v.filial].filter(Boolean).join(" / ") || "—";
  }
  if (acao === "chave" && typeof v === "object") return String(v.prefixo ?? "—");
  // Ignorar e reexibir guardam a assinatura do que estava sendo comparado. O
  // número de linhas afetadas não diz nada a quem lê, então só a assinatura sai.
  if (typeof v === "object") return v.assinatura ? String(v.assinatura) : "—";
  return String(v);
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Quem fez.
 *
 * Três casos, não dois: nome resolvido, usuário sem funcionário cadastrado, e
 * sem dono nenhum. Chamar os dois últimos de "sistema" atribuiria à máquina uma
 * decisão que uma pessoa tomou.
 */
function quem(l: { feito_por: string | null; feito_por_id: string | null }): string {
  if (l.feito_por) return l.feito_por;
  if (l.feito_por_id) return "Usuário sem nome cadastrado";
  return "sem registro de autor";
}

export default function OemHistoricoTab({ tid }: { tid: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<any | null>(null);

  const { data: log = [], isLoading } = useQuery<Linha[]>({
    queryKey: ["oem_historico", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_historico_listar", {
        p_tenant_id: tid,
        p_limite: 500,
      });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  const lotes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const m = new Map<string, any>();
    for (const l of log) {
      const g = m.get(l.lote_id) ?? {
        lote_id: l.lote_id, feito_em: l.feito_em,
        feito_por: l.feito_por, feito_por_id: l.feito_por_id,
        linhas: [] as Linha[], clientes: new Set<string>(),
        revertidos: 0, reversiveis: 0,
      };
      g.linhas.push(l);
      if (l.cliente_id) g.clientes.add(l.cliente_id);
      if (l.revertido_em) g.revertidos++;
      if (l.reversivel && !l.revertido_em) g.reversiveis++;
      if (l.feito_em > g.feito_em) g.feito_em = l.feito_em;
      m.set(l.lote_id, g);
    }
    return Array.from(m.values())
      .filter((g) => !q || g.linhas.some((l: Linha) =>
        String(l.cliente_nome ?? "").toLowerCase().includes(q)
        || String(l.filial_codigo ?? "") === q
        || String(l.feito_por ?? "").toLowerCase().includes(q)))
      .sort((a, b) => (a.feito_em < b.feito_em ? 1 : -1));
  }, [log, busca]);

  const desfazer = async () => {
    if (!confirmar) return;
    setDesfazendo(confirmar.lote_id);
    try {
      const { data, error } = await (supabase.rpc as any)("oem_reverter_lote", {
        p_tenant_id: tid, p_lote_id: confirmar.lote_id,
      });
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
      // A trilha, a conferência e o espelho: desfazer mexe nos três.
      ["oem_historico", "oem-recon", "oem-cliente-produtos", "oem-codigos-gravados"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      toast({ title: "Não foi possível desfazer", description: e.message, variant: "destructive" });
    } finally { setDesfazendo(null); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Tudo o que esta aba fez, agrupado por clique. Cada linha guarda o
        <strong> valor que estava lá antes</strong>, e é ele que permite voltar. Desfazer não apaga
        o histórico: grava a volta e marca o que foi revertido. O que foi gravado no sistema do
        OEM aparece aqui como registro, sem botão: desfazer lá é outra gravação lá.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Cliente, código da filial ou quem fez…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground ml-auto">
          {num(lotes.length)} {lotes.length === 1 ? "ação" : "ações"}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : lotes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {log.length === 0
            ? "Nada foi feito por esta aba ainda."
            : "Nenhuma ação com esse filtro."}
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {lotes.map((g) => {
            const abertoAqui = aberto === g.lote_id;
            const tudoRevertido = g.revertidos > 0 && g.reversiveis === 0;
            const soNoParceiro = g.linhas.every((l: Linha) => NO_PARCEIRO.has(l.acao));
            return (
              <div key={g.lote_id}>
                <button
                  type="button"
                  onClick={() => setAberto(abertoAqui ? null : g.lote_id)}
                  className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <ChevronRight className={`h-4 w-4 mt-0.5 shrink-0 text-muted-foreground transition-transform ${abertoAqui ? "rotate-90" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">
                      {quando(g.feito_em)}
                      {tudoRevertido && (
                        <Badge variant="outline" className="ml-2 text-[10px]">desfeita</Badge>
                      )}
                      {soNoParceiro && (
                        <Badge variant="outline" className="ml-2 text-[10px]">no OEM</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5">
                      <User className="h-3 w-3" />
                      {quem(g)}
                      <span>·</span>
                      {num(g.clientes.size)} {g.clientes.size === 1 ? "cliente" : "clientes"}
                      <span>·</span>
                      {num(g.linhas.length)} {g.linhas.length === 1 ? "alteração" : "alterações"}
                      {g.revertidos > 0 && !tudoRevertido && <span>· {num(g.revertidos)} já desfeitas</span>}
                    </p>
                  </div>
                  {g.reversiveis > 0 && (
                    <Button
                      size="sm" variant="outline" className="shrink-0"
                      disabled={desfazendo === g.lote_id}
                      onClick={(e) => { e.stopPropagation(); setConfirmar(g); }}
                    >
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
                        {g.linhas.map((l: Linha) => (
                          <tr key={l.id} className="border-t border-border/50">
                            <td className="px-2 py-1.5">
                              {l.filial_codigo && (
                                <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                                  {l.filial_codigo}
                                </span>
                              )}
                              {l.cliente_nome ?? "—"}
                            </td>
                            <td className="px-2 py-1.5">
                              {ROTULO[l.acao] ?? l.acao}
                              {/* O tipo da divergência só faz sentido junto do rótulo:
                                  "marcada como certa" sozinho não diz o quê. */}
                              {(l.acao === "ignorar_divergencia" || l.acao === "reexibir_divergencia")
                                && l.campo && `: ${l.campo}`}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                              {l.valor_antes === null || l.valor_antes === undefined
                                ? <em>não existia</em>
                                : valor(l.valor_antes, l.acao)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {valor(l.valor_depois, l.acao)}
                            </td>
                            <td className="px-2 py-1.5">
                              {l.revertido_em ? (
                                <Badge variant="outline" className="text-[10px]">desfeito</Badge>
                              ) : !l.reversivel ? (
                                <span className="text-[10px] text-muted-foreground">sem volta</span>
                              ) : null}
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
            <AlertDialogTitle>Desfazer esta ação</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Os valores voltam ao que eram antes de{" "}
                  <strong>{confirmar && quando(confirmar.feito_em)}</strong>:{" "}
                  {num(confirmar?.reversiveis ?? 0)}{" "}
                  {confirmar?.reversiveis === 1 ? "alteração" : "alterações"} em{" "}
                  {num(confirmar?.clientes.size ?? 0)}{" "}
                  {confirmar?.clientes.size === 1 ? "cliente" : "clientes"}.
                </p>
                <p>
                  Custo volta ao anterior; vínculo desfeito devolve a licença a quem a tinha; código
                  de filial removido é regravado. O histórico não some: a linha fica marcada como
                  desfeita.
                </p>
                {confirmar && confirmar.linhas.length > confirmar.reversiveis && (
                  <p className="text-muted-foreground">
                    {num(confirmar.linhas.length - confirmar.reversiveis)} desta ação não voltam por
                    aqui e ficam como estão.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!desfazendo}
              onClick={(e) => { e.preventDefault(); desfazer(); }}
            >
              {desfazendo && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Desfazer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
