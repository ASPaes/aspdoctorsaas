import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Ticket, LinkIcon, Building2, Bot, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendanceId: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  contactId: string | null;
  departmentId: string | null;
  aiSummary: string | null;
  aiTopics?: string[] | null;
  aiKeywords?: string[] | null;
  aiProblem?: string | null;
  aiSolution?: string | null;
  sentimentLabel?: string | null;
  sentimentConfidence?: number | null;
  sentimentSummary?: string | null;
  mode?: 'classificacao' | 'demanda_externa';
}

export function CreateSupportTicketModal({
  open,
  onOpenChange,
  attendanceId,
  clienteId,
  clienteNome,
  aiSummary,
  aiTopics,
  aiKeywords,
  aiProblem,
  aiSolution,
  sentimentLabel,
  sentimentConfidence,
  sentimentSummary,
  mode = 'classificacao',
}: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const [produtoId, setProdutoId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [serviceTypeId, setServiceTypeId] = useState<string>("");
  const [observacaoAgente, setObservacaoAgente] = useState<string>("");
  const [tipoHorario, setTipoHorario] = useState<string>("comercial");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasCliente = !!clienteId;

  // Reset on open
  useEffect(() => {
    if (open) {
      setProdutoId("");
      setCategoryId("");
      setSubcategoryId("");
      setServiceTypeId("");
      setObservacaoAgente("");
      setTipoHorario("comercial");
    }
  }, [open]);

  // Produtos
  const { data: produtos = [] } = useQuery({
    queryKey: ["support_ticket_modal_produtos", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
  });

  // Cliente produto_id auto-fill
  const { data: clienteData } = useQuery({
    queryKey: ["support_ticket_modal_cliente_produto", clienteId],
    enabled: open && !!clienteId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("clientes" as any) as any)
        .select("produto_id")
        .eq("id", clienteId)
        .maybeSingle();
      if (error) throw error;
      return data as { produto_id: number | null } | null;
    },
  });

  useEffect(() => {
    if (open && clienteData?.produto_id && !produtoId) {
      setProdutoId(String(clienteData.produto_id));
    }
  }, [open, clienteData, produtoId]);

  // Categorias
  const { data: categories = [] } = useQuery({
    queryKey: ["support_ticket_modal_categories", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_categories" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  // Vínculos categoria <-> produto (N:N)
  const { data: categoryProductLinks = [] } = useQuery({
    queryKey: ["support_ticket_modal_cat_links", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_category_products" as any) as any)
        .select("category_id, produto_id")
        .eq("tenant_id", tid);
      if (error) throw error;
      return (data ?? []) as Array<{ category_id: string; produto_id: number }>;
    },
  });

  // Subcategorias
  const { data: subcategories = [] } = useQuery({
    queryKey: ["support_ticket_modal_subcategories", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_subcategories" as any) as any)
        .select("id, nome, category_id, produto_id")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; category_id: string; produto_id: number | null }>;
    },
  });

  // Tipos de serviço
  const { data: serviceTypes = [] } = useQuery({
    queryKey: ["support_ticket_modal_service_types", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_types" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  const produtoIdNum = produtoId ? Number(produtoId) : null;

  const filteredCategories = useMemo(() => {
    if (produtoIdNum == null) return categories;
    const linkedCatIds = new Set(
      categoryProductLinks.filter((l) => l.produto_id === produtoIdNum).map((l) => l.category_id)
    );
    const catsWithAnyLink = new Set(categoryProductLinks.map((l) => l.category_id));
    return categories.filter((c) => linkedCatIds.has(c.id) || !catsWithAnyLink.has(c.id));
  }, [categories, categoryProductLinks, produtoIdNum]);

  const filteredSubcategories = useMemo(
    () =>
      subcategories.filter(
        (s) => s.category_id === categoryId && (s.produto_id === produtoIdNum || s.produto_id === null)
      ),
    [subcategories, categoryId, produtoIdNum]
  );

  // Reset subcategory when category changes
  useEffect(() => {
    setSubcategoryId("");
  }, [categoryId]);

  // Reset category/subcategory when produto changes
  useEffect(() => {
    setCategoryId("");
    setSubcategoryId("");
  }, [produtoId]);

  const handleSubmit = async () => {
    if (!hasCliente) {
      toast.error("Vincule um cliente antes de classificar");
      return;
    }
    if (!produtoId || !categoryId || !subcategoryId || !serviceTypeId) {
      toast.error("Preencha produto, categoria, subcategoria e tipo de serviço");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await (supabase.rpc as any)("create_ticket_from_closure", {
        p_attendance_id: attendanceId,
        p_produto_id: Number(produtoId),
        p_category_id: categoryId,
        p_subcategory_id: subcategoryId,
        p_service_type_id: serviceTypeId,
        p_observacao_agente: observacaoAgente || null,
        p_observacao_ia: aiSummary || null,
        p_tipo_horario: tipoHorario,
      });

      if (error) throw error;

      toast.success("Ticket criado com sucesso!");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao criar ticket");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Ticket className="h-5 w-5 text-primary" />
            {mode === 'demanda_externa' ? 'Novo ticket — demanda externa' : 'Classificar atendimento'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {hasCliente ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Cliente</p>
                <p className="text-sm font-medium truncate">{clienteNome || clienteId}</p>
              </div>
            </div>
          ) : (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
              <LinkIcon className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Vincule um cliente antes de classificar.
              </AlertDescription>
            </Alert>
          )}

          {(!!aiTopics?.length || !!sentimentLabel || !!aiSummary || !!aiProblem) && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Bot className="h-3.5 w-3.5 text-primary" />
                Contexto IA
              </div>

              {aiTopics && aiTopics.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tópicos identificados</p>
                  <div className="flex flex-wrap gap-1">
                    {aiTopics.map((topic, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">{topic}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {sentimentLabel && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Sentimento:</span>
                  <Badge
                    variant={sentimentLabel === "negative" ? "destructive" : "secondary"}
                    className="text-[10px] capitalize"
                  >
                    {sentimentLabel === "negative" ? "Negativo" : sentimentLabel === "positive" ? "Positivo" : "Neutro"}
                  </Badge>
                  {sentimentConfidence != null && (
                    <span className="text-[10px] text-muted-foreground">({Math.round(sentimentConfidence * 100)}%)</span>
                  )}
                </div>
              )}

              {(sentimentSummary || aiSummary) && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Resumo</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                    {sentimentSummary || aiSummary}
                  </p>
                </div>
              )}

              {aiProblem && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Problema</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{aiProblem}</p>
                </div>
              )}

              {aiSolution && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Solução</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{aiSolution}</p>
                </div>
              )}

              {aiKeywords && aiKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {aiKeywords.map((kw, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-normal">{kw}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <fieldset disabled={!hasCliente} className={!hasCliente ? "opacity-50 pointer-events-none" : ""}>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Produto <span className="text-destructive">*</span></Label>
                <Select value={produtoId} onValueChange={setProdutoId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Selecionar produto" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Categoria <span className="text-destructive">*</span></Label>
                <Select value={categoryId} onValueChange={setCategoryId} disabled={!produtoId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder={produtoId ? "Selecionar categoria" : "Selecione um produto"} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Subcategoria <span className="text-destructive">*</span></Label>
                <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={!categoryId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder={categoryId ? "Selecionar subcategoria" : "Selecione uma categoria"} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSubcategories.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tipo de serviço <span className="text-destructive">*</span></Label>
                <Select value={serviceTypeId} onValueChange={setServiceTypeId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Selecionar tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Observação do agente</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] gap-1"
                    onClick={() => toast.info("Em breve")}
                  >
                    <Sparkles className="h-3 w-3" />
                    Gerar por IA
                  </Button>
                </div>
                <Textarea
                  value={observacaoAgente}
                  onChange={(e) => setObservacaoAgente(e.target.value)}
                  placeholder="Descreva o que foi feito neste atendimento..."
                  className="text-xs min-h-[80px] resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tipo de horário</Label>
                <Select value={tipoHorario} onValueChange={setTipoHorario}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comercial">Horário comercial</SelectItem>
                    <SelectItem value="plantao">Plantão</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </fieldset>

          <Separator />

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={isSubmitting || !hasCliente}>
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Criar ticket
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
