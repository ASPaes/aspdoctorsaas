import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Check, ChevronRight, ExternalLink, EyeOff, Loader2, Wand2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Explica, Origem, Vazio, brl, cnpjMask, nomeTipo, noPeriodo, num, rotuloPeriodo } from "./ui";
import type { LinhaRecon } from "./useHiperDados";

/**
 * Onde toda correção acontece. As outras abas mostram números; esta é a única
 * em que algo é decidido.
 *
 * A ordem das famílias na lista não é estética: o tipo de contrato decide QUAL
 * regra de dinheiro vale, e a filial decide DE QUEM o dinheiro é. Atacar valor
 * antes dessas duas é corrigir duas vezes.
 */
const FAMILIAS: { chave: string; rotulo: string; explica: string; peso: number }[] = [
  { chave: "tipo_contrato_ausente", rotulo: "Sem tipo de contrato", peso: 1,
    explica: "Contrato ativo sem modelo definido. Enquanto ele não for classificado, nenhuma regra de valor se aplica a este cliente." },
  { chave: "tipo_contrato_divergente", rotulo: "Tipo de contrato diferente", peso: 1,
    explica: "O modelo aqui não é o que o portal diz. É ele que decide se o MRR pode ser comparado." },
  { chave: "filial_faltando_no_ds", rotulo: "Filial só no Hiper", peso: 2,
    explica: "O portal tem estabelecimento com CNPJ próprio que não existe como cadastro aqui." },
  { chave: "filial_com_valor", rotulo: "Filial com valor próprio", peso: 2,
    explica: "A matriz é quem deve carregar o total. Filial com valor pode estar duplicando MRR — ou pode ser filial que paga a própria conta, e aí é só registrar." },
  { chave: "filial_sem_matriz", rotulo: "Filial sem matriz certa", peso: 2,
    explica: "O cadastro casa com um estabelecimento, mas não aponta para a matriz da conta." },
  { chave: "filial_e_conta_propria", rotulo: "Filial que é conta própria", peso: 2,
    explica: "Está amarrada como filial aqui, mas o portal emite conta separada para ela — então não é filial." },
  { chave: "cadastro_duplicado", rotulo: "Cadastro duplicado", peso: 2,
    explica: "“Filial” com o mesmo CNPJ da matriz. É o mesmo cadastro duas vezes." },
  { chave: "custo_divergente", rotulo: "Custo diferente", peso: 3,
    explica: "O custo no contrato daqui não bate com o que a Hiper cobra ou retém." },
  { chave: "mrr_divergente", rotulo: "MRR diferente", peso: 3,
    explica: "Só nas centrais: quem cobra o cliente é a Hiper, então o valor dela é a verdade." },
  { chave: "modulo_a_mais_no_hiper", rotulo: "Módulo só no Hiper", peso: 4, explica: "O portal cobra um módulo que o contrato daqui não tem." },
  { chave: "modulo_a_menos_no_hiper", rotulo: "Módulo só aqui", peso: 4, explica: "O contrato tem um módulo que o portal não cobra." },
  { chave: "modulo_custo_divergente", rotulo: "Custo de módulo diferente", peso: 4, explica: "Módulo vinculado com custo diferente dos dois lados." },
  { chave: "sem_dono", rotulo: "Conta sem cliente aqui", peso: 5, explica: "Conta viva no Hiper que nenhum cadastro daqui é dono. Custo saindo sem receita entrando." },
  { chave: "sem_conta_no_hiper", rotulo: "Cliente sem conta no Hiper", peso: 5, explica: "Contrato ativo aqui sem conta no portal." },
  { chave: "conta_inativa_no_hiper", rotulo: "Conta inativa no Hiper", peso: 5, explica: "O cliente saiu no portal e o contrato daqui continua ativo." },
  { chave: "cnpj_ambiguo", rotulo: "CNPJ com mais de um cliente", peso: 5, explica: "Precisa de escolha humana: dois cadastros disputam a mesma conta." },
  { chave: "razao_social_divergente", rotulo: "Razão social diferente", peso: 6, explica: "Comparação já ignora acento, pontuação e sufixo societário." },
  { chave: "periodo_nao_comparavel", rotulo: "Valor não comparável", peso: 6,
    explica: "O contrato aqui tem recorrência sem conversão segura a partir do valor mensal do portal (semanal). O valor não é comparado nem gravado automaticamente — a linha fica na lista para você conferir na mão." },
];

