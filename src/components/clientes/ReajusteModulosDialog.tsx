import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { NumericInput } from "@/components/ui/numeric-input";
import { Loader2, Percent } from "lucide-react";

interface ModuloItem {
  id: string;
  nome: string;
  vlr_mensal: number;
  vlr_custo: number;
  ativo: boolean;
  oem_modulo_codigo: number | null;
}

interface ReajusteModulosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteProdutoId: string;
  produtoNome: string;
  modulos: ModuloItem[];
  produtoId: number | null;
  temLicencaOem: boolean;
  tenantId: string | null;
  clienteId: string;
  onSuccess: () => void;
  onMRRSuggest: (data: { tipo: "upsell"; valorDelta: number; custoDelta: number; descricao: string }) => void;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) =>
  Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sign = (n: number) => (n >= 0 ? "+" : "-");

export default function ReajusteModulosDialog({
  open, onOpenChange, clienteProdutoId, produtoNome, modulos,
  produtoId, temLicencaOem, tenantId, clienteId, onSuccess, onMRRSuggest,
}: ReajusteModulosDialogProps) {
  const [pct, setPct] = useState<number | null>(0);
  const [aplicarCusto, setAplicarCusto] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPct(0);
      setAplicarCusto(false);
    }
  }, [open]);

  // Produto ligado a uma coluna da tabela do OEM (Configurações › Integrações ›
  // OEM). Quando existe vínculo — ou o cliente tem licença —, quem dita o custo
  // dos módulos é o parceiro, e reajustar aqui só inventaria uma margem que o
  // próximo espelho apaga.
  const vinculoOemQuery = useQuery<number>({
    queryKey: ["oem-vinculo-do-produto-reajuste", produtoId],
    enabled: open && !!produtoId,
    queryFn: async () => {
      const { count, error } = await (supabase.from("oem_produto_vinculo" as any) as any)
        .select("produto_id", { count: "exact", head: true })
        .eq("produto_id", produtoId);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const produtoDoOem = temLicencaOem || (vinculoOemQuery.data ?? 0) > 0;

  const ativos = useMemo(() => modulos.filter(m => m.ativo), [modulos]);
  const p = pct ?? 0;
  const factor = 1 + p / 100;

  const rows = useMemo(() => ativos.map(m => {
    const travado = produtoDoOem && m.oem_modulo_codigo != null;
    const novoMensal = r2(m.vlr_mensal * factor);
    const novoCusto = travado ? m.vlr_custo : r2(m.vlr_custo * factor);
    return {
      ...m,
      custoTravado: travado,
      novoMensal,
      novoCusto,
      diffMensal: r2(novoMensal - m.vlr_mensal),
      diffCusto: r2(novoCusto - m.vlr_custo),
    };
  }), [ativos, factor, produtoDoOem]);

  const custoReajustavel = rows.filter(r => !r.custoTravado);
  const totalAtual = r2(rows.reduce((s, r) => s + r.vlr_mensal, 0));
  const totalNovo = r2(rows.reduce((s, r) => s + r.novoMensal, 0));
  const totalDiff = r2(totalNovo - totalAtual);
  // Soma TODOS, inclusive os travados — para o total bater com as linhas acima.
  // A diferença sai certa sozinha: no módulo do OEM, o custo novo é o atual.
  const totalCustoAtual = r2(rows.reduce((s, r) => s + r.vlr_custo, 0));
  const totalCustoNovo = r2(rows.reduce((s, r) => s + r.novoCusto, 0));
  const totalCustoDiff = r2(totalCustoNovo - totalCustoAtual);

  const handleAplicar = async () => {
    if (!p || rows.length === 0) return;
    setSaving(true);
    try {
      for (const r of rows) {
        const { error } = await (supabase.from("cliente_produto_modulos" as any) as any)
          .update({
            vlr_mensal: r.novoMensal,
            vlr_custo: aplicarCusto ? r.novoCusto : r.vlr_custo,
          })
          .eq("id", r.id);
        if (error) throw error;
      }
      toast({ title: `Reajuste de ${p}% aplicado em ${rows.length} módulos!` });
      onSuccess();
      if (totalDiff > 0) {
        onMRRSuggest({
          tipo: "upsell",
          valorDelta: totalDiff,
          custoDelta: aplicarCusto ? totalCustoDiff : 0,
          descricao: `Reajuste ${p}% — ${produtoNome}`,
        });
      }
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Erro ao aplicar reajuste", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" /> Reajuste — {produtoNome}
          </DialogTitle>
          <DialogDescription>
            Informe o percentual de reajuste. O valor será aplicado a todos os módulos ativos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-1">
              <Label>Percentual de Reajuste</Label>
              <NumericInput value={pct} onChange={setPct} suffix="%" decimals={2} />
            </div>
            <div className="flex flex-col gap-1 pb-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="aplicar-custo"
                  checked={aplicarCusto && custoReajustavel.length > 0}
                  disabled={custoReajustavel.length === 0}
                  onCheckedChange={(v) => setAplicarCusto(v === true)}
                />
                <Label
                  htmlFor="aplicar-custo"
                  className={custoReajustavel.length === 0 ? "text-muted-foreground" : "cursor-pointer"}
                >
                  Aplicar também ao custo
                </Label>
              </div>
              {/* Custo de módulo do OEM é o que o parceiro cobra de nós, não uma
                  escolha nossa: reajustar aqui inventaria uma margem que o
                  próximo espelho apaga. */}
              {custoReajustavel.length === 0 && rows.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  O custo destes módulos é ditado pelo OEM — só a mensalidade é reajustada.
                </p>
              )}
              {custoReajustavel.length > 0 && custoReajustavel.length < rows.length && (
                <p className="text-xs text-muted-foreground">
                  Vale para {custoReajustavel.length} de {rows.length} módulos: o custo dos demais é ditado pelo OEM.
                </p>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Módulo</TableHead>
                  <TableHead className="text-right">Mensal Atual</TableHead>
                  <TableHead className="text-right">Mensal Novo</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                  {aplicarCusto && <>
                    <TableHead className="text-right">Custo Atual</TableHead>
                    <TableHead className="text-right">Custo Novo</TableHead>
                  </>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={aplicarCusto ? 6 : 4} className="text-center text-muted-foreground">
                      Nenhum módulo ativo.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>{r.nome}</TableCell>
                        <TableCell className="text-right">R$ {fmt(r.vlr_mensal)}</TableCell>
                        <TableCell className="text-right">R$ {fmt(r.novoMensal)}</TableCell>
                        <TableCell className={`text-right ${r.diffMensal >= 0 ? "text-green-500" : "text-destructive"}`}>
                          R$ {sign(r.diffMensal)}{fmt(r.diffMensal)}
                        </TableCell>
                        {aplicarCusto && <>
                          <TableCell className="text-right">R$ {fmt(r.vlr_custo)}</TableCell>
                          <TableCell className="text-right">
                            {r.custoTravado
                              ? <span className="text-muted-foreground">R$ {fmt(r.vlr_custo)} · OEM</span>
                              : <>R$ {fmt(r.novoCusto)}</>}
                          </TableCell>
                        </>}
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-muted/30">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">R$ {fmt(totalAtual)}</TableCell>
                      <TableCell className="text-right">R$ {fmt(totalNovo)}</TableCell>
                      <TableCell className={`text-right ${totalDiff >= 0 ? "text-green-500" : "text-destructive"}`}>
                        R$ {sign(totalDiff)}{fmt(totalDiff)}
                      </TableCell>
                      {aplicarCusto && <>
                        <TableCell className="text-right">R$ {fmt(totalCustoAtual)}</TableCell>
                        <TableCell className="text-right">R$ {fmt(totalCustoNovo)}</TableCell>
                      </>}
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>

          <p className="text-sm text-muted-foreground">
            Reajuste de {p}% sobre {rows.length} módulos ativos. Delta mensal total:{" "}
            <span className={totalDiff >= 0 ? "text-green-500 font-medium" : "text-destructive font-medium"}>
              R$ {sign(totalDiff)}{fmt(totalDiff)}
            </span>
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleAplicar} disabled={!p || saving || rows.length === 0}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Aplicar Reajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
