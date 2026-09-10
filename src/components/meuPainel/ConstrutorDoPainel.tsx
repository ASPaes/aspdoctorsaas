import { useEffect, useMemo, useState } from "react";
import { Check, GripVertical, Plus, Search, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const AREAS: { id: KpiArea; nome: string; curto: string }[] = [
  { id: "atendimento", nome: "Atendimento", curto: "Atendimento" },
  { id: "financeiro", nome: "Financeiro / MRR", curto: "Financeiro" },
  { id: "cs", nome: "Customer Success", curto: "CS" },
  { id: "implantacao", nome: "Implantação", curto: "Implantação" },
  { id: "certificados", nome: "Certificados A1", curto: "Certificados" },
];

const CURTO = Object.fromEntries(AREAS.map((a) => [a.id, a.curto])) as Record<KpiArea, string>;

const COR_AREA: Record<KpiArea, string> = {
  atendimento: "bg-sky-500/15 text-sky-400",
  financeiro: "bg-green-500/15 text-green-400",
  cs: "bg-violet-500/15 text-violet-400",
  implantacao: "bg-amber-500/15 text-amber-400",
  certificados: "bg-slate-500/20 text-slate-300",
};

function novoId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function secaoNova(): LayoutSecao {
  return { id: novoId(), nome: "Nova seção", filtros: { ...FILTROS_PADRAO }, itens: [] };
}

/** Áreas presentes numa seção, deduzidas dos itens. A seção não tem área
 *  fixa: ela é o que o gestor colocou dentro. */
function areasDe(secao: LayoutSecao, porId: Map<string, CatalogEntry>): KpiArea[] {
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

  /** O rascunho nasce do que está salvo toda vez que abre — cancelar tem que
   *  jogar fora as mudanças, não guardá-las para a próxima. */
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

  function mudarPeriodo(valor: string) {
    setRascunho((r) => ({
      ...r,
      secoes: r.secoes.map((s, k) =>
        k === selecionada ? { ...s, filtros: { ...s.filtros, periodo: valor } } : s,
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
      {/* TELA CHEIA de propósito. O DialogContent compartilhado traz
          `grid`, `p-6`, `gap-4`, `max-w-lg`, `max-h-[calc(100dvh-2rem)]`,
          `overflow-y-auto` e centralização por translate. Cada uma dessas
          brigava com o layout e o resultado era cabeçalho cortado. Aqui a
          gente neutraliza TODAS de uma vez e ancora nos quatro cantos: não
          existe mais conta de centralização para dar errado, e um catálogo de
          176 itens ganha o espaço que precisa. */}
      <DialogContent
        className="!fixed !inset-0 !left-0 !top-0 !flex !h-[100dvh] !max-h-none !w-screen !max-w-none !translate-x-0 !translate-y-0 !flex-col !gap-0 !overflow-hidden !rounded-none !border-0 !p-0"
      >
        {/* ---------- barra de cima ---------- */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <DialogTitle className="text-[15px] font-semibold">Montar o meu painel</DialogTitle>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Escolha até {MAX_ITENS} indicadores e gráficos, em até {MAX_SECOES} seções.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="font-mono text-[13px] font-bold tabular-nums">
                {total}
                <span className="text-muted-foreground">/{MAX_ITENS}</span>
              </span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full rounded-full transition-all ${cheio ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, (total / MAX_ITENS) * 100)}%` }}
                />
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={onFechar}>
              Cancelar
            </Button>
            <Button size="sm" onClick={confirmar} disabled={isSaving}>
              <Check className="mr-1 h-3.5 w-3.5" />
              {isSaving ? "Salvando…" : "Salvar painel"}
            </Button>
          </div>
        </header>

        {/* ---------- corpo ---------- */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* ----- rail de seções ----- */}
          <aside className="flex max-h-[38vh] shrink-0 flex-col border-b border-border lg:max-h-none lg:w-[270px] lg:border-b-0 lg:border-r">
            <p className="shrink-0 px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Seções do painel
            </p>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
              {rascunho.secoes.map((s, i) => {
                const areas = areasDe(s, porId);
                const ativa = i === selecionada;
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelecionada(i)}
                    onKeyDown={(e) => e.key === "Enter" && setSelecionada(i)}
                    className={`cursor-pointer rounded-lg border p-2.5 transition-colors ${
                      ativa ? "border-primary/60 bg-primary/5" : "border-border bg-card hover:border-muted-foreground/40"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Input
                        value={s.nome}
                        onChange={(e) => renomear(i, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Nome da seção ${i + 1}`}
                        className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-[13px] font-semibold focus-visible:ring-1"
                      />
                      <button
                        type="button"
                        aria-label={`Remover a seção ${s.nome}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removerSecao(i);
                        }}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
                          {CURTO[a]}
                        </span>
                      ))}
                      <span className="text-[11px] text-muted-foreground">
                        {s.itens.length} {s.itens.length === 1 ? "item" : "itens"}
                      </span>
                    </div>
                  </div>
                );
              })}

              {rascunho.secoes.length < MAX_SECOES ? (
                <button
                  type="button"
                  onClick={adicionarSecao}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-[12.5px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nova seção
                </button>
              ) : (
                <p className="px-1 text-[11px] text-muted-foreground">
                  Você chegou ao limite de {MAX_SECOES} seções.
                </p>
              )}
            </div>
          </aside>

          {/* ----- catálogo ----- */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {!secao ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                  Crie uma seção à esquerda para começar a escolher os indicadores dela.
                </p>
              </div>
            ) : (
              <>
                {/* filtros do catálogo — sempre visíveis, nunca rolam */}
                <div className="shrink-0 space-y-2.5 border-b border-border px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[200px] flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar indicador ou gráfico…"
                        className="h-9 pl-8 text-[13px]"
                      />
                      {busca && (
                        <button
                          type="button"
                          aria-label="Limpar busca"
                          onClick={() => setBusca("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Mostrar</span>
                      <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
                        <SelectTrigger className="h-9 w-[142px] text-[12.5px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tudo">Tudo</SelectItem>
                          <SelectItem value="card">Só indicadores</SelectItem>
                          <SelectItem value="chart">Só gráficos</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Período da seção</span>
                      <Select
                        value={String(secao.filtros.periodo ?? "mes_atual")}
                        onValueChange={mudarPeriodo}
                      >
                        <SelectTrigger className="h-9 w-[150px] text-[12.5px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(ROTULO_PERIODO).map(([k, r]) => (
                            <SelectItem key={k} value={k}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAreaFiltro("todas")}
                      aria-pressed={areaFiltro === "todas"}
                      className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
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
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
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
                    Escolhendo para <b className="text-foreground">{secao.nome}</b> ·{" "}
                    {totalVisivel} de {kpiCatalog.length} itens · uma seção pode misturar áreas,
                    e cada indicador responde aos filtros da área dele.
                  </p>
                </div>

                {/* lista — a ÚNICA coisa que rola */}
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {grupos.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum item com esse filtro.
                    </p>
                  ) : (
                    grupos.map((g) => (
                      <section key={g.area} className="mb-5 last:mb-0">
                        <h3 className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          <span className={`rounded px-1.5 py-0.5 ${COR_AREA[g.area]}`}>
                            {g.nome}
                          </span>
                          <span className="font-mono font-normal opacity-70">{g.itens.length}</span>
                          <span className="h-px flex-1 bg-border" />
                        </h3>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                          {g.itens.map((e) => {
                            const marcado = secao.itens.some((it) => it.id === e.id);
                            const bloqueado = e.pending || (!marcado && cheio);
                            const def = e.helpKey ? (kpiHelp[e.helpKey]?.definition ?? "") : "";
                            return (
                              <button
                                key={e.id}
                                type="button"
                                disabled={bloqueado}
                                aria-pressed={marcado}
                                onClick={() => alternarItem(e)}
                                className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                                  marcado
                                    ? "border-primary/60 bg-primary/5"
                                    : "border-border bg-card hover:border-muted-foreground/40"
                                } ${bloqueado ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                              >
                                <span
                                  aria-hidden
                                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    marcado
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-muted-foreground/40"
                                  }`}
                                >
                                  {marcado && <Check className="h-3 w-3" strokeWidth={3} />}
                                </span>
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
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
