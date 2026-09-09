import { useEffect, useMemo, useState } from "react";
import { GripVertical, Plus, Search, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { entradasDaArea, type CatalogEntry, type KpiArea } from "@/lib/kpiCatalog";
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

function novoId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function secaoNova(area: KpiArea): LayoutSecao {
  return {
    id: novoId(),
    nome: AREAS.find((a) => a.id === area)?.nome ?? "Nova seção",
    area,
    filtros: { ...FILTROS_PADRAO },
    itens: [],
  };
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

  /** O rascunho nasce do que está salvo toda vez que o diálogo abre —
   *  cancelar tem que jogar fora as mudanças, não guardá-las para a próxima. */
  useEffect(() => {
    if (aberto) {
      setRascunho(layout);
      setSelecionada(0);
      setBusca("");
      setTipo("tudo");
    }
  }, [aberto, layout]);

  const secao = rascunho.secoes[selecionada];
  const total = contarItens(rascunho);
  const cheio = total >= MAX_ITENS;

  const catalogo = useMemo(() => {
    if (!secao) return [] as CatalogEntry[];
    const termo = busca.toLowerCase().trim();
    return entradasDaArea(secao.area).filter((e) => {
      if (tipo !== "tudo" && e.kind !== tipo) return false;
      if (!termo) return true;
      const def = e.helpKey ? (kpiHelp[e.helpKey]?.definition ?? "") : "";
      return `${e.label} ${def}`.toLowerCase().includes(termo);
    });
  }, [secao, busca, tipo]);

  function alternarItem(entrada: CatalogEntry) {
    setRascunho((r) => {
      const secoes = r.secoes.map((s, i) => {
        if (i !== selecionada) return s;
        const jaTem = s.itens.some((it) => it.id === entrada.id);
        if (jaTem) return { ...s, itens: s.itens.filter((it) => it.id !== entrada.id) };
        return { ...s, itens: [...s.itens, { id: entrada.id }] };
      });
      return { ...r, secoes };
    });
  }

  function adicionarSecao(area: KpiArea) {
    setRascunho((r) => {
      if (r.secoes.length >= MAX_SECOES) return r;
      return { ...r, secoes: [...r.secoes, secaoNova(area)] };
    });
    setSelecionada(rascunho.secoes.length);
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
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="text-base">Montar o meu painel</DialogTitle>
        </DialogHeader>

        <div className="grid max-h-[62vh] grid-cols-1 md:grid-cols-[250px_1fr]">
          {/* ----- seções ----- */}
          <aside className="space-y-2 overflow-y-auto border-b border-border p-3 md:border-b-0 md:border-r">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Seções do painel
            </p>

            {rascunho.secoes.map((s, i) => (
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
                <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
                  {AREAS.find((a) => a.id === s.area)?.nome} · {s.itens.length} selecionados
                </p>
              </div>
            ))}

            {rascunho.secoes.length < MAX_SECOES && (
              <Select onValueChange={(v) => adicionarSecao(v as KpiArea)} value="">
                <SelectTrigger className="h-9 border-dashed text-[13px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    Nova seção
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {AREAS.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[190px]">
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
                    value={String(secao.filtros.periodo ?? "hoje")}
                    onValueChange={(v) => mudarFiltro("periodo", v)}
                  >
                    <SelectTrigger className="h-8 w-[160px] text-[12.5px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROTULO_PERIODO).map(([k, r]) => (
                        <SelectItem key={k} value={k}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <p className="mb-2 text-[11.5px] text-muted-foreground">
                  Seção <b className="text-foreground">{secao.nome}</b> · o catálogo segue a área
                  dela, para nenhum card ignorar o filtro em silêncio.
                </p>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
                  {catalogo.map((e) => {
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
                  {catalogo.length === 0 && (
                    <p className="p-4 text-sm text-muted-foreground">
                      Nenhum item com esse filtro.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-border px-5 py-3">
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
