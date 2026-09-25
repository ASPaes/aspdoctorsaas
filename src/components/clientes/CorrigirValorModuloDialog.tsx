import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Loader2 } from "lucide-react";

// ============================================================================
// Corrigir o valor mensal de um módulo digitado errado.
//
// É CORREÇÃO, não venda (decisão do Alexandre, 25/09/2026): a base do produto
// muda desde a ativação e nenhum upsell/downsell é lançado. Quem grava é a RPC
// `fn_corrigir_valor_modulo`, que repete o portão, exige motivo e barra módulo
// com movimento de MRR amarrado. O Histórico de módulos registra de → para.
// ============================================================================

export type ModuloParaCorrigir = {
  id: string;
  cliente_produto_id: string;
  nome: string;
  vlr_mensal: number | null;
  quantidade: number | null;
};

type Irmao = { id: string; vlr_mensal: number | null; quantidade: number | null; ativo: boolean };

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function CorrigirValorModuloDialog({
  modulo, irmaos, onClose, onSaved,
}: {
  modulo: ModuloParaCorrigir | null;
  // Os outros módulos do mesmo produto: o total do produto só segue os módulos
  // quando TODOS os ativos têm valor (regra de `fn_sync_produto_valores`).
  irmaos: Irmao[];
  onClose: () => void;
  // O mesmo refresh da ficha que o diálogo de módulo usa (totais, contrato).
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [valor, setValor] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setValor(modulo ? Number(modulo.vlr_mensal) || 0 : null);
    setMotivo("");
  }, [modulo?.id]);

  // Módulo com movimento amarrado fica de fora: o valor dele mora também no
  // movimento. A RPC barra do mesmo jeito; aqui é para a pessoa saber antes de
  // digitar o motivo.
  const movimentosQuery = useQuery({
    queryKey: ["movimentos_do_modulo", modulo?.id],
    enabled: !!modulo?.id,
    queryFn: async () => {
      const { count, error } = await (supabase.from("movimentos_mrr" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("cliente_produto_modulo_id", modulo!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (!modulo) return null;

  const qtd = Number(modulo.quantidade) || 1;
  const atual = Number(modulo.vlr_mensal) || 0;
  const novo = Number(valor) || 0;
  const bloqueado = (movimentosQuery.data ?? 0) > 0;
  const mudou = Math.round(novo * 100) !== Math.round(atual * 100);

  const ativos = irmaos.filter((m) => m.ativo);
  const todosPagos = ativos.every((m) =>
    m.id === modulo.id ? novo > 0 : (Number(m.vlr_mensal) || 0) > 0,
  );
  const totalNovo = ativos.reduce(
    (s, m) => s + (m.id === modulo.id ? novo : Number(m.vlr_mensal) || 0) * (Number(m.quantidade) || 1),
    0,
  );

  const salvar = async () => {
    setSalvando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("fn_corrigir_valor_modulo", {
        p_modulo_linha_id: modulo.id,
        p_novo_valor: novo,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
      toast({
        title: "Valor corrigido",
        description: `${modulo.nome}: ${brl(atual)} → ${brl(novo)}. Mensalidade do produto: ${brl(Number(data?.produto_mensal) || 0)}.`,
      });
      qc.invalidateQueries({ queryKey: ["cliente_produto_modulos"] });
      qc.invalidateQueries({ queryKey: ["cliente_produtos"] });
      qc.invalidateQueries({ queryKey: ["cliente_produto_modulo_eventos", modulo.cliente_produto_id] });
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Não foi possível corrigir", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={!!modulo} onOpenChange={(o) => { if (!o && !salvando) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Corrigir valor mensal</DialogTitle>
          <DialogDescription>
            {modulo.nome} · valor atual {brl(atual)} por unidade
            {qtd > 1 && ` (${qtd} unidades = ${brl(atual * qtd)})`}
          </DialogDescription>
        </DialogHeader>

        {bloqueado ? (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Este módulo tem movimento de MRR (upsell, downsell ou reajuste) ligado a ele.
              Parte do valor está no movimento, então a correção direta ainda não cobre esse caso.
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Valor mensal correto (por unidade)</Label>
              <NumericInput value={valor} onChange={(v) => setValor(v)} />
              {qtd > 1 && (
                <p className="text-xs text-muted-foreground">
                  {qtd} unidades = {brl(novo * qtd)}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Motivo da correção</Label>
              <Textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: valor digitado errado na venda"
                rows={2}
              />
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <p>
                É uma correção: o MRR passa a considerar o valor novo desde a ativação,
                sem lançar upsell ou downsell. Fica registrado no Histórico de módulos.
              </p>
              {mudou && (todosPagos ? (
                <p className="text-foreground">
                  Mensalidade do produto passa a ser <strong>{brl(totalNovo)}</strong>.
                </p>
              ) : (
                <p className="text-amber-600 dark:text-amber-400">
                  Há módulo sem valor neste produto: a mensalidade do produto é a digitada nele
                  e não muda com esta correção.
                </p>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          {!bloqueado && (
            <Button
              onClick={salvar}
              disabled={salvando || movimentosQuery.isLoading || !mudou || novo < 0 || !motivo.trim()}
            >
              {salvando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Corrigir valor
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
