import { useMemo, useState } from "react";
import {
  useRbacConfig, RECURSOS_SEM_PORTAO, NIVEL_LABEL, ESCOPO_LABEL,
  type Nivel, type RbacGrupo, type RbacRecurso,
} from "@/hooks/useRbacConfig";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lock, Copy, Users, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Células que nem a tela nem o banco permitem desmarcar (anti-lockout). */
function travada(g: RbacGrupo, key: string, acao: string) {
  if (g.nivel_base !== "admin") return false;
  return (key === "cfg.permissoes" && (acao === "view" || acao === "update"))
      || (key === "cfg.acessos" && acao === "view")
      || (key === "usuarios_roles" && acao === "update");
}

export default function GruposPermissoesContent() {
  const { config, isLoading, setPermissao, setNivel, duplicarGrupo } = useRbacConfig();
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [rebaixar, setRebaixar] = useState<{ moduleId: string; nivel: Nivel } | null>(null);
  const [novoNome, setNovoNome] = useState("");

  const grupo = useMemo(
    () => config?.grupos.find((g) => g.id === grupoId) ?? config?.grupos[0],
    [config, grupoId],
  );

  const mapa = useMemo(() => {
    const m = new Map<string, { view: boolean; escopo: string }>();
    if (!config || !grupo) return m;
    for (const p of config.permissoes) {
      if (p.group_id === grupo.id) m.set(p.key, { view: p.view, escopo: p.escopo });
    }
    return m;
  }, [config, grupo]);

  if (isLoading || !config || !grupo) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  const porModulo = (moduleId: string, nivel: Nivel) =>
    config.recursos
      .filter((r) => r.module_id === moduleId && r.nivel <= nivel)
      .sort((a, b) => a.ordem - b.ordem);

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
              <button
                key={g.id}
                onClick={() => setGrupoId(g.id)}
                aria-pressed={g.id === grupo.id}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                  g.id === grupo.id ? "border-border bg-card shadow-sm" : "border-transparent hover:bg-muted",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {g.nome}
                  {g.is_system && <Badge variant="outline" className="h-4 px-1 text-[9px]">base</Badge>}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  {g.membros} {g.membros === 1 ? "pessoa" : "pessoas"} · nível {g.nivel_base}
                </span>
              </button>
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
            <p className="text-xs tabular-nums text-muted-foreground">
              {liberados} de {config.recursos.length} recursos liberados
            </p>
          </div>

          {config.modulos.map((mod) => {
            const itens = porModulo(mod.id, mod.nivel);
            const total = config.recursos.filter((r) => r.module_id === mod.id).length;
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
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-3 py-2 text-left font-semibold">Recurso</th>
                            <th className="w-20 px-3 py-2 text-left font-semibold">Ver</th>
                            {mod.nivel >= 3 && <th className="w-44 px-3 py-2 text-left font-semibold">Quais linhas</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {itens.map((r: RbacRecurso) => {
                            const est = mapa.get(r.key);
                            const on = !!est?.view;
                            const lock = travada(grupo, r.key, "view");
                            const semPortao = RECURSOS_SEM_PORTAO.has(r.key);
                            return (
                              <tr key={r.key} className="border-b last:border-b-0">
                                <td className={cn("px-3 py-2", r.parent_key && "pl-8")}>
                                  <span className="flex flex-wrap items-center gap-1.5 font-medium">
                                    {r.label}
                                    {semPortao && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex items-center gap-1 rounded border border-dashed border-amber-500 px-1.5 py-px text-[10px] text-amber-600 dark:text-amber-400">
                                            <AlertTriangle className="h-3 w-3" /> ainda não aplicado
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                          Este recurso está no catálogo mas nenhuma tela o consulta ainda.
                                          Alterá-lo não muda o acesso de ninguém até a entrega que o liga.
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                  </span>
                                  <span className="block font-mono text-[11px] text-muted-foreground">{r.key}</span>
                                </td>
                                <td className="px-3 py-2">
                                  <span className="flex items-center gap-2">
                                    <Switch
                                      checked={on}
                                      disabled={lock || setPermissao.isPending}
                                      onCheckedChange={(v) =>
                                        setPermissao.mutate({ groupId: grupo.id, key: r.key, acao: "view", valor: v })
                                      }
                                      aria-label={`Ver ${r.label}`}
                                    />
                                    {lock && (
                                      <Tooltip>
                                        <TooltipTrigger asChild><Lock className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                                        <TooltipContent>
                                          Anti-lockout: o grupo de administração nunca perde este acesso.
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                  </span>
                                </td>
                                {mod.nivel >= 3 && (
                                  <td className="px-3 py-2 text-xs text-muted-foreground">
                                    {ESCOPO_LABEL[(est?.escopo ?? "todos") as keyof typeof ESCOPO_LABEL]}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>

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