const META = Object.fromEntries(FAMILIAS.map((f) => [f.chave, f]));

/**
 * O que o botão sabe gravar, e o efeito de cada coisa. A unidade aqui é a AÇÃO
 * e não a divergência: "tipo de contrato ausente" e "tipo de contrato
 * divergente" gravam o mesmo campo, e em lote é por ação que se escolhe.
 *
 * O resto continua sendo decisão na ficha: filial mexe em árvore de cadastro,
 * cadastro duplicado é fusão, e conta sem dono não tem onde escrever.
 */
const ACOES: {
  acao: string;
  rotulo: string;
  divs: string[];
  detalhe: (r: LinhaRecon) => string;
  efeito?: string;
}[] = [
  {
    acao: "tipo_contrato",
    rotulo: "Tipo de contrato",
    divs: ["tipo_contrato_ausente", "tipo_contrato_divergente"],
    detalhe: (r) => `${r.modelo_contrato_ds ?? "sem modelo"} → ${nomeTipo(r.responsavel_tipo)}`,
  },
  {
    acao: "custo",
    rotulo: "Custo",
    divs: ["custo_divergente"],
    detalhe: (r) => `${brl(r.custo_ds)} → ${brl(noPeriodo(r.custo_hiper, r.fator_periodo))}`,
    efeito: "Atualiza o custo do contrato e o custo de operação do cliente. Não mexe em receita.",
  },
  {
    acao: "mrr",
    rotulo: "Mensalidade (MRR)",
    divs: ["mrr_divergente"],
    detalhe: (r) => `${brl(r.mensalidade_ds)} → ${brl(noPeriodo(r.mrr_hiper, r.fator_periodo))}`,
    efeito: "Muda a mensalidade do cliente e o MRR da base. Não gera movimento de upsell/downsell, então o Net New do mês não vai explicar essa diferença. Nos tenants com Omie ativo, o novo valor vai para o ERP.",
  },
  {
    acao: "razao_social",
    rotulo: "Razão social",
    divs: ["razao_social_divergente"],
    detalhe: (r) => `usar “${r.razao_social_hiper}”`,
    efeito: "Enfileira sincronismo do cadastro para o Omie.",
  },
];

const ACAO = Object.fromEntries(ACOES.map((a) => [a.acao, a]));

/** As ações que fazem sentido para esta linha, na ordem da lista acima. */
const acoesDe = (r: LinhaRecon) =>
  ACOES.filter((a) => a.divs.some((d) => r.divergencias.includes(d))).map((a) => a.acao);

