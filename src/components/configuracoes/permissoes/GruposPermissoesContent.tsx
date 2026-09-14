import { useMemo, useState } from "react";
import {
  useRbacConfig, RECURSOS_SEM_PORTAO, NIVEL_LABEL, ESCOPO_LABEL,
  ACOES_POR_NIVEL, ACAO_LABEL, SECAO_LABEL, SECAO_ORDEM,
  type Nivel, type Acao, type Escopo, type Secao, type RbacGrupo, type RbacRecurso,
} from "@/hooks/useRbacConfig";
import LinhaRecurso, { ChipAcao } from "./LinhaRecurso";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lock, Copy, Users, ChevronDown, ChevronRight, AlertTriangle, Pencil, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ordena em árvore: cada filho vem logo abaixo do seu pai. Sem isto, um
 * recurso sem pai no meio da lista (era o caso de `clientes.exportar`) faz os
 * filhos seguintes parecerem pendurados nele.
 */
function emArvore(itens: RbacRecurso[]): RbacRecurso[] {
  const porPai = new Map<string | null, RbacRecurso[]>();
  for (const r of itens) {
    const pai = r.parent_key && itens.some((x) => x.key === r.parent_key) ? r.parent_key : null;
    const lista = porPai.get(pai) ?? [];
    lista.push(r);
    porPai.set(pai, lista);
  }
  const saida: RbacRecurso[] = [];
  const desce = (pai: string | null) => {
    for (const r of (porPai.get(pai) ?? []).sort((a, b) => a.ordem - b.ordem)) {
      saida.push(r);
      desce(r.key);
    }
  };
  desce(null);
  return saida;
}

/** Quantos níveis abaixo da raiz o recurso está, para o recuo da tabela. */
function nivelNaArvore(r: RbacRecurso, itens: RbacRecurso[]): number {
  let n = 0, atual = r;
  while (atual.parent_key) {
    const pai = itens.find((x) => x.key === atual.parent_key);
    if (!pai) break;
    n += 1; atual = pai;
    if (n > 4) break;
  }
  return n;
}

/** Células que nem a tela nem o banco permitem desmarcar (anti-lockout). */
function travada(g: RbacGrupo, key: string, acao: string) {
  if (g.nivel_base !== "admin") return false;
  return (key === "cfg.permissoes" && (acao === "view" || acao === "update"))
      || (key === "cfg.acessos" && acao === "view")
      || (key === "usuarios_roles" && acao === "update");
}

