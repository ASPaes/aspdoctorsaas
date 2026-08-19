import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Link2, Loader2, Package, Unlink, ArrowDownToLine, AlertTriangle } from "lucide-react";

// ============================================================================
// Vincular um produto do catálogo do OEM a um produto do DoctorSaaS.
//
// O vínculo sozinho não muda nada: ele diz "esta coluna da grade de preços é
// este produto daqui". O que mexe no cadastro é o UPGRADE, e por isso ele é
// uma pergunta separada, com o estrago listado antes do clique.
//
// O upgrade NÃO é "apagar tudo e importar". Módulo que algum cliente, contrato
// ou jornada de implantação já usa não pode ser apagado (FK sem ON DELETE), e
// apagar seria errado mesmo se desse: sumiria com o histórico. A regra é:
//   · mesmo nome (ignorando acento e caixa) → reaproveita e atualiza o custo
//   · não existe aqui                       → cria
//   · não existe mais no OEM e ninguém usa  → apaga
//   · não existe mais no OEM mas está em uso→ inativa
// ============================================================================

export type ProdutoOem = {
  codigo: string;
  nome: string;
  // Os módulos daquela COLUNA da grade: só os que existem no produto (célula
  // preenchida). Célula vazia é módulo que não existe ali, não módulo zerado.
  modulos: { codigo: number; nome: string; valor: number }[];
};

export type VinculoOem = {
  produto_codigo: string;
  produto_id: number;
  ultimo_upgrade_em: string | null;
};

type ProdutoDs = { id: number; nome: string };