export default function HiperDivergenciasTab({ tid, recon }: { tid: string | null; recon: LinhaRecon[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [familia, setFamilia] = useState("todas");
  const [status, setStatus] = useState("pendente");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState<{ linhas: LinhaRecon[]; escolhidas: Set<string> } | null>(null);

  const alternar = (id: string) =>
    setSelecionados((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const contagem = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of recon) {
      if (status !== "todos" && r.status_usuario !== status) continue;
      for (const d of r.divergencias) m[d] = (m[d] ?? 0) + 1;
    }
    return m;
  }, [recon, status]);

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    return recon
      .filter((r) => r.divergencias.length > 0)
      .filter((r) => status === "todos" || r.status_usuario === status)
      .filter((r) => familia === "todas" || r.divergencias.includes(familia))
      .filter((r) => !q
        || (r.razao_social_ds ?? "").toLowerCase().includes(q)
        || (r.razao_social_hiper ?? "").toLowerCase().includes(q)
        || (qd && (r.cnpj_norm ?? "").includes(qd)))
      .sort((a, b) => {
        const pa = Math.min(...a.divergencias.map((d) => META[d]?.peso ?? 9));
        const pb = Math.min(...b.divergencias.map((d) => META[d]?.peso ?? 9));
        if (pa !== pb) return pa - pb;
        // dentro da mesma família, o dinheiro manda
        const va = Math.abs(Number(a.custo_hiper ?? 0) - Number(a.custo_ds ?? 0));
        const vb = Math.abs(Number(b.custo_hiper ?? 0) - Number(b.custo_ds ?? 0));
        return vb - va;
      });
  }, [recon, familia, status, busca]);

  /** Só entra no lote quem tem algo que o botão sabe gravar. */
  const selecionaveis = useMemo(() => linhas.filter((l) => acoesDe(l).length > 0), [linhas]);

  const marcar = async (id: string, novo: "resolvido" | "ignorado" | "pendente") => {
    setOcupado(id);
    try {
      const { error } = await (supabase.from("reconciliacao_hiper" as any) as any)
        .update({
          status_usuario: novo,
          resolvido_em: novo === "pendente" ? null : new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["hiper_recon"] });
    } catch (e: any) {
      toast({ title: "Não foi possível marcar", description: e.message, variant: "destructive" });
    } finally { setOcupado(null); }
  };

  const aplicar = async () => {
    if (!confirmar) return;
    const { linhas, escolhidas } = confirmar;
    setOcupado("aplicando");
    try {
      const { data, error } = await supabase.rpc("hiper_aplicar_correcao" as any, {
        p_tenant_id: tid,
        p_recon_ids: linhas.map((l) => l.id),
        p_acoes: Array.from(escolhidas),
      } as any);
      if (error) throw error;
      const r = data as any;
      if (!r?.ok) throw new Error(r?.erro || "Não foi possível aplicar.");
      setConfirmar(null);
      setSelecionados(new Set());
      // O que foi recusado importa tanto quanto o que gravou: sem isso o
      // operador acha que atualizou 200 e atualizou 40.
      const motivos = (r.motivos ?? []) as { motivo: string; qt: number }[];
      toast({
        title: r.clientes === 0
          ? "Nada foi atualizado"
          : `${num(r.clientes)} ${r.clientes === 1 ? "cliente atualizado" : "clientes atualizados"} · ${num(r.aplicado.length)} ${r.aplicado.length === 1 ? "campo" : "campos"}`,
        description: motivos.length
          ? `Pulados: ${motivos.map((m) => `${m.qt}× ${m.motivo}`).join(" · ")}`
          : undefined,
        variant: r.clientes === 0 ? "destructive" : undefined,
      });
      qc.invalidateQueries({ queryKey: ["hiper_recon"] });
    } catch (e: any) {
      toast({ title: "Não foi possível aplicar", description: e.message, variant: "destructive" });
    } finally { setOcupado(null); }
  };

  const decidirFilial = async (clienteId: string, decisao: string) => {
    setOcupado(clienteId);
    try {
      const { error } = await (supabase.from("hiper_filial_decisao" as any) as any)
        .upsert({ tenant_id: tid, cliente_id: clienteId, decisao }, { onConflict: "tenant_id,cliente_id" });
      if (error) throw error;
      toast({
        title: "Decisão registrada",
        description: "Ela sobrevive ao recálculo: esta filial não volta como pendência.",
      });
      qc.invalidateQueries({ queryKey: ["hiper_recon"] });
    } catch (e: any) {
      toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" });
    } finally { setOcupado(null); }
  };

  return (
    <div className="space-y-3">
      <Explica>
        Uma linha por cliente. Abra a seta e ela mostra tudo o que está divergindo nele.
        A lista já vem na ordem em que compensa atacar: <strong>tipo de contrato</strong> primeiro
        porque ele decide qual regra de dinheiro vale, depois <strong>filial</strong> porque ela
        decide de quem o dinheiro é, e só então <strong>valor</strong>. Ao contrário,
        você corrige duas vezes.
      </Explica>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar por nome ou CNPJ…" value={busca}
          onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="pendente">Pendentes</option>
          <option value="resolvido">Resolvidas</option>
          <option value="ignorado">Ignoradas</option>
          <option value="todos">Todas</option>
        </select>
        <select value={familia} onChange={(e) => setFamilia(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm max-w-[20rem]">
          <option value="todas">Todas as famílias</option>
          {FAMILIAS.filter((f) => contagem[f.chave]).map((f) => (
            <option key={f.chave} value={f.chave}>{f.rotulo} ({contagem[f.chave]})</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground ml-auto">{num(linhas.length)} clientes</span>
      </div>

      {familia !== "todas" && META[familia] && (
        <p className="text-xs text-muted-foreground px-1">{META[familia].explica}</p>
      )}

      {/* Selecionar tudo o que está filtrado + o que fazer com a seleção. Fica
          acima da lista porque é daqui que se decide o lote. */}
      {linhas.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox"
              checked={selecionaveis.length > 0 && selecionaveis.every((l) => selecionados.has(l.id))}
              ref={(el) => { if (el) el.indeterminate =
                selecionados.size > 0 && !selecionaveis.every((l) => selecionados.has(l.id)); }}
              onChange={(e) => setSelecionados(e.target.checked
                ? new Set(selecionaveis.map((l) => l.id)) : new Set())} />
            Selecionar {num(selecionaveis.length)} com correção automática
          </label>
          {selecionados.size > 0 && (
            <>
              <span className="text-muted-foreground">{num(selecionados.size)} selecionados</span>
              <Button size="sm" onClick={() => {
                const escolhidos = linhas.filter((l) => selecionados.has(l.id));
                setConfirmar({
                  linhas: escolhidos,
                  // Começa com tudo o que dá, e o dinheiro fica visível para
                  // desmarcar: atualizar só o custo é caso comum.
                  escolhidas: new Set(escolhidos.flatMap(acoesDe)),
                });
              }}>
                <Wand2 className="h-3 w-3" /> Atualizar {num(selecionados.size)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelecionados(new Set())}>
                Limpar seleção
              </Button>
            </>
          )}
        </div>
      )}

      {linhas.length === 0 ? (
        <Vazio>
          {recon.length === 0
            ? <>O espelho ainda não foi puxado. Vá em <strong>Sincronização</strong>.</>
            : "Nada pendente com esses filtros."}
        </Vazio>
      ) : (
        <div className="rounded-lg border divide-y">
          {linhas.slice(0, 300).map((r) => {
            const abertoAqui = aberta === r.id;
            const nome = r.razao_social_ds ?? r.razao_social_hiper ?? "—";
            const fil = (r.detalhe?.filiais ?? {}) as any;
            const mods = (r.detalhe?.modulos ?? {}) as any;
            const aplicaveis = acoesDe(r);
            return (
              <div key={r.id} className={selecionados.has(r.id) ? "bg-primary/5" : undefined}>
                <div className="flex items-start gap-2 pl-3">
                  <input type="checkbox" className="mt-3.5 shrink-0"
                    disabled={aplicaveis.length === 0}
                    title={aplicaveis.length === 0
                      ? "Nada nesta linha pode ser gravado automaticamente"
                      : undefined}
                    checked={selecionados.has(r.id)}
                    onChange={() => alternar(r.id)} />
                <button type="button" onClick={() => setAberta(abertoAqui ? null : r.id)}
                  className="flex w-full items-start gap-3 py-3 pr-3 text-left hover:bg-muted/30 transition-colors">
                  <ChevronRight className={`h-4 w-4 mt-0.5 shrink-0 text-muted-foreground transition-transform ${abertoAqui ? "rotate-90" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {cnpjMask(r.cnpj_norm ?? r.cnpj_ds)} · {nomeTipo(r.responsavel_tipo)}
                      {r.situacao_hiper && ` · ${r.situacao_hiper} no Hiper`}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {r.divergencias.map((d) => (
                        <Badge key={d} variant="secondary" className="text-[10px] font-normal">
                          {META[d]?.rotulo ?? d}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {r.status_usuario !== "pendente" && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {r.status_usuario === "resolvido" ? "Resolvida" : "Ignorada"}
                    </Badge>
                  )}
                </button>
                </div>

                {abertoAqui && (
                  <div className="border-t bg-muted/20 p-4 space-y-4 text-sm">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Mensalidade <Origem lado="ds" /></p>
                        <p className="tabular-nums font-medium">{brl(r.mensalidade_ds)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">MRR <Origem lado="hiper" /></p>
                        <p className="tabular-nums font-medium">
                          {r.mrr_hiper == null
                            ? <span className="text-muted-foreground font-normal">o portal não sabe o preço</span>
                            : brl(noPeriodo(r.mrr_hiper, r.fator_periodo) ?? r.mrr_hiper)}
                        </p>
                        {r.mrr_hiper != null && rotuloPeriodo(r.fator_periodo) && (
                          <p className="text-[10px] text-muted-foreground">
                            {brl(r.mrr_hiper)}/mês {rotuloPeriodo(r.fator_periodo)}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Custo <Origem lado="ds" /></p>
                        <p className="tabular-nums font-medium">{brl(r.custo_ds)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Custo <Origem lado="hiper" /></p>
                        <p className="tabular-nums font-medium">
                          {r.custo_hiper == null ? "—" : brl(noPeriodo(r.custo_hiper, r.fator_periodo) ?? r.custo_hiper)}
                        </p>
                        {r.custo_hiper != null && rotuloPeriodo(r.fator_periodo) && (
                          <p className="text-[10px] text-muted-foreground">
                            {brl(r.custo_hiper)}/mês {rotuloPeriodo(r.fator_periodo)}
                          </p>
                        )}
                      </div>
                    </div>

                    {r.divergencias.includes("tipo_contrato_ausente") && (
                      <p className="text-muted-foreground">
                        O portal diz <strong>{nomeTipo(r.responsavel_tipo)}</strong> e o contrato aqui
                        está sem modelo. Defina o modelo na ficha do cliente — enquanto isso, nenhuma
                        regra de valor se aplica a ele.
                      </p>
                    )}
                    {r.divergencias.includes("tipo_contrato_divergente") && (
                      <p className="text-muted-foreground">
                        O portal diz <strong>{nomeTipo(r.responsavel_tipo)}</strong>; aqui está{" "}
                        <strong>{r.modelo_contrato_ds ?? "—"}</strong>.
                      </p>
                    )}

                    {Array.isArray(fil.faltando) && fil.faltando.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Filiais que só existem no Hiper</p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {fil.faltando.map((f: any) => (
                            <li key={f.cnpj}>{cnpjMask(f.cnpj)} — {f.nome}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(fil.com_valor) && fil.com_valor.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">
                          Filiais com valor próprio ({brl(fil.com_valor.reduce((a: number, f: any) => a + Number(f.mrr ?? 0), 0))} no total)
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Se a matriz já carrega o total do grupo, este valor está sendo contado duas
                          vezes. Se a filial paga a própria conta, registre — e ela para de aparecer.
                        </p>
                        <div className="space-y-1.5">
                          {fil.com_valor.map((f: any) => (
                            <div key={f.cliente_id} className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1.5">
                              <span className="min-w-0 flex-1 truncate">{f.nome}</span>
                              <span className="tabular-nums text-xs">{brl(f.mrr)} MRR · {brl(f.custo)} custo</span>
                              <Button size="sm" variant="outline" disabled={ocupado === f.cliente_id}
                                onClick={() => decidirFilial(f.cliente_id, "paga_propria_conta")}>
                                {ocupado === f.cliente_id && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                                Paga a própria conta
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {Array.isArray(fil.conta_propria) && fil.conta_propria.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Amarradas como filial, mas são conta própria no Hiper</p>
                        <div className="space-y-1.5">
                          {fil.conta_propria.map((f: any) => (
                            <div key={f.cliente_id} className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1.5">
                              <span className="min-w-0 flex-1 truncate">{f.nome} · {cnpjMask(f.cnpj)}</span>
                              <Button size="sm" variant="outline" disabled={ocupado === f.cliente_id}
                                onClick={() => decidirFilial(f.cliente_id, "cliente_proprio")}>
                                Tratar como cliente próprio
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {Array.isArray(fil.sem_matriz) && fil.sem_matriz.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Filiais sem a matriz certa</p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {fil.sem_matriz.map((f: any) => (
                            <li key={f.cliente_id}>{f.nome} — {cnpjMask(f.cnpj)}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(fil.duplicado) && fil.duplicado.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Cadastro repetido (mesmo CNPJ da matriz)</p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {fil.duplicado.map((f: any) => <li key={f.cliente_id}>{f.nome}</li>)}
                        </ul>
                      </div>
                    )}

                    {(mods.a_mais || mods.a_menos || mods.custo) && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        {mods.a_mais && (
                          <div>
                            <p className="font-medium mb-1">Só no Hiper</p>
                            <ul className="text-muted-foreground space-y-0.5">
                              {mods.a_mais.map((m: any) => <li key={m.nome}>{m.nome} · {brl(m.custo)}</li>)}
                            </ul>
                          </div>
                        )}
                        {mods.a_menos && (
                          <div>
                            <p className="font-medium mb-1">Só aqui</p>
                            <ul className="text-muted-foreground space-y-0.5">
                              {mods.a_menos.map((m: any) => <li key={m.nome}>{m.nome} · {brl(m.custo)}</li>)}
                            </ul>
                          </div>
                        )}
                        {mods.custo && (
                          <div>
                            <p className="font-medium mb-1">Custo diferente</p>
                            <ul className="text-muted-foreground space-y-0.5">
                              {mods.custo.map((m: any) => (
                                <li key={m.nome}>{m.nome}: {brl(m.ds)} aqui · {brl(m.hiper)} lá</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {aplicaveis.length > 0 && (
                        <Button size="sm" disabled={!!ocupado}
                          onClick={() => setConfirmar({ linhas: [r], escolhidas: new Set(aplicaveis) })}>
                          {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                          Atualizar no DoctorSaaS
                          {aplicaveis.length > 1 && ` (${aplicaveis.length})`}
                        </Button>
                      )}

                      {/* Nova aba de propósito: a lista de divergências costuma ser
                          percorrida inteira, e navegar para fora perderia o lugar. */}
                      {r.ds_cliente_id && (
                        <Button asChild size="sm" variant="outline">
                          <a href={`/clientes/${r.ds_cliente_id}`} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3 w-3" /> Abrir cadastro
                          </a>
                        </Button>
                      )}

                      {r.status_usuario === "pendente" ? (
                        <>
                          <Button size="sm" variant="ghost" disabled={ocupado === r.id}
                            onClick={() => marcar(r.id, "resolvido")}>
                            <Check className="h-3 w-3" /> Já resolvi por fora
                          </Button>
                          <Button size="sm" variant="ghost" disabled={ocupado === r.id}
                            onClick={() => marcar(r.id, "ignorado")}>
                            <EyeOff className="h-3 w-3" /> Ignorar
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={ocupado === r.id}
                          onClick={() => marcar(r.id, "pendente")}>
                          Reabrir
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <strong>Atualizar</strong> grava no cadastro daqui o que o portal diz.{" "}
                      <strong>Já resolvi por fora</strong> e <strong>Ignorar</strong> não mexem em
                      nada: só tiram a linha da lista, e ela volta sozinha se o conjunto de
                      divergências deste cliente mudar no próximo espelho.
                      {aplicaveis.length === 0 && (
                        <> Nesta linha não há o que gravar automaticamente — filial mexe na árvore
                        de cadastro e conta sem dono não tem onde escrever.</>
                      )}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {linhas.length > 300 && (
            <div className="p-3 text-center text-xs text-muted-foreground">
              Mostrando as 300 primeiras de {num(linhas.length)}. Use os filtros para chegar no resto.
            </div>
          )}
        </div>
      )}

      {/* Confirmação com o antes e o depois de CADA campo. O botão é um clique,
          mas nenhum valor muda sem estar escrito na tela primeiro. */}
      {/* Cada ação é uma caixa. Atualizar só o custo e deixar a mensalidade de
          fora é caso comum, e antes era tudo-ou-nada. */}
      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar && confirmar.linhas.length === 1
                ? `Atualizar ${confirmar.linhas[0].razao_social_ds ?? confirmar.linhas[0].razao_social_hiper}`
                : `Atualizar ${num(confirmar?.linhas.length)} clientes`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>Escolha o que o cadastro daqui passa a ter do portal:</p>
                <ul className="space-y-2">
                  {ACOES.filter((a) => confirmar?.linhas.some((l) => acoesDe(l).includes(a.acao)))
                    .map((a) => {
                      const alvo = confirmar!.linhas.filter((l) => acoesDe(l).includes(a.acao));
                      const marcada = confirmar!.escolhidas.has(a.acao);
                      return (
                        <li key={a.acao} className="rounded border bg-muted/40 px-2.5 py-2">
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input type="checkbox" className="mt-1 shrink-0" checked={marcada}
                              onChange={() => setConfirmar((c) => {
                                if (!c) return c;
                                const e = new Set(c.escolhidas);
                                e.has(a.acao) ? e.delete(a.acao) : e.add(a.acao);
                                return { ...c, escolhidas: e };
                              })} />
                            <span className="min-w-0">
                              <span className="font-medium text-foreground">{a.rotulo}</span>
                              <span className="text-foreground">
                                {confirmar!.linhas.length === 1
                                  ? ` — ${a.detalhe(confirmar!.linhas[0])}`
                                  : ` — ${num(alvo.length)} ${alvo.length === 1 ? "cliente" : "clientes"}`}
                              </span>
                              {a.efeito && <span className="block text-xs mt-0.5">{a.efeito}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                </ul>
                <p className="text-xs">
                  Quem não puder receber uma dessas — contrato anual, mais de um contrato Hiper —
                  é pulado com o motivo, e o resto grava normalmente.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={!!ocupado || !confirmar?.escolhidas.size}
              onClick={(e) => { e.preventDefault(); aplicar(); }}>
              {ocupado && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Atualizar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
