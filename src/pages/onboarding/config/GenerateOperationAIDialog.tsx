import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles, Pause, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOnboardingPhases, findPhaseBySlug } from "@/hooks/useOnboardingPhases";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatSlaHuman } from "./utils";

const EXAMPLE_PROMPT = `Somos uma revenda de software de gestão e PDV. Vendemos o sistema por assinatura mensal para varejo (lojas, mercados, conveniências) e para food service (restaurantes, lanchonetes, pizzarias).

Quando o comercial fecha a venda, o cliente passa para a equipe de implantação. Começamos com uma mensagem de boas-vindas e uma reunião inicial para confirmar o que foi vendido (quais módulos, quantos PDVs, quantas lojas). Em seguida coletamos os dados do cliente: CNPJ e dados cadastrais, certificado digital, informações fiscais, logotipo e a lista de produtos. Se o cliente vinha de outro sistema, migramos a base dele (produtos, clientes, estoque e fornecedores).

Depois cadastramos os produtos, configuramos a parte fiscal (NF-e, NFC-e e SAT conforme o estado), instalamos e parametrizamos o sistema (formas de pagamento, impressoras fiscais, balança e integrações) e emitimos uma nota de teste em homologação. Na sequência vem o treinamento: frente de caixa/PDV, retaguarda e gestão (estoque, financeiro, relatórios) e treinamento fiscal quando necessário. Alguns clientes precisam de retreinamento depois. Por fim acompanhamos o go-live (primeiro dia real de operação) e damos suporte próximo nos primeiros dias até estabilizar.

O que mais costuma travar: o cliente demora a enviar os documentos, o certificado digital não fica pronto a tempo, o cliente não agenda o treinamento, pendência financeira, ou estamos aguardando o contador do cliente. Da contabilidade sempre precisamos saber o regime tributário, o CRT, os dados do contador e o tipo de certificado digital. Em alguns casos devolvemos o cliente para o vendedor: quando o que foi vendido não bate com a necessidade real, quando o cliente não tem a infraestrutura mínima (internet ou equipamento adequado), ou quando os dados da venda vieram incompletos.`;

type Blueprint = {
  pipelines: {
    fase: "onboarding" | "implantacao";
    nome: string;
    descricao: string | null;
    stages: {
      nome: string;
      sla_minutos: number | null;
      pausa_sla: boolean;
      checklist: { texto: string; is_required: boolean }[];
    }[];
  }[];
  demand_types: { nome: string; descricao: string | null }[];
  training_types: { nome: string; conta_como_pdv: boolean }[];
  pause_reasons: { nome: string }[];
  accounting_fields: { nome: string; tipo: "text" | "number" | "date" | "select"; opcoes: string[] | null }[];
  vendor_return_reasons: { nome: string; atribuivel_vendedor: boolean }[];
};

type CatalogKey =
  | "demand_types"
  | "training_types"
  | "pause_reasons"
  | "accounting_fields"
  | "vendor_return_reasons";

type Selection = {
  stages: Record<number, Set<number>>;
  demand_types: Set<number>;
  training_types: Set<number>;
  pause_reasons: Set<number>;
  accounting_fields: Set<number>;
  vendor_return_reasons: Set<number>;
};

const emptySelection = (): Selection => ({
  stages: {},
  demand_types: new Set<number>(),
  training_types: new Set<number>(),
  pause_reasons: new Set<number>(),
  accounting_fields: new Set<number>(),
  vendor_return_reasons: new Set<number>(),
});