export default function VincularProdutoOemDialog({
  produtoOem, vinculo, contaId, tenantId, aberto, onOpenChange, onConcluido,
}: {
  produtoOem: ProdutoOem | null;
  vinculo: VinculoOem | null;
  contaId: string | null;
  tenantId: string | null;
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  onConcluido: () => void;
}) {
  const { toast } = useToast();
  const [produtoDsId, setProdutoDsId] = useState<string>("");
  const [soComValor, setSoComValor] = useState(false);
  const [perguntandoUpgrade, setPerguntandoUpgrade] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [desvinculando, setDesvinculando] = useState(false);

  // Reabrir o diálogo com outro produto não pode herdar a escolha anterior —
  // era assim que se vinculava o produto errado sem perceber.
  useEffect(() => {
    if (!aberto) return;
    setProdutoDsId(vinculo ? String(vinculo.produto_id) : "");
    setSoComValor(false);
    setPerguntandoUpgrade(false);
  }, [aberto, vinculo, produtoOem?.codigo]);

  const { data: produtosDs = [], isLoading: carregandoProdutos } = useQuery({
    queryKey: ["oem-produtos-ds", tenantId],
    enabled: aberto && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos" as any) as any)
        .select("id, nome").eq("tenant_id", tenantId).order("nome");
      if (error) throw error;
      return (data ?? []) as ProdutoDs[];
    },
  });

  // Os módulos que o produto do DoctorSaaS tem HOJE. Serve para a pergunta do
  // upgrade dizer quantos são, em vez de "os módulos existentes".
  const { data: modulosDs = [], isLoading: carregandoModulos } = useQuery({
    queryKey: ["oem-modulos-do-produto-ds", produtoDsId],
    enabled: aberto && !!produtoDsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produto_modulos" as any) as any)
        .select("id, nome, ativo").eq("produto_id", Number(produtoDsId));
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; ativo: boolean }[];
    },
  });

  // Mesma normalização da RPC (fn_norm_nome_modulo): sem acento, sem caixa,
  // sem espaço sobrando. Se a prévia normalizar diferente do banco, ela mente.
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

  const modulosOem = useMemo(() => {
    const lista = produtoOem?.modulos ?? [];
    return soComValor ? lista.filter((m) => m.valor > 0) : lista;
  }, [produtoOem, soComValor]);

  // Prévia do upgrade. Quantos saem de circulação a tela sabe; se cada um vai
  // ser apagado ou inativado depende de quem usa o módulo, e isso quem apura é
  // a RPC — o número exato volta no resultado e vira o toast.
  const previa = useMemo(() => {
    const chavesOem = new Set(modulosOem.map((m) => norm(m.nome)));
    const casam = modulosDs.filter((m) => chavesOem.has(norm(m.nome))).length;
    return {
      hoje: modulosDs.length,
      doOem: modulosOem.length,
      casam,
      criar: modulosOem.filter((m) => !modulosDs.some((d) => norm(d.nome) === norm(m.nome))).length,
      saem: modulosDs.length - casam,
      zerados: (produtoOem?.modulos ?? []).filter((m) => m.valor === 0).length,
    };
  }, [modulosOem, modulosDs, produtoOem]);

  const produtoDsNome = produtosDs.find((p) => String(p.id) === produtoDsId)?.nome ?? "";

  async function executar(upgrade: boolean) {
    if (!contaId || !produtoOem || !produtoDsId) return;
    setGravando(true);
    try {
      const { data, error } = await (supabase as any).rpc("fn_oem_vincular_produto", {
        p_conta_integration_id: contaId,
        p_produto_codigo: produtoOem.codigo,
        p_produto_id: Number(produtoDsId),
        p_upgrade: upgrade,
        p_somente_com_valor: soComValor,
      });
      if (error) throw error;

      const r = (data ?? {}) as Record<string, number | boolean>;
      toast({
        title: upgrade ? "Módulos importados" : "Produto vinculado",
        description: upgrade
          ? `${r.criados ?? 0} criado(s) · ${r.atualizados ?? 0} atualizado(s) · ` +
            `${r.apagados ?? 0} apagado(s) · ${r.inativados ?? 0} inativado(s).`
          : `${produtoOem.nome} agora aponta para ${produtoDsNome}. Nenhum módulo foi alterado.`,
      });
      setPerguntandoUpgrade(false);
      onOpenChange(false);
      onConcluido();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Não deu para vincular",
        description: e?.message ?? "Erro desconhecido.",
      });
    } finally {
      setGravando(false);
    }
  }

  async function desvincular() {
    if (!contaId || !produtoOem) return;
    setDesvinculando(true);
    try {
      const { error } = await (supabase.from("oem_produto_vinculo" as any) as any)
        .delete()
        .eq("conta_integration_id", contaId)
        .eq("produto_codigo", produtoOem.codigo);
      if (error) throw error;
      toast({
        title: "Vínculo desfeito",
        description: "Os módulos do produto continuam como estão — desvincular não apaga nada.",
      });
      onOpenChange(false);
      onConcluido();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Não deu para desvincular", description: e?.message });
    } finally {
      setDesvinculando(false);
    }
  }

  return (
    <>
      <Dialog open={aberto} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              {produtoOem?.nome ?? "Produto do OEM"}
            </DialogTitle>
            <DialogDescription>
              Escolha o produto do DoctorSaaS que corresponde a este produto do catálogo do
              parceiro. O vínculo vale <strong>para esta conta OEM</strong> — cada unidade tem a
              sua grade de preços.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Package className="h-3.5 w-3.5" />
                {produtoOem?.modulos.length ?? 0} módulo(s) nesta coluna
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {previa.zerados > 0
                  ? `${previa.zerados} estão zerados na grade de preços.`
                  : "Todos com valor na grade de preços."}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Produto do DoctorSaaS</label>
              {carregandoProdutos ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select value={produtoDsId} onValueChange={setProdutoDsId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o produto…" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtosDs.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {vinculo && (
                <p className="text-xs text-muted-foreground">
                  Vinculado hoje a <strong>{produtosDs.find((p) => p.id === vinculo.produto_id)?.nome ?? `produto #${vinculo.produto_id}`}</strong>
                  {vinculo.ultimo_upgrade_em
                    ? ` · módulos importados em ${new Date(vinculo.ultimo_upgrade_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                    : " · módulos ainda não importados"}.
                </p>
              )}
            </div>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={soComValor}
                onCheckedChange={(v) => setSoComValor(v === true)}
                className="mt-0.5"
              />
              <span>
                Importar só os módulos que cobram
                <span className="block text-xs text-muted-foreground">
                  Deixa de fora os que estão zerados na grade — eles não entram no cadastro nem
                  ficam disponíveis para os clientes.
                </span>
              </span>
            </label>

            {produtoDsId && (
              <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                {carregandoModulos ? (
                  <Skeleton className="h-4 w-40" />
                ) : (
                  <>
                    <strong className="text-foreground">{produtoDsNome}</strong> tem{" "}
                    {previa.hoje} módulo(s) hoje · {previa.casam} casam por nome com o OEM ·{" "}
                    {previa.criar} seriam criados · {previa.saem} sairiam de circulação.
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {vinculo ? (
              <Button variant="ghost" size="sm" className="gap-1.5 text-destructive"
                onClick={desvincular} disabled={desvinculando || gravando}>
                {desvinculando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                Desvincular
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={gravando}>
                Cancelar
              </Button>
              <Button className="gap-1.5" disabled={!produtoDsId || gravando}
                onClick={() => setPerguntandoUpgrade(true)}>
                <Link2 className="h-4 w-4" />
                {vinculo && String(vinculo.produto_id) === produtoDsId ? "Continuar" : "Vincular"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A pergunta do enunciado. "Não" grava só o de-para; "Sim" sincroniza os
          módulos. O que o Sim faz está escrito ANTES do clique, porque ele
          mexe no cadastro que os clientes usam. */}
      <AlertDialog open={perguntandoUpgrade} onOpenChange={setPerguntandoUpgrade}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deseja fazer upgrade?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  O upgrade substitui os módulos de <strong>{produtoDsNome}</strong> pelos{" "}
                  <strong>{previa.doOem}</strong> módulos de {produtoOem?.nome} no OEM, trazendo o
                  preço de tabela para o <strong>custo</strong> de cada um.
                </p>
                <ul className="space-y-1 text-sm">
                  <li>· <strong>{previa.casam}</strong> de mesmo nome são reaproveitados — o custo é atualizado, margem e preço de venda ficam como estão.</li>
                  <li>· <strong>{previa.criar}</strong> são criados com custo do OEM e margem zero.</li>
                  <li>· <strong>{previa.saem}</strong> saem de circulação: apagados se ninguém usa, apenas inativados se algum cliente, contrato ou jornada já usa.</li>
                </ul>
                {previa.saem > 0 && (
                  <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Módulo inativado não some do cliente que já o contratou — ele só deixa de
                      aparecer para novas vendas.
                    </span>
                  </p>
                )}
                <p className="text-xs">
                  Respondendo <strong>Não</strong>, o vínculo é gravado e nenhum módulo é alterado.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={gravando}>Voltar</AlertDialogCancel>
            <Button variant="outline" disabled={gravando} onClick={() => executar(false)}>
              Não, só vincular
            </Button>
            <AlertDialogAction
              disabled={gravando}
              onClick={(e) => { e.preventDefault(); executar(true); }}
              className="gap-1.5"
            >
              {gravando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
              Sim, fazer upgrade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
