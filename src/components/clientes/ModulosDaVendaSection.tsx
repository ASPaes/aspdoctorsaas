import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { NumericInput } from "@/components/ui/numeric-input";
import { AlertTriangle, Puzzle } from "lucide-react";

// ============================================================================
// Módulos contratados junto com o produto, no "Adicionar Produto".
//
// Venda inicial não é up-sell: estes módulos entram na MESMA gravação do
// produto (create_cliente_produto_with_contract, p_dados.modulos), sem
// movimento de upsell e sem mandar o contrato ao Omie sozinho. O "Adicionar
// módulo" do card continua sendo o caminho de venda posterior.
//
// Valor mensal por módulo é opcional e só registra: o MRR do produto é o
// digitado no campo Valor Mensal. O banco só troca o MRR pela soma quando
// TODOS os módulos têm valor — o aviso abaixo existe para esse caso.
//
// O custo de módulo do OEM sai de fn_oem_tabela_do_produto, a MESMA função
// que a gravação usa: tela e banco nunca mostram números diferentes.
// ============================================================================

export interface LinhaModuloVenda {
  quantidade: number;
  vlr_mensal: number | null;
  vlr_custo: number | null;
}

export type ModulosDaVenda = Record<string, LinhaModuloVenda>;

interface CatalogoModulo {
  id: string;
  nome: string;
  oem_modulo_codigo: number | null;
  vlr_custo: number | null;
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function modulosParaGravar(sel: ModulosDaVenda) {
  return Object.entries(sel).map(([modulo_id, l]) => ({
    modulo_id,
    quantidade: Math.max(1, Math.trunc(Number(l.quantidade) || 1)),
    vlr_mensal: Number(l.vlr_mensal) || 0,
    vlr_custo: l.vlr_custo,
  }));
}

export default function ModulosDaVendaSection({
  clienteId, produtoId, tenantId, vlrMensalProduto, value, onChange,
}: {
  clienteId: string;
  produtoId: string;
  tenantId: string | null;
  vlrMensalProduto: number | null;
  value: ModulosDaVenda;
  onChange: (v: ModulosDaVenda) => void;
}) {
  const catalogoQ = useQuery<CatalogoModulo[]>({
    queryKey: ["modulos-da-venda-catalogo", tenantId, produtoId],
    enabled: !!produtoId,
    queryFn: async () => {
      let q = (supabase.from("produto_modulos" as any) as any)
        .select("id, nome, oem_modulo_codigo, vlr_custo")
        .eq("produto_id", Number(produtoId))
        .eq("ativo", true)
        .order("nome");
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CatalogoModulo[];
    },
  });

  const tabelaOemQ = useQuery<Map<string, number | null>>({
    queryKey: ["modulos-da-venda-tabela-oem", clienteId, produtoId],
    enabled: !!produtoId && !!clienteId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_tabela_do_produto", {
        p_cliente_id: clienteId,
        p_produto_id: Number(produtoId),
      });
      if (error) throw error;
      const m = new Map<string, number | null>();
      for (const r of (data ?? []) as { modulo_id: string; valor_unitario: number | null }[]) {
        m.set(r.modulo_id, r.valor_unitario == null ? null : Number(r.valor_unitario));
      }
      return m;
    },
  });

  const catalogo = catalogoQ.data ?? [];
  const tabela = tabelaOemQ.data ?? new Map<string, number | null>();
  const produtoDoOem = tabela.size > 0;

  // Custo que vale para a linha: módulo do parceiro é a tabela do OEM e não
  // se digita; o resto aceita o que a pessoa escrever, com o catálogo como
  // ponto de partida.
  const custoDe = (m: CatalogoModulo, l?: LinhaModuloVenda) =>
    tabela.has(m.id) ? (tabela.get(m.id) ?? 0) : (l?.vlr_custo ?? Number(m.vlr_custo ?? 0));

  const marcar = (m: CatalogoModulo, on: boolean) => {
    const prox = { ...value };
    if (on) {
      prox[m.id] = {
        quantidade: 1,
        vlr_mensal: null,
        vlr_custo: tabela.has(m.id) ? null : (m.vlr_custo != null ? Number(m.vlr_custo) : null),
      };
    } else {
      delete prox[m.id];
    }
    onChange(prox);
  };

  const alterar = (id: string, patch: Partial<LinhaModuloVenda>) =>
    onChange({ ...value, [id]: { ...value[id], ...patch } });

  const marcarTodos = () => {
    const prox: ModulosDaVenda = { ...value };
    for (const m of catalogo) {
      if (prox[m.id]) continue;
      prox[m.id] = {
        quantidade: 1,
        vlr_mensal: null,
        vlr_custo: tabela.has(m.id) ? null : (m.vlr_custo != null ? Number(m.vlr_custo) : null),
      };
    }
    onChange(prox);
  };

  const resumo = useMemo(() => {
    const marcados = catalogo.filter((m) => value[m.id]);
    let custo = 0;
    let mensal = 0;
    let todosComValor = marcados.length > 0;
    for (const m of marcados) {
      const l = value[m.id];
      const q = Math.max(1, Number(l.quantidade) || 1);
      custo += custoDe(m, l) * q;
      mensal += (Number(l.vlr_mensal) || 0) * q;
      if (!(Number(l.vlr_mensal) > 0)) todosComValor = false;
    }
    return { qtd: marcados.length, custo, mensal, todosComValor };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogo, value, tabela]);

  if (!produtoId) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            <Puzzle className="h-4 w-4" /> Módulos contratados
          </h4>
          <p className="text-xs text-muted-foreground">
            {produtoDoOem
              ? "Opcional. O custo dos módulos do OEM vem da tabela do parceiro."
              : "Opcional. Marque os módulos que o cliente contratou junto com o produto."}
          </p>
        </div>
        {catalogo.length > 0 && (
          <div className="flex gap-1">
            <Button type="button" variant="outline" size="sm" onClick={marcarTodos}>
              Marcar todos
            </Button>
            {resumo.qtd > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
                Limpar
              </Button>
            )}
          </div>
        )}
      </div>

      {catalogoQ.isLoading || tabelaOemQ.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : catalogoQ.isError ? (
        <p className="text-xs text-destructive">Não foi possível carregar os módulos deste produto.</p>
      ) : catalogo.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded border border-dashed p-3">
          Este produto não tem módulos cadastrados.
        </p>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 p-2" />
                  <th className="p-2 text-left font-medium">Módulo</th>
                  <th className="p-2 text-center font-medium w-20">Qtd</th>
                  <th className="p-2 text-right font-medium w-36">Mensal unit.</th>
                  <th className="p-2 text-right font-medium w-32">Custo unit.</th>
                </tr>
              </thead>
              <tbody>
                {catalogo.map((m) => {
                  const l = value[m.id];
                  const on = !!l;
                  const doOem = tabela.has(m.id);
                  const semPreco = doOem && tabela.get(m.id) == null;
                  return (
                    <tr key={m.id} className="border-t">
                      <td className="p-2 text-center">
                        <Checkbox
                          id={`mod-venda-${m.id}`}
                          checked={on}
                          onCheckedChange={(c) => marcar(m, c === true)}
                          aria-label={`Contratar ${m.nome}`}
                        />
                      </td>
                      <td className="p-2">
                        <label htmlFor={`mod-venda-${m.id}`} className={on ? "cursor-pointer" : "cursor-pointer text-muted-foreground"}>
                          {m.nome}
                        </label>
                        {doOem && (
                          <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                            OEM {m.oem_modulo_codigo}
                          </Badge>
                        )}
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={1}
                          className="h-8 text-center"
                          disabled={!on}
                          value={on ? l.quantidade : ""}
                          onChange={(e) => alterar(m.id, { quantidade: Math.max(1, Number(e.target.value) || 1) })}
                          aria-label={`Quantidade de ${m.nome}`}
                        />
                      </td>
                      <td className="p-2">
                        <NumericInput
                          className="h-8 text-right"
                          disabled={!on}
                          value={on ? l.vlr_mensal : null}
                          onChange={(v) => alterar(m.id, { vlr_mensal: v })}
                          decimals={2}
                          placeholder="0,00"
                          aria-label={`Valor mensal unitário de ${m.nome}`}
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {doOem ? (
                          <span
                            className={semPreco ? "text-amber-600" : "text-muted-foreground"}
                            title={semPreco ? "Sem preço na tabela do OEM: entra com custo zero" : "Tabela do OEM"}
                          >
                            {semPreco ? "sem tabela" : brl(tabela.get(m.id) ?? 0)}
                          </span>
                        ) : (
                          <NumericInput
                            className="h-8 text-right"
                            disabled={!on}
                            value={on ? l.vlr_custo : (m.vlr_custo != null ? Number(m.vlr_custo) : null)}
                            onChange={(v) => alterar(m.id, { vlr_custo: v })}
                            decimals={2}
                            placeholder="0,00"
                            aria-label={`Custo unitário de ${m.nome}`}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {resumo.qtd > 0 && (
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {resumo.qtd} {resumo.qtd === 1 ? "módulo marcado" : "módulos marcados"} · custo mensal{" "}
                <span className="font-medium text-foreground tabular-nums">R$ {brl(resumo.custo)}</span>
              </span>
              <span>
                Soma informada nos módulos{" "}
                <span className="font-medium text-foreground tabular-nums">R$ {brl(resumo.mensal)}</span>
                {" · "}MRR do produto continua{" "}
                <span className="font-medium text-foreground tabular-nums">R$ {brl(Number(vlrMensalProduto) || 0)}</span>
              </span>
            </div>
          )}

          {resumo.todosComValor ? (
            <p className="flex items-start gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Todos os módulos marcados têm valor mensal. Nesse caso o MRR do produto passa a ser a soma deles
              (R$ {brl(resumo.mensal)}), e não o Valor Mensal digitado. Deixe em branco o valor de algum módulo para manter o MRR digitado.
            </p>
          ) : resumo.qtd > 0 ? (
            <p className="text-xs text-muted-foreground">
              Os valores por módulo só ficam registrados. O MRR do produto é o que está em Valor Mensal.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