const buildFullSelection = (bp: Blueprint): Selection => {
  const stages: Record<number, Set<number>> = {};
  bp.pipelines.forEach((p, pi) => {
    stages[pi] = new Set(p.stages.map((_, si) => si));
  });
  return {
    stages,
    demand_types: new Set(bp.demand_types.map((_, i) => i)),
    training_types: new Set(bp.training_types.map((_, i) => i)),
    pause_reasons: new Set(bp.pause_reasons.map((_, i) => i)),
    accounting_fields: new Set(bp.accounting_fields.map((_, i) => i)),
    vendor_return_reasons: new Set(bp.vendor_return_reasons.map((_, i) => i)),
  };
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function GenerateOperationAIDialog({ open, onOpenChange }: Props) {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [applying, setApplying] = useState(false);
  const [sel, setSel] = useState<Selection>(emptySelection);

  const toggleStage = (pi: number, si: number) =>
    setSel((s) => {
      const next = new Set(s.stages[pi] ?? []);
      next.has(si) ? next.delete(si) : next.add(si);
      return { ...s, stages: { ...s.stages, [pi]: next } };
    });

  const toggleCatalog = (key: CatalogKey, i: number) =>
    setSel((s) => {
      const next = new Set(s[key]);
      next.has(i) ? next.delete(i) : next.add(i);
      return { ...s, [key]: next };
    });

  const handleGenerate = async () => {
    if (!effectiveTenantId) {
      toast.error("Selecione um tenant.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-onboarding-blueprint", {
        body: { tenant_id: effectiveTenantId, prompt },
      });
      if (error) {
        toast.error(error.message || "Falha ao gerar sugestão");
        return;
      }
      if (!data?.success) {
        toast.error(data?.message || data?.error || "Falha ao gerar sugestão");
        return;
      }
      setBlueprint(data.blueprint as Blueprint);
      setSel(buildFullSelection(data.blueprint as Blueprint));
    } catch (e: any) {
      toast.error(e?.message || "Falha ao gerar sugestão");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!effectiveTenantId || !blueprint) return;
    setApplying(true);
    try {
      const filtered = {
        pipelines: blueprint.pipelines
          .map((p, pi) => ({
            ...p,
            stages: p.stages.filter((_, si) => sel.stages[pi]?.has(si)),
          }))
          .filter((p) => p.stages.length > 0),
        demand_types: blueprint.demand_types.filter((_, i) => sel.demand_types.has(i)),
        training_types: blueprint.training_types.filter((_, i) => sel.training_types.has(i)),
        pause_reasons: blueprint.pause_reasons.filter((_, i) => sel.pause_reasons.has(i)),
        accounting_fields: blueprint.accounting_fields.filter((_, i) => sel.accounting_fields.has(i)),
        vendor_return_reasons: blueprint.vendor_return_reasons.filter((_, i) => sel.vendor_return_reasons.has(i)),
      };
      const { data, error } = await (supabase.rpc as any)("apply_onboarding_blueprint", {
        p_tenant_id: effectiveTenantId,
        p_blueprint: filtered,
      });
      if (error) {
        toast.error(error.message || "Falha ao aplicar operação");
        return;
      }
      toast.success(
        `Operação aplicada: ${data?.pipelines ?? 0} pipeline(s), ${data?.stages ?? 0} etapa(s), ${data?.checklist_items ?? 0} item(ns) de checklist.`
      );
      await qc.invalidateQueries();
      setBlueprint(null);
      setPrompt("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao aplicar operação");
    } finally {
      setApplying(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (loading || applying) return;
    if (!v) {
      setBlueprint(null);
    }
    onOpenChange(v);
  };

  // O gerador cobre as duas jornadas de PROCESSO, que são as que a IA sabe desenhar
  // (etapas, SLA, checklist). Jornadas criadas pelo tenant e a de Acompanhamento —
  // que é coleta de indicadores, não processo — ficam de fora e são avisadas na tela.
  const phases = useOnboardingPhases(effectiveTenantId, { enabled: open }).data ?? [];
  const phasesForaDoGerador = phases.filter(
    (f) => f.slug !== "onboarding" && f.slug !== "implantacao",
  );

  const pipelinesByFase = (fase: "onboarding" | "implantacao") =>
    (blueprint?.pipelines ?? [])
      .map((p, pi) => ({ p, pi }))
      .filter(({ p }) => p.fase === fase);

  const hasSelection = blueprint
    ? blueprint.pipelines.some((p, pi) =>
        p.stages.some((_, si) => sel.stages[pi]?.has(si))
      ) ||
      sel.demand_types.size > 0 ||
      sel.training_types.size > 0 ||
      sel.pause_reasons.size > 0 ||
      sel.accounting_fields.size > 0 ||
      sel.vendor_return_reasons.size > 0
    : false;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        {/* dialog-height-ok: os campos estao em dois ramos exclusivos (prompt x
            revisao do blueprint) e a lista de revisao ja rola sozinha. */}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Gerar operação com IA
          </DialogTitle>
        </DialogHeader>

        {!blueprint ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Descreva sua operação</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPrompt(EXAMPLE_PROMPT)}
                disabled={loading}
              >
                <FileText className="h-3.5 w-3.5 mr-1" />
                Usar este exemplo
              </Button>
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={10}
              disabled={loading}
              placeholder="Descreva como funciona a implantação da sua empresa: etapas do fechamento da venda até o cliente operando, treinamentos que oferece, o que costuma travar, dados da contabilidade que coleta. Quanto mais detalhes, melhor. Se preferir, deixe em branco para uma sugestão padrão de revenda de software."
            />
            <p className="text-xs text-muted-foreground">
              A IA vai propor pipelines, etapas, checklists e catálogos. Nada é aplicado até você confirmar.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancelar
              </Button>
              <Button onClick={handleGenerate} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Gerar sugestão
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="max-h-[60vh] overflow-y-auto space-y-5 pr-2">
              <p className="text-xs text-muted-foreground">
                Desmarque o que não quiser aplicar. Itens de catálogo com nome já existente são ignorados automaticamente.
              </p>
              {phasesForaDoGerador.length > 0 && (
                <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-2.5">
                  O gerador desenha só as jornadas de processo.{" "}
                  <strong>{phasesForaDoGerador.map((f) => f.nome).join(", ")}</strong>{" "}
                  {phasesForaDoGerador.length === 1 ? "fica" : "ficam"} de fora — monte
                  as etapas {phasesForaDoGerador.length === 1 ? "dela" : "delas"} em
                  “Pipelines &amp; Etapas”.
                </p>
              )}

              {(["onboarding", "implantacao"] as const).map((fase) => {
                const list = pipelinesByFase(fase);
                if (!list.length) return null;
                return (
                  <section key={fase} className="space-y-2">
                    <h3 className="text-sm font-semibold">
                      {findPhaseBySlug(phases, fase)?.nome ??
                        (fase === "onboarding" ? "Onboarding" : "Implantação")}
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
                          {p.stages.map((s, si) => (
                            <div key={si} className="text-xs border-l-2 border-muted pl-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Checkbox
                                  checked={sel.stages[pi]?.has(si) ?? false}
                                  onCheckedChange={() => toggleStage(pi, si)}
                                />
                                <span className="font-medium">{s.nome}</span>
                                <span className="text-muted-foreground">
                                  SLA: {formatSlaHuman(s.sla_minutos)}
                                </span>
                                {s.pausa_sla && (
                                  <Badge variant="secondary" className="text-[10px] gap-1">
                                    <Pause className="h-3 w-3" />
                                    pausa SLA
                                  </Badge>
                                )}
                                {s.checklist.length > 0 && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {s.checklist.length} item(ns)
                                  </Badge>
                                )}
                              </div>
                              {s.checklist.length > 0 && (
                                <ul className="mt-1 ml-2 list-disc list-inside text-muted-foreground space-y-0.5">
                                  {s.checklist.map((c, ci) => (
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
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })}

              {blueprint.demand_types.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Tipos de demanda</h3>
                  <div className="flex flex-col gap-1">
                    {blueprint.demand_types.map((d, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer" title={d.descricao ?? undefined}>
                        <Checkbox
                          checked={sel.demand_types.has(i)}
                          onCheckedChange={() => toggleCatalog("demand_types", i)}
                        />
                        <span>{d.nome}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {blueprint.training_types.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Tipos de treino</h3>
                  <div className="flex flex-col gap-1">
                    {blueprint.training_types.map((t, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={sel.training_types.has(i)}
                          onCheckedChange={() => toggleCatalog("training_types", i)}
                        />
                        <span>
                          {t.nome}
                          {t.conta_como_pdv && <span className="ml-1 text-[10px] text-muted-foreground">· PDV</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {blueprint.pause_reasons.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Motivos de parada</h3>
                  <div className="flex flex-col gap-1">
                    {blueprint.pause_reasons.map((r, i) => (
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

              {blueprint.accounting_fields.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Campos de contabilidade</h3>
                  <div className="flex flex-col gap-1">
                    {blueprint.accounting_fields.map((f, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer flex-wrap">
                        <Checkbox
                          checked={sel.accounting_fields.has(i)}
                          onCheckedChange={() => toggleCatalog("accounting_fields", i)}
                        />
                        <span>{f.nome}</span>
                        <span className="text-xs text-muted-foreground">{f.tipo}</span>
                        {f.tipo === "select" && f.opcoes && f.opcoes.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            [{f.opcoes.join(", ")}]
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {blueprint.vendor_return_reasons.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Retorno ao vendedor</h3>
                  <div className="flex flex-col gap-1">
                    {blueprint.vendor_return_reasons.map((r, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={sel.vendor_return_reasons.has(i)}
                          onCheckedChange={() => toggleCatalog("vendor_return_reasons", i)}
                        />
                        <span>
                          {r.nome}
                          {r.atribuivel_vendedor && <span className="ml-1 text-[10px] text-muted-foreground">· atribuível</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setBlueprint(null)}
                disabled={applying}
              >
                Voltar
              </Button>
              <Button onClick={handleApply} disabled={applying || !hasSelection}>
                {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Aplicar operação
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