export default function GruposPermissoesContent() {
  const {
    config, isLoading, setPermissao, setEscopo, setNivel,
    duplicarGrupo, renomearGrupo, excluirGrupo,
  } = useRbacConfig();
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [rebaixar, setRebaixar] = useState<{ moduleId: string; nivel: Nivel } | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [excluindo, setExcluindo] = useState<RbacGrupo | null>(null);
  const [mostrarChaves, setMostrarChaves] = useState(false);

  const grupo = useMemo(
    () => config?.grupos.find((g) => g.id === grupoId) ?? config?.grupos[0],
    [config, grupoId],
  );

  const mapa = useMemo(() => {
    const m = new Map<string, Record<Acao, boolean> & { escopo: Escopo }>();
    if (!config || !grupo) return m;
    for (const p of config.permissoes) {
      if (p.group_id === grupo.id) {
        m.set(p.key, { view: p.view, insert: p.insert, update: p.update, delete: p.delete, escopo: p.escopo });
      }
    }
    return m;
  }, [config, grupo]);

  if (isLoading || !config || !grupo) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  const porModulo = (moduleId: string, nivel: Nivel) =>
    emArvore(config.recursos.filter((r) => r.module_id === moduleId && r.nivel <= nivel));

  const liberados = config.recursos.filter((r) => mapa.get(r.key)?.view).length;

  const pedirNivel = (moduleId: string, nivel: Nivel) => {
    const atual = config.modulos.find((m) => m.id === moduleId)?.nivel ?? 1;
    if (nivel === atual) return;
    if (nivel > atual) { setNivel.mutate({ moduleId, nivel }); return; }
    setRebaixar({ moduleId, nivel });
  };

  const saindo = rebaixar
    ? config.recursos.filter((r) => r.module_id === rebaixar.moduleId && r.nivel > rebaixar.nivel)
    : [];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* ---------------- grupos ---------------- */}
        <aside className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Grupos</p>
          <div className="space-y-1.5">
            {config.grupos.map((g) => (
              <div
                key={g.id}
                className={cn(
                  "group/item rounded-lg border px-3 py-2 transition-colors",
                  g.id === grupo.id ? "border-border bg-card shadow-sm" : "border-transparent hover:bg-muted",
                )}
              >
                {editando?.id === g.id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={editando.nome}
                      onChange={(e) => setEditando({ id: g.id, nome: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editando.nome.trim()) {
                          renomearGrupo.mutate({ groupId: g.id, nome: editando.nome.trim() });
                          setEditando(null);
                        }
                        if (e.key === "Escape") setEditando(null);
                      }}
                      className="h-7 text-xs"
                    />
                    <button
                      className="shrink-0 rounded p-1 hover:bg-muted"
                      aria-label="Salvar nome"
                      onClick={() => {
                        if (editando.nome.trim()) renomearGrupo.mutate({ groupId: g.id, nome: editando.nome.trim() });
                        setEditando(null);
                      }}
                    ><Check className="h-3.5 w-3.5" /></button>
                    <button className="shrink-0 rounded p-1 hover:bg-muted" aria-label="Cancelar"
                      onClick={() => setEditando(null)}><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setGrupoId(g.id)}
                        aria-pressed={g.id === grupo.id}
                        className="flex flex-1 items-center gap-2 text-left text-sm font-semibold"
                      >
                        {g.nome}
                        {g.is_system && <Badge variant="outline" className="h-4 px-1 text-[9px]">base</Badge>}
                      </button>
                      <button
                        className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover/item:opacity-100"
                        aria-label={`Renomear ${g.nome}`}
                        onClick={() => setEditando({ id: g.id, nome: g.nome })}
                      ><Pencil className="h-3 w-3" /></button>
                      {!g.is_system && (
                        <button
                          className="shrink-0 rounded p-1 text-destructive opacity-0 transition-opacity hover:bg-destructive/10 group-hover/item:opacity-100"
                          aria-label={`Excluir ${g.nome}`}
                          onClick={() => setExcluindo(g)}
                        ><Trash2 className="h-3 w-3" /></button>
                      )}
                    </div>
                    <button onClick={() => setGrupoId(g.id)} className="mt-0.5 flex w-full items-center gap-1 text-left text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {g.membros} {g.membros === 1 ? "pessoa" : "pessoas"} · nível {g.nivel_base}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <Input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Nome do novo grupo"
              className="h-8 text-xs"
            />
            <Button
              size="sm" variant="outline" className="w-full gap-1.5 text-xs"
              disabled={!novoNome.trim() || duplicarGrupo.isPending}
              onClick={() => { duplicarGrupo.mutate({ origemId: grupo.id, nome: novoNome.trim() }); setNovoNome(""); }}
            >
              <Copy className="h-3.5 w-3.5" />
              Duplicar “{grupo.nome}”
            </Button>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Grupo não nasce em branco: um grupo vazio não teria de onde herdar as regras.
              Duplique e ajuste o que muda.
            </p>
          </div>
        </aside>

        {/* ---------------- matriz ---------------- */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold tracking-tight">{grupo.nome}</h3>
              <p className="text-xs text-muted-foreground">
                {grupo.membros} {grupo.membros === 1 ? "pessoa" : "pessoas"} · nível base{" "}
                <b>{grupo.nivel_base}</b> · {grupo.is_system ? "não pode ser excluído" : "criado por cópia"}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={mostrarChaves}
                  onChange={(e) => setMostrarChaves(e.target.checked)}
                  className="accent-primary"
                />
                mostrar chaves técnicas
              </label>
              <p className="text-xs tabular-nums text-muted-foreground">
                {liberados} de {config.recursos.length} liberados
              </p>
            </div>
          </div>

          {config.modulos.map((mod) => {
            const itens = porModulo(mod.id, mod.nivel);
            const total = config.recursos.filter((r) => r.module_id === mod.id).length;
            // Só mostra a coluna de uma ação se o nível permite E algum item a aceita.
            // Todas as letras do nível, sempre: ação que não existe no item aparece
            // apagada, e as colunas de chips ficam alinhadas entre as linhas.
            const acoesDoModulo = ACOES_POR_NIVEL[mod.nivel];
            const mostraEscopo = mod.nivel >= 3 && itens.some((r) => r.escopo_aplicavel);
            const entrada = itens.find((r) => r.secao === "entrada");
            // Sem entrada cadastrada (módulos internos), tudo segue alcançável.
            const entradaLigada = entrada ? !!mapa.get(entrada.key)?.view : true;
            const fechado = fechados.has(mod.id);
            if (total === 0) return null;
            return (
              <Card key={mod.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                  <button
                    className="flex flex-1 items-center gap-1.5 text-left text-sm font-semibold"
                    onClick={() => {
                      const n = new Set(fechados);
                      fechado ? n.delete(mod.id) : n.add(mod.id);
                      setFechados(n);
                    }}
                  >
                    {fechado ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {mod.nome}
                  </button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {itens.length} de {total} itens
                  </span>
                  <div className="flex overflow-hidden rounded-md border">
                    {([1, 2, 3] as Nivel[]).map((n) => (
                      <Tooltip key={n}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => pedirNivel(mod.id, n)}
                            aria-pressed={n === mod.nivel}
                            className={cn(
                              "border-r px-2.5 py-1 text-[11px] font-semibold last:border-r-0 transition-colors",
                              n === mod.nivel ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                            )}
                          >
                            {n}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Nível {n} — {NIVEL_LABEL[n]}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </div>

                {!fechado && (
                  <CardContent className="p-0">
                    {/* A entrada: sem ela, nada no módulo é alcançável. */}
                    {entrada && (
                      <div className={cn(
                        "flex items-center gap-3 border-b px-3 py-2.5",
                        entradaLigada ? "bg-emerald-500/5" : "bg-muted/50",
                      )}>
                        <ChipAcao
                          acao="view"
                          existe
                          ligado={entradaLigada}
                          travado={travada(grupo, entrada.key, "view")}
                          desabilitado={setPermissao.isPending}
                          rotulo={entrada.label}
                          onChange={(v) =>
                            setPermissao.mutate({ groupId: grupo.id, key: entrada.key, acao: "view", valor: v })
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-[13px] font-semibold">
                            {entrada.label}
                            <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase tracking-wide">entrada</Badge>
                          </span>
                          <span className="text-[11.5px] text-muted-foreground">
                            {entradaLigada
                              ? "Desligue e o módulo inteiro fica inacessível para este grupo."
                              : "Desligada: nada deste módulo é alcançável."}
                          </span>
                        </div>
                      </div>
                    )}

                    {SECAO_ORDEM.filter((sec) => sec !== "entrada").map((sec) => {
                      const doSecao = itens.filter((r) => r.secao === sec);
                      if (!doSecao.length) return null;
                      return (
                        <div key={sec}>
                          <div className="px-3 pb-1 pt-2.5 text-[9.5px] font-bold uppercase tracking-[.09em] text-muted-foreground">
                            {SECAO_LABEL[sec]}
                          </div>
                          {doSecao.map((r) => (
                            <LinhaRecurso
                              key={r.key}
                              r={r}
                              estado={mapa.get(r.key)}
                              acoesVisiveis={acoesDoModulo}
                              mostraEscopo={mostraEscopo}
                              alcancavel={entradaLigada}
                              mostrarChave={mostrarChaves}
                              travada={(acao) => travada(grupo, r.key, acao)}
                              onAcao={(acao, valor) =>
                                setPermissao.mutate({ groupId: grupo.id, key: r.key, acao, valor })
                              }
                              onEscopo={(escopo) =>
                                setEscopo.mutate({ groupId: grupo.id, key: r.key, escopo })
                              }
                            />
                          ))}
                        </div>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })}

          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-4 py-2 text-[11.5px] text-muted-foreground">
            <span><b className="text-foreground">V</b> ver</span>
            <span><b className="text-foreground">I</b> inserir</span>
            <span><b className="text-foreground">E</b> editar</span>
            <span><b className="text-foreground">X</b> excluir</span>
            <span>Chip apagado = a ação não existe nesse item</span>
          </div>
        </div>
      </div>

      {/* ------------------- excluir grupo criado por cópia ------------------- */}
      <AlertDialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o grupo “{excluindo?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo && excluindo.membros > 0 ? (
                <>
                  Este grupo tem <b>{excluindo.membros} {excluindo.membros === 1 ? "pessoa" : "pessoas"}</b>.
                  Mova-as para outro grupo antes de excluir — sem grupo, elas ficariam sem acesso a nada.
                </>
              ) : (
                <>O grupo não tem ninguém. As permissões dele são descartadas e a ação não pode ser desfeita.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!excluindo || excluindo.membros > 0}
              onClick={() => { if (excluindo) excluirGrupo.mutate(excluindo.id); setExcluindo(null); setGrupoId(null); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ------------- confirmação de rebaixar nível (bug B1) ------------- */}
      <AlertDialog open={!!rebaixar} onOpenChange={(o) => !o && setRebaixar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Baixar para o nível {rebaixar?.nivel} — {NIVEL_LABEL[(rebaixar?.nivel ?? 1) as Nivel]}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {saindo.length} {saindo.length === 1 ? "item sai" : "itens saem"} da tela. Nenhum deles
                  ganha acesso: cada um é gravado com o valor <b>mais restritivo</b> entre ele e o item pai.
                </p>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {saindo.map((r) => {
                    const filho = !!mapa.get(r.key)?.view;
                    const pai = r.parent_key ? !!mapa.get(r.parent_key)?.view : filho;
                    const fim = filho && pai;
                    return (
                      <div key={r.key} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
                        <span className="flex-1 font-mono">{r.key}</span>
                        <span className={fim ? "font-semibold text-emerald-600" : "font-semibold text-destructive"}>
                          {fim ? "continua liberado" : "fica bloqueado"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (rebaixar) setNivel.mutate(rebaixar); setRebaixar(null); }}
            >
              Confirmar e gravar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
