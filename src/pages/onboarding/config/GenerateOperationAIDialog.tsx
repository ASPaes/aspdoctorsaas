import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles, Pause, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
      const { data, error } = await (supabase.rpc as any)("apply_onboarding_blueprint", {
        p_tenant_id: effectiveTenantId,
        p_blueprint: blueprint,
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

  const pipelinesByFase = (fase: "onboarding" | "implantacao") =>
    (blueprint?.pipelines ?? []).filter((p) => p.fase === fase);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Gerar operação com IA
          </DialogTitle>
        </DialogHeader>

        {!blueprint ? (
          <div className="space-y-3">
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
              {(["onboarding", "implantacao"] as const).map((fase) => {
                const list = pipelinesByFase(fase);
                if (!list.length) return null;
                return (
                  <section key={fase} className="space-y-2">
                    <h3 className="text-sm font-semibold">
                      {fase === "onboarding" ? "Onboarding" : "Implantação"}
                    </h3>
                    {list.map((p, i) => (
                      <div key={i} className="rounded-md border border-border p-3 space-y-2">
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
                  <div className="flex flex-wrap gap-1.5">
                    {blueprint.demand_types.map((d, i) => (
                      <Badge key={i} variant="outline" title={d.descricao ?? undefined}>
                        {d.nome}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {blueprint.training_types.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Tipos de treino</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {blueprint.training_types.map((t, i) => (
                      <Badge key={i} variant="outline">
                        {t.nome}
                        {t.conta_como_pdv && <span className="ml-1 text-[10px]">· PDV</span>}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {blueprint.pause_reasons.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Motivos de parada</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {blueprint.pause_reasons.map((r, i) => (
                      <Badge key={i} variant="outline">{r.nome}</Badge>
                    ))}
                  </div>
                </section>
              )}

              {blueprint.accounting_fields.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Campos de contabilidade</h3>
                  <div className="space-y-1">
                    {blueprint.accounting_fields.map((f, i) => (
                      <div key={i} className="text-xs flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{f.nome}</Badge>
                        <span className="text-muted-foreground">{f.tipo}</span>
                        {f.tipo === "select" && f.opcoes && f.opcoes.length > 0 && (
                          <span className="text-muted-foreground">
                            [{f.opcoes.join(", ")}]
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {blueprint.vendor_return_reasons.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Retorno ao vendedor</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {blueprint.vendor_return_reasons.map((r, i) => (
                      <Badge key={i} variant="outline">
                        {r.nome}
                        {r.atribuivel_vendedor && <span className="ml-1 text-[10px]">· atribuível</span>}
                      </Badge>
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
              <Button onClick={handleApply} disabled={applying}>
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
