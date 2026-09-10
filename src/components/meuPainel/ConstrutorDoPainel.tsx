import { useEffect, useMemo, useState } from "react";
import { GripVertical, Plus, Search, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { kpiCatalog, type CatalogEntry, type KpiArea } from "@/lib/kpiCatalog";
import kpiHelp from "@/lib/kpiHelp";
import {
  MAX_ITENS, MAX_SECOES, contarItens, validarLayout,
  type DashboardLayout, type LayoutSecao,
} from "@/lib/dashboardLayout";
import { useUserDashboard } from "@/hooks/useUserDashboard";
import { FILTROS_PADRAO, ROTULO_PERIODO } from "./filtrosDaSecao";

const AREAS: { id: KpiArea; nome: string }[] = [
  { id: "atendimento", nome: "Atendimento" },
  { id: "financeiro", nome: "Financeiro / MRR" },
  { id: "cs", nome: "Customer Success" },
  { id: "implantacao", nome: "Implantação" },
  { id: "certificados", nome: "Certificados A1" },
];

const NOME_AREA = Object.fromEntries(AREAS.map((a) => [a.id, a.nome])) as Record<KpiArea, string>;

const COR_AREA: Record<KpiArea, string> = {
  atendimento: "bg-sky-500/15 text-sky-300",
  financeiro: "bg-green-500/15 text-green-300",
  cs: "bg-violet-500/15 text-violet-300",
  implantacao: "bg-amber-500/15 text-amber-300",
  certificados: "bg-slate-500/15 text-slate-300",
};

function novoId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function secaoNova(): LayoutSecao {
  return {
    id: novoId(),
    nome: "Nova seção",
    filtros: { ...FILTROS_PADRAO },
    itens: [],
  };
}

/** Áreas presentes numa seção, deduzidas dos itens escolhidos. A seção não
 *  tem mais área fixa: ela é o que o gestor colocou dentro. */
function areasDaSecao(secao: LayoutSecao, porId: Map<string, CatalogEntry>): KpiArea[] {
  const vistas = new Set<KpiArea>();
  for (const it of secao.itens) {
    const e = porId.get(it.id);
    if (e) vistas.add(e.area);
  }
  return AREAS.map((a) => a.id).filter((a) => vistas.has(a));
}

export function ConstrutorDoPainel({
  aberto, onFechar,
}: {
  aberto: boolean;
  onFechar: () => void;
}) {
  const { layout, salvar, isSaving } = useUserDashboard();
  const { toast } = useToast();

  const [rascunho, setRascunho] = useState<DashboardLayout>(layout);
  const [selecionada, setSelecionada] = useState(0);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<"tudo" | "card" | "chart">("tudo");
  const [areaFiltro, setAreaFiltro] = useState<KpiArea | "todas">("todas");

  const porId = useMemo(() => new Map(kpiCatalog.map((e) => [e.id, e])), []);

  /** O rascunho nasce do que está salvo toda vez que o diálogo abre —
   *  cancelar tem que jogar fora as mudanças, não guardá-las para a próxima. */
  useEffect(() => {
    if (aberto) {
      setRascunho(layout);
      setSelecionada(0);
      setBusca("");
      setTipo("tudo");
      setAreaFiltro("todas");
    }
  }, [aberto, layout]);

  const secao = rascunho.secoes[selecionada];
  const total = contarItens(rascunho);
  const cheio = total >= MAX_ITENS;

  /** O catálogo é o do sistema inteiro, agrupado por área. A seção pode
   *  misturar áreas: cada indicador responde aos filtros que a área dele
   *  aceita, e o cabeçalho da seção só mostra os filtros que valem. */
  const grupos = useMemo(() => {
    const termo = busca.toLowerCase().trim();
    const passa = (e: CatalogEntry) => {
      if (tipo !== "tudo" && e.kind !== tipo) return false;
      if (areaFiltro !== "todas" && e.area !== areaFiltro) return false;
      if (!termo) return true;
      const def = e.helpKey ? (kpiHelp[e.helpKey]?.definition ?? "") : "";
      return `${e.label} ${def}`.toLowerCase().includes(termo);
    };
    return AREAS.map((a) => ({
      area: a.id,
      nome: a.nome,
      itens: kpiCatalog.filter((e) => e.area === a.id && passa(e)),
    })).filter((g) => g.itens.length > 0);
  }, [busca, tipo, areaFiltro]);

  const totalVisivel = grupos.reduce((n, g) => n + g.itens.length, 0);

  function alternarItem(entrada: CatalogEntry) {
    setRascunho((r) => ({
      ...r,
      secoes: r.secoes.map((s, i) => {
        if (i !== selecionada) return s;
        const jaTem = s.itens.some((it) => it.id === entrada.id);
        return jaTem
          ? { ...s, itens: s.itens.filter((it) => it.id !== entrada.id) }
          : { ...s, itens: [...s.itens, { id: entrada.id }] };
      }),
    }));
  }

  function adicionarSecao() {
    setRascunho((r) => {
      if (r.secoes.length >= MAX_SECOES) return r;
      setSelecionada(r.secoes.length);
      return { ...r, secoes: [...r.secoes, secaoNova()] };
    });
  }

  function removerSecao(i: number) {
    setRascunho((r) => ({ ...r, secoes: r.secoes.filter((_, k) => k !== i) }));
    setSelecionada(0);
  }

  function renomear(i: number, nome: string) {
    setRascunho((r) => ({
      ...r,
      secoes: r.secoes.map((s, k) => (k === i ? { ...s, nome } : s)),
    }));
  }

  function mudarFiltro(campo: string, valor: unknown) {
    setRascunho((r) => ({
      ...r,
      secoes: r.secoes.map((s, k) =>
        k === selecionada ? { ...s, filtros: { ...s.filtros, [campo]: valor } } : s,
      ),
    }));
  }

  async function confirmar() {
    const v = validarLayout(rascunho);
    if (v.ok === false) {
      toast({ title: "Não deu para salvar", description: v.erro, variant: "destructive" });
      return;
    }
    try {
      await salvar(rascunho);
      toast({ title: "Painel salvo" });
      onFechar();
    } catch (e) {
      toast({
        title: "Não deu para salvar",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      {/* Os `!` não são estilo: o DialogContent do projeto já traz
          `grid`, `gap-4`, `p-6`, `max-w-lg`, `max-h-[calc(100dvh-2rem)]` e
          `overflow-y-auto`. Sem forçar precedência, o `grid` dele vence o
          nosso `flex` (na folha do Tailwind `.grid` vem depois de `.flex`) e,
          pior, o `overflow-y-auto` faz o DIÁLOGO INTEIRO rolar — foi isso que
          empurrou o cabeçalho para fora da tela. Aqui o container não rola:
          quem rola é a lista lá dentro.

          O `top-[3vh]` com `translate-y-0` tira a centralização da conta: o
          topo do diálogo fica ancorado a 3vh do alto da tela, então nenhuma
          combinação de altura, animação de entrada ou rolagem consegue
          empurrar o cabeçalho para fora. */}
      <DialogContent className="!flex !top-[3vh] !translate-y-0 h-[90vh] !max-h-[90vh] w-[min(1100px,95vw)] !max-w-none !flex-col !gap-0 !overflow-hidden !p-0">
        {/* `sticky` além de `shrink-0`: cinto e suspensório. Se algum dia
            algo voltar a rolar aqui dentro, o título continua visível. */}
        <DialogHeader className="sticky top-0 z-20 shrink-0 border-b border-border bg-background px-5 py-3">
          <DialogTitle className="text-base">Montar o meu painel</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[250px_1fr]">
          {/* ----- seções ----- */}
          <aside className="min-h-0 space-y-2 overflow-y-auto border-b border-border p-3 md:border-b-0 md:border-r">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Seções do painel
            </p>

            {rascunho.secoes.map((s, i) => {
              const areas = areasDaSecao(s, porId);
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelecionada(i)}
                  onKeyDown={(e) => e.key === "Enter" && setSelecionada(i)}
                  className={`cursor-pointer rounded-lg border p-2.5 transition-colors ${
                    i === selecionada ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <Input
                      value={s.nome}
                      onChange={(e) => renomear(i, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-7 border-0 bg-transparent px-1 text-[13px] font-semibold focus-visible:ring-1"
                    />
                    <button
                      type="button"
                      aria-label={`Remover a seção ${s.nome}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removerSecao(i);
                      }}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 pl-6">
                    {areas.map((a) => (
                      <span
                        key={a}
                        className={`rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide ${COR_AREA[a]}`}
                      >
                        {NOME_AREA[a]}
                      </span>
                    ))}
                    <span className="text-[11px] text-muted-foreground">
                      {s.itens.length} selecionados
                    </span>
                  </div>
                </div>
              );
            })}

            {rascunho.secoes.length < MAX_SECOES && (
              <button
                type="button"
                onClick={adicionarSecao}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-[12.5px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova seção
              </button>
            )}
          </aside>

          {/* ----- catálogo ----- */}
          <div className="flex min-h-0 flex-col overflow-hidden p-3">
            {!secao ? (
              <p className="p-6 text-sm text-muted-foreground">
                Crie uma seção para escolher os indicadores dela.
              </p>
            ) : (
              <>
                <div className="shrink-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[190px] flex-1">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar indicador ou gráfico…"
                        className="h-8 pl-8 text-[13px]"
                      />
                    </div>
                    <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
                      <SelectTrigger className="h-8 w-[150px] text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tudo">Tudo</SelectItem>
                        <SelectItem value="card">Só indicadores</SelectItem>
                        <SelectItem value="chart">Só gráficos</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(secao.filtros.periodo ?? "mes_atual")}
                      onValueChange={(v) => mudarFiltro("periodo", v)}
                    >
                      <SelectTrigger className="h-8 w-[150px] text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROTULO_PERIODO).map(([k, r]) => (
                          <SelectItem key={k} value={k}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAreaFiltro("todas")}
                      aria-pressed={areaFiltro === "todas"}
                      className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                        areaFiltro === "todas"
                          ? "border-transparent bg-primary/15 font-semibold text-primary"
                          : "border-border text-muted-foreground hover:border-muted-foreground"
                      }`}
                    >
                      Todas as áreas{" "}
                      <span className="font-mono opacity-70">{kpiCatalog.length}</span>
                    </button>
                    {AREAS.map((a) => {
                      const n = kpiCatalog.filter((e) => e.area === a.id).length;
                      const on = areaFiltro === a.id;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setAreaFiltro(a.id)}
                          aria-pressed={on}
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                            on
                              ? "border-transparent bg-primary/15 font-semibold text-primary"
                              : "border-border text-muted-foreground hover:border-muted-foreground"
                          }`}
                        >
                          {a.nome} <span className="font-mono opacity-70">{n}</span>
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-[11.5px] text-muted-foreground">
                    Escolhendo para a seção <b className="text-foreground">{secao.nome}</b> ·{" "}
                    {totalVisivel} de {kpiCatalog.length} itens. Uma seção pode misturar áreas;
                    cada indicador responde aos filtros que a área dele aceita.
                  </p>
                </div>

                <div className="mt-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                  {grupos.map((g) => (
                    <div key={g.area}>
                      <p className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur">
                        {g.nome}{" "}
                        <span className="font-mono font-normal opacity-70">{g.itens.length}</span>
                      </p>
                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {g.itens.map((e) => {
                          const marcado = secao.itens.some((it) => it.id === e.id);
                          const bloqueado = e.pending || (!marcado && cheio);
                          const def = e.helpKey ? (kpiHelp[e.helpKey]?.definition ?? "") : "";
                          return (
                            <label
                              key={e.id}
                              className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${
                                marcado ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                              } ${bloqueado ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                            >
                              <Checkbox
                                checked={marcado}
                                disabled={bloqueado}
                                onCheckedChange={() => alternarItem(e)}
                                className="mt-0.5"
                              />
                              <span className="min-w-0">
                                <span className="block text-[12.5px] font-semibold leading-tight">
                                  {e.label}
                                  {e.kind === "chart" && (
                                    <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 align-middle text-[8.5px] font-bold uppercase tracking-wide text-muted-foreground">
                                      {e.pending ? "em breve" : "gráfico"}
                                    </span>
                                  )}
                                </span>
                                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                                  {def || "Sem texto de ajuda."}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {grupos.length === 0 && (
                    <p className="p-4 text-sm text-muted-foreground">
                      Nenhum item com esse filtro.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-[12.5px] text-muted-foreground">
            <b className="font-mono tabular-nums text-foreground">
              {total} / {MAX_ITENS}
            </b>{" "}
            indicadores
            {cheio && " · limite atingido"}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onFechar}>
              Cancelar
            </Button>
            <Button size="sm" onClick={confirmar} disabled={isSaving}>
              {isSaving ? "Salvando…" : "Salvar painel"}
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
