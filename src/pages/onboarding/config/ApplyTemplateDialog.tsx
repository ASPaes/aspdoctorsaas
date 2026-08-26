import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, LayoutTemplate, Loader2, Pause } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatSlaHuman } from "./utils";
import { ONBOARDING_TEMPLATES, resumoTemplate, type OnboardingTemplate } from "./templates";
import {
  filtrarPorSelecao,
  nomesEmColisao,
  renomearColisoes,
  resolverProdutoSugerido,
  selecaoCompleta,
  type SelecaoTemplate,
} from "./templates/apply";

type CatalogKey =
  | "demand_types"
  | "training_types"
  | "pause_reasons"
  | "accounting_fields"
  | "vendor_return_reasons";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const SEM_PRODUTO = "__nenhum__";

export function ApplyTemplateDialog({ open, onOpenChange }: Props) {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();

  const [tela, setTela] = useState<"escolha" | "produto" | "revisao">("escolha");
  const [tpl, setTpl] = useState<OnboardingTemplate | null>(null);
  const [produtoId, setProdutoId] = useState<string>(SEM_PRODUTO);
  const [sel, setSel] = useState<SelecaoTemplate | null>(null);
  const [applying, setApplying] = useState(false);

  const produtosQuery = useQuery({
    queryKey: ["onb-tpl-produtos", effectiveTenantId],
    enabled: open && !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, nome")
        .eq("tenant_id", effectiveTenantId!)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: number; nome: string }[];
    },
  });

  const pipelinesQuery = useQuery({
    queryKey: ["onb-tpl-pipelines", effectiveTenantId],
    enabled: open && !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_pipelines")
        .select("nome, fase")
        .eq("tenant_id", effectiveTenantId!);
      if (error) throw error;
      return (data ?? []) as { nome: string; fase: string }[];
    },
  });

  const produtos = produtosQuery.data ?? [];
  const pipelinesExistentes = pipelinesQuery.data ?? [];

  // Ao fechar, volta pro começo — senão reabrir cai na revisão do template anterior.
  useEffect(() => {
    if (!open) {
      setTela("escolha");
      setTpl(null);
      setSel(null);
      setProdutoId(SEM_PRODUTO);
    }
  }, [open]);

  const colisoes = useMemo(
    () => (tpl ? nomesEmColisao(tpl.blueprint, pipelinesExistentes) : []),
    [tpl, pipelinesExistentes],
  );

  const escolher = (t: OnboardingTemplate) => {
    setTpl(t);
    setSel(selecaoCompleta(t.blueprint));
    const sugerido = resolverProdutoSugerido(produtos, t.produto_sugerido);
    setProdutoId(sugerido != null ? String(sugerido) : SEM_PRODUTO);
    setTela("produto");
  };

  const toggleStage = (pi: number, si: number) =>
    setSel((s) => {
      if (!s) return s;
      const next = new Set(s.stages[pi] ?? []);
      next.has(si) ? next.delete(si) : next.add(si);
      return { ...s, stages: { ...s.stages, [pi]: next } };
    });

  const toggleCatalog = (key: CatalogKey, i: number) =>
    setSel((s) => {
      if (!s) return s;
      const next = new Set(s[key]);
      next.has(i) ? next.delete(i) : next.add(i);
      return { ...s, [key]: next };
    });

  const temSelecao = !!(
    tpl &&
    sel &&
    (tpl.blueprint.pipelines.some((p, pi) => p.stages.some((_, si) => sel.stages[pi]?.has(si))) ||
      sel.demand_types.size > 0 ||
      sel.training_types.size > 0 ||
      sel.pause_reasons.size > 0 ||
      sel.accounting_fields.size > 0 ||
      sel.vendor_return_reasons.size > 0)
  );

  const aplicar = async () => {
    if (!tpl || !sel || !effectiveTenantId) return;
    setApplying(true);
    try {
      const filtrado = filtrarPorSelecao(tpl.blueprint, sel);
      const final = renomearColisoes(filtrado, pipelinesExistentes);
      const pid = produtoId === SEM_PRODUTO ? null : Number(produtoId);
      const payload = {
        ...final,
        pipelines: final.pipelines.map((p) => ({ ...p, produto_id: pid })),
      };

      const { data, error } = await (supabase.rpc as any)("apply_onboarding_blueprint", {
        p_tenant_id: effectiveTenantId,
        p_blueprint: payload,
      });
      if (error) {
        toast.error(error.message || "Falha ao aplicar template");
        return;
      }
      toast.success(
        `Template aplicado: ${data?.pipelines ?? 0} pipeline(s), ${data?.stages ?? 0} etapa(s), ` +
          `${data?.checklist_items ?? 0} item(ns) de checklist.`,
      );
      await qc.invalidateQueries();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao aplicar template");
    } finally {
      setApplying(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (applying) return;
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        {/* dialog-height-ok: as três telas são ramos exclusivos e a revisão já rola sozinha. */}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            Usar template de operação
          </DialogTitle>
        </DialogHeader>

        {tela === "escolha" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Um template cria pipelines, etapas, checklist e catálogos prontos. Nada do que já
              existe é apagado — tudo entra por cima.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {ONBOARDING_TEMPLATES.map((t) => {
                const r = resumoTemplate(t);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => escolher(t)}
                    className="text-left rounded-lg border border-border p-4 space-y-2 transition-all duration-300 hover:border-primary hover:shadow-lg hover:-translate-y-0.5"
                    style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
                  >
                    <div className="font-medium text-sm">{t.nome}</div>
                    <p className="text-xs text-muted-foreground">{t.descricao}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{r.pipelines} pipelines</Badge>
                      <Badge variant="outline" className="text-[10px]">{r.etapas} etapas</Badge>
                      <Badge variant="outline" className="text-[10px]">{r.itens} itens</Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tela === "produto" && tpl && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Produto do template “{tpl.nome}”</span>
              <p className="text-xs text-muted-foreground">
                O produto amarra os pipelines ao que foi vendido: é ele que decide em qual trilho
                o ticket do cliente entra. Sem produto, os pipelines valem para qualquer venda.
              </p>
            </div>
            <Select value={produtoId} onValueChange={setProdutoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_PRODUTO}>Sem produto</SelectItem>
                {produtos.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tpl.produto_sugerido && produtoId === SEM_PRODUTO && (
              <p className="text-xs text-muted-foreground">
                Este tenant não tem um produto chamado “{tpl.produto_sugerido}”. Dá para importar
                sem produto e amarrar depois em “Pipelines &amp; Etapas”.
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setTela("escolha")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Voltar
              </Button>
              <Button onClick={() => setTela("revisao")}>Revisar</Button>
            </DialogFooter>
          </div>
        )}

        {tela === "revisao" && tpl && sel && (
          <div className="space-y-4">
            <div className="max-h-[60vh] overflow-y-auto space-y-5 pr-2">
              <p className="text-xs text-muted-foreground">
                Desmarque o que não quiser aplicar. Itens de catálogo com nome já existente são
                ignorados automaticamente.
              </p>

              {colisoes.length > 0 && (
                <p className="text-xs text-amber-500 border border-dashed border-amber-500/40 rounded-md p-2.5 flex gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Este tenant já tem <strong>{colisoes.join(", ")}</strong> na mesma jornada. O
                    template entra ao lado, com sufixo no nome — nada é sobrescrito.
                  </span>
                </p>
              )}

              {(["onboarding", "implantacao"] as const).map((fase) => {
                const list = tpl.blueprint.pipelines
                  .map((p, pi) => ({ p, pi }))
                  .filter(({ p }) => p.fase === fase);
                if (!list.length) return null;
                return (
                  <section key={fase} className="space-y-2">
                    <h3 className="text-sm font-semibold">
                      {fase === "onboarding" ? "Onboarding" : "Implantação"}
                    </h3>
                    {list.map(({ p, pi }) => (
                      <div key={pi} className="rounded-md border border-border p-3 space-y-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="font-medium text-sm">{p.nome}</div>
                          {p.descricao && (
                            <div className="text-xs text-muted-foreground">{p.descricao}</div>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {p.stages.map((s, si) => {
                            const grupos = s.checklist_groups ?? [];
                            const planos = s.checklist ?? [];
                            const totalItens = grupos.length
                              ? grupos.reduce((a, g) => a + g.itens.length, 0)
                              : planos.length;
                            return (
                              <div key={si} className="text-xs border-l-2 border-muted pl-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Checkbox
                                    checked={sel.stages[pi]?.has(si) ?? false}
                                    onCheckedChange={() => toggleStage(pi, si)}
                                  />
                                  {s.cor && (
                                    <span
                                      className="h-2.5 w-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: s.cor }}
                                    />
                                  )}
                                  <span className="font-medium">{s.nome}</span>
                                  <span className="text-muted-foreground">
                                    SLA: {formatSlaHuman(s.sla_minutos)}
                                  </span>
                                  {s.inicia_sla && (
                                    <Badge variant="secondary" className="text-[10px]">inicia SLA</Badge>
                                  )}
                                  {s.encerra_sla && (
                                    <Badge variant="secondary" className="text-[10px]">encerra SLA</Badge>
                                  )}
                                  {s.retorno_no_show && (
                                    <Badge variant="secondary" className="text-[10px]">recebe no-show</Badge>
                                  )}
                                  {s.pausa_sla && (
                                    <Badge variant="secondary" className="text-[10px] gap-1">
                                      <Pause className="h-3 w-3" />
                                      pausa SLA
                                    </Badge>
                                  )}
                                  {totalItens > 0 && (
                                    <Badge variant="outline" className="text-[10px]">
                                      {totalItens} item(ns)
                                    </Badge>
                                  )}
                                </div>

                                {grupos.map((g, gi) => (
                                  <div key={gi} className="mt-1 ml-2">
                                    <div className="text-[11px] font-medium">
                                      {g.nome}
                                      {g.demandas && g.demandas.length > 0 && (
                                        <span className="ml-1 font-normal text-muted-foreground">
                                          · {g.demandas.join(", ")}
                                        </span>
                                      )}
                                    </div>
                                    <ul className="ml-2 list-disc list-inside text-muted-foreground space-y-0.5">
                                      {g.itens.map((c, ci) => (
                                        <li key={ci}>
                                          {c.texto}
                                          {c.is_required && (
                                            <span className="ml-1 text-[10px] text-primary">(obrigatório)</span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}

                                {grupos.length === 0 && planos.length > 0 && (
                                  <ul className="mt-1 ml-2 list-disc list-inside text-muted-foreground space-y-0.5">
                                    {planos.map((c, ci) => (
                                      <li key={ci}>
                                        {c.texto}
                                        {c.is_required && (
                                          <span className="ml-1 text-[10px] text-primary">(obrigatório)</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })}

              {tpl.blueprint.demand_types.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Tipos de demanda</h3>
                  <div className="flex flex-col gap-1">
                    {tpl.blueprint.demand_types.map((d, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={sel.demand_types.has(i)}
                          onCheckedChange={() => toggleCatalog("demand_types", i)}
                        />
                        <span>{d.nome}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Demanda usada por um grupo de checklist é criada mesmo se desmarcada aqui —
                    sem ela o checklist não recorta.
                  </p>
                </section>
              )}

              {tpl.blueprint.training_types.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Tipos de treino</h3>
                  <div className="flex flex-col gap-1">
                    {tpl.blueprint.training_types.map((t, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={sel.training_types.has(i)}
                          onCheckedChange={() => toggleCatalog("training_types", i)}
                        />
                        <span>
                          {t.nome}
                          {t.conta_como_pdv && (
                            <span className="ml-1 text-[10px] text-muted-foreground">· PDV</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {tpl.blueprint.pause_reasons.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Motivos de parada</h3>
                  <div className="flex flex-col gap-1">
                    {tpl.blueprint.pause_reasons.map((r, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={sel.pause_reasons.has(i)}
                          onCheckedChange={() => toggleCatalog("pause_reasons", i)}
                        />
                        <span>{r.nome}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {tpl.blueprint.accounting_fields.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Campos de contabilidade</h3>
                  <div className="flex flex-col gap-1">
                    {tpl.blueprint.accounting_fields.map((f, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer flex-wrap">
                        <Checkbox
                          checked={sel.accounting_fields.has(i)}
                          onCheckedChange={() => toggleCatalog("accounting_fields", i)}
                        />
                        <span>{f.nome}</span>
                        <span className="text-xs text-muted-foreground">{f.tipo}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {tpl.blueprint.vendor_return_reasons.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Retorno ao vendedor</h3>
                  <div className="flex flex-col gap-1">
                    {tpl.blueprint.vendor_return_reasons.map((r, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={sel.vendor_return_reasons.has(i)}
                          onCheckedChange={() => toggleCatalog("vendor_return_reasons", i)}
                        />
                        <span>
                          {r.nome}
                          {r.atribuivel_vendedor && (
                            <span className="ml-1 text-[10px] text-muted-foreground">· atribuível</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setTela("produto")} disabled={applying}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Voltar
              </Button>
              <Button onClick={aplicar} disabled={applying || !temSelecao}>
                {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Aplicar template
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
