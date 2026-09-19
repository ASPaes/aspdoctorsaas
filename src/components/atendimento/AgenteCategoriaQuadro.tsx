import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAtendimentoFilter, SEM_CATEGORIA_ID } from "@/contexts/AtendimentoFilterContext";
import type { AgenteCategoriaRow, AgenteRow } from "./useAtendimentoAgentes";
import { fmtDur } from "./fmtDuracao";
import { AgenteCategoriaChatsDialog, type CelulaSelecionada } from "./AgenteCategoriaChatsDialog";

/**
 * Quadro Agente × Categoria (DEM-0315): TMA mediano de cada agente em cada
 * categoria. Categoria vem do ticket vinculado ao atendimento.
 *
 * Só concorre ao destaque (mais rápido / mais lento da coluna) a célula com
 * MIN_ATEND ou mais atendimentos: com 2 ou 3 casos a mediana é sorte, e pintar
 * de verde quem atendeu 2 chats rápidos diria "melhor" sem base.
 */
const MIN_ATEND = 10;
const MAX_COLUNAS = 6;

interface Props {
  agentes: AgenteRow[];
  porCategoria: AgenteCategoriaRow[];
}

export function AgenteCategoriaQuadro({ agentes, porCategoria }: Props) {
  const { categorias, categoryIds } = useAtendimentoFilter();
  const [aberta, setAberta] = useState<CelulaSelecionada | null>(null);
  // "Sem categoria" não vira coluna de TMA: vira a coluna de contagem do fim.
  const mostrarSem = categoryIds.length === 0 || categoryIds.includes(SEM_CATEGORIA_ID);

  const { colunas, celula, semCategoria, destaque } = useMemo(() => {
    const grupoDe = new Map(categorias.map((c) => [c.id, c.grupo]));
    const volume = new Map<string, { nome: string; total: number }>();
    const celula = new Map<string, AgenteCategoriaRow>();
    const semCategoria = new Map<string, number>();
    for (const r of porCategoria) {
      if (r.category_id === null) {
        semCategoria.set(r.agent_id, (semCategoria.get(r.agent_id) ?? 0) + r.total);
        continue;
      }
      celula.set(`${r.agent_id}|${r.category_id}`, r);
      const v = volume.get(r.category_id) ?? { nome: r.categoria ?? "(sem nome)", total: 0 };
      v.total += r.total;
      volume.set(r.category_id, v);
    }
    // Com filtro, as colunas são as escolhidas. Sem filtro, as de maior volume.
    let ids = [...volume.entries()].sort((a, b) => b[1].total - a[1].total).map(([id]) => id);
    const catReais = categoryIds.filter((id) => id !== SEM_CATEGORIA_ID);
    if (catReais.length) ids = ids.filter((id) => catReais.includes(id));
    else if (categoryIds.length) ids = [];
    else ids = ids.slice(0, MAX_COLUNAS);
    const colunas = ids.map((id) => ({ id, nome: volume.get(id)!.nome, grupo: grupoDe.get(id) ?? null }));

    const destaque = new Map<string, { melhor: number; pior: number }>();
    for (const c of colunas) {
      const tmas = agentes
        .map((a) => celula.get(`${a.agent_id}|${c.id}`))
        .filter((x): x is AgenteCategoriaRow => !!x && x.total >= MIN_ATEND && x.tma_p50 !== null)
        .map((x) => x.tma_p50 as number);
      if (tmas.length >= 2) destaque.set(c.id, { melhor: Math.min(...tmas), pior: Math.max(...tmas) });
    }
    return { colunas, celula, semCategoria, destaque };
  }, [agentes, porCategoria, categorias, categoryIds]);

  // Produto só aparece no cabeçalho quando o nome se repete (PDV × Pdv).
  const nomeRepetido = (nome: string) =>
    colunas.filter((c) => c.nome.toLowerCase() === nome.toLowerCase()).length > 1;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold">Agente × Categoria</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        TMA de cada agente em cada categoria do ticket. Verde é o mais rápido da coluna, vermelho o mais lento.
        Com menos de {MIN_ATEND} atendimentos a célula fica cinza e não concorre. Clique numa célula para ver os chats.
        {!categoryIds.length && colunas.length === MAX_COLUNAS && ` Mostrando as ${MAX_COLUNAS} categorias com mais atendimentos.`}
      </p>
      {colunas.length === 0 && !mostrarSem ? (
        <p className="text-sm text-muted-foreground">Nenhum atendimento com ticket categorizado no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">Agente</th>
                {colunas.map((c) => (
                  <th key={c.id} className="py-2 px-2 text-center font-medium">
                    <div className="truncate max-w-[9rem] mx-auto" title={c.nome}>{c.nome}</div>
                    {c.grupo && nomeRepetido(c.nome) && (
                      <div className="normal-case font-normal text-[11px]">{c.grupo}</div>
                    )}
                  </th>
                ))}
                {mostrarSem && <th className="py-2 pl-2 text-center font-medium">Sem categoria</th>}
              </tr>
            </thead>
            <tbody>
              {agentes.map((a) => (
                <tr key={a.agent_id} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-3 truncate max-w-[14rem]">{a.nome}</td>
                  {colunas.map((c) => {
                    const x = celula.get(`${a.agent_id}|${c.id}`);
                    if (!x) {
                      return <td key={c.id} className="py-2 px-2 text-center text-muted-foreground">—</td>;
                    }
                    const d = destaque.get(c.id);
                    const concorre = x.total >= MIN_ATEND && x.tma_p50 !== null;
                    const melhor = concorre && d && x.tma_p50 === d.melhor;
                    const pior = concorre && d && x.tma_p50 === d.pior && d.pior !== d.melhor;
                    return (
                      <td key={c.id} className="py-1.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => setAberta({
                            agentId: a.agent_id,
                            agente: a.nome,
                            categoryId: c.id,
                            categoria: c.grupo && nomeRepetido(c.nome) ? `${c.nome} (${c.grupo})` : c.nome,
                          })}
                          title={`Ver os ${x.total} chats de ${a.nome} em ${c.nome}`}
                          className={cn(
                            "mx-auto inline-flex min-w-[5.5rem] flex-col rounded border border-transparent px-2 py-1 tabular-nums transition-colors",
                            "hover:border-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            melhor && "bg-green-500/15 text-green-400 font-medium",
                            pior && "bg-destructive/15 text-destructive",
                            !concorre && "text-muted-foreground",
                          )}
                        >
                          <span>{fmtDur(x.tma_p50)}</span>
                          <span className="text-[11px] font-normal text-muted-foreground">{x.total} atend.</span>
                        </button>
                      </td>
                    );
                  })}
                  {mostrarSem && (
                    <td className="py-2 pl-2 text-center text-xs text-muted-foreground tabular-nums">
                      {(semCategoria.get(a.agent_id) ?? 0) > 0 ? (
                        <button
                          type="button"
                          onClick={() => setAberta({ agentId: a.agent_id, agente: a.nome, categoryId: null, categoria: "Sem categoria" })}
                          title={`Ver os chats de ${a.nome} sem ticket categorizado`}
                          className="rounded border border-transparent px-2 py-1 transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {semCategoria.get(a.agent_id)} atend.
                        </button>
                      ) : (
                        "0 atend."
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AgenteCategoriaChatsDialog celula={aberta} onClose={() => setAberta(null)} />
    </div>
  );
}
