import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Bot } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { sugestaoAtendimentoEncerrado } from "@/components/tickets/tipoHorarioAnchor";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendanceId: string;
  contactName?: string;
  clienteName?: string;
  clienteProdutoId?: number | null;
  aiSummary?: string | null;
  onCreated?: () => void;
}

const Req = () => <span className="text-destructive">*</span>;

export function ClassifyClosureModal({
  open,
  onOpenChange,
  attendanceId,
  contactName,
  clienteName,
  clienteProdutoId,
  aiSummary,
  onCreated,
}: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const [produtoId, setProdutoId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [serviceTypeId, setServiceTypeId] = useState<string>("");
  const [tipoHorario, setTipoHorario] = useState<string>("comercial");
  const [obs, setObs] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setProdutoId(clienteProdutoId ? String(clienteProdutoId) : "");
      setCategoryId("");
      setSubcategoryId("");
      setServiceTypeId("");
      setTipoHorario("comercial");
      setObs("");
    }
  }, [open, clienteProdutoId]);

  // Dados do atendimento para sugerir tipo de horário. Este modal só existe
  // para atendimento JÁ ENCERRADO (fila de backlog de PendingClosuresTab) —
  // o gatilho de fechamento já calculou e gravou `plantao` / `plantao_em`.
  // Não usar `now()` aqui: o operador está classificando dias depois, e
  // ancorar na hora em que ele sentou pra limpar a fila (não na hora do
  // atendimento) é exatamente o defeito que motivou esta correção.
  const { data: attendanceAnchor, isLoading: isLoadingAttendanceAnchor } = useQuery({
    queryKey: ["classify_closure_attendance_anchor", attendanceId],
    enabled: open && !!attendanceId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select("opened_at, department_id, plantao, plantao_em, closed_at")
        .eq("id", attendanceId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        opened_at: string;
        department_id: string | null;
        plantao: boolean | null;
        plantao_em: string | null;
        closed_at: string | null;
      } | null;
    },
  });

  // Detecta tipo de horário (comercial/plantão) quando o atendimento carrega —
  // substitui o default fixo "comercial" setado no reset acima.
  useEffect(() => {
    if (!open || !attendanceId || isLoadingAttendanceAnchor) return;
    const sugestao = sugestaoAtendimentoEncerrado(attendanceAnchor ?? {});
    if (sugestao.modo === "comercial") {
      // Resposta definitiva do gatilho de fechamento: não houve trabalho fora
      // do comercial. Não chama a RPC.
      setTipoHorario("comercial");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase.rpc as any)("check_tipo_horario", {
          p_department_id: attendanceAnchor?.department_id ?? null,
          ...(sugestao.at !== undefined ? { p_at: sugestao.at } : {}),
          p_tenant_id: tid,
        });
        if (cancelled) return;
        if (error) {
          console.error("[check_tipo_horario] erro ao detectar horário:", error);
          return;
        }
        const raw = typeof data === "string" ? data : null;
        if (raw === "comercial" || raw === "plantao") {
          setTipoHorario(raw);
        } else {
          console.error("[check_tipo_horario] valor inesperado:", raw);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[check_tipo_horario] exceção:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, attendanceId, attendanceAnchor, isLoadingAttendanceAnchor, tid]);

  const { data: produtos = [] } = useQuery({
    queryKey: ["classify_closure_produtos", tid],
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

  const { data: categories = [] } = useQuery({
    queryKey: ["classify_closure_categories", tid],
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

  const { data: categoryProductLinks = [] } = useQuery({
    queryKey: ["classify_closure_cat_links", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_category_products" as any) as any)
        .select("category_id, produto_id")
        .eq("tenant_id", tid);
      if (error) throw error;
      return (data ?? []) as Array<{ category_id: string; produto_id: number }>;
    },
  });

  const filteredCategories = (() => {
    if (!produtoId) return categories;
    const produtoIdNum = Number(produtoId);
    const linkedCatIds = new Set(
      categoryProductLinks.filter((l) => l.produto_id === produtoIdNum).map((l) => l.category_id)
    );
    const catsWithAnyLink = new Set(categoryProductLinks.map((l) => l.category_id));
    return categories.filter((c) => linkedCatIds.has(c.id) || !catsWithAnyLink.has(c.id));
  })();

  const { data: subcategories = [] } = useQuery({
    queryKey: ["classify_closure_subcategories", tid, categoryId],
    enabled: open && !!tid && !!categoryId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_subcategories" as any) as any)
        .select("id, nome, category_id")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .eq("category_id", categoryId)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; category_id: string }>;
    },
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ["classify_closure_service_types", tid],
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

  const handleProdutoChange = (v: string) => {
    setProdutoId(v);
    setCategoryId("");
    setSubcategoryId("");
  };

  const handleCategoryChange = (v: string) => {
    setCategoryId(v);
    setSubcategoryId("");
  };

  const handleSubmit = async () => {
    if (!produtoId) return toast.error("Selecione o produto");
    if (!categoryId) return toast.error("Selecione a categoria");
    if (!subcategoryId) return toast.error("Selecione a subcategoria");
    if (!serviceTypeId) return toast.error("Selecione o tipo de serviço");

    setIsSubmitting(true);
    try {
      const { error } = await (supabase.rpc as any)("create_ticket_from_closure", {
        p_attendance_id: attendanceId,
        p_produto_id: Number(produtoId),
        p_category_id: categoryId,
        p_subcategory_id: subcategoryId,
        p_service_type_id: serviceTypeId,
        p_observacao_agente: obs.trim() || null,
        p_tipo_horario: tipoHorario,
      });
      if (error) throw error;
      toast.success("Atendimento classificado");
      onCreated?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao classificar: " + (err?.message || "desconhecido"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Classificar atendimento</DialogTitle>
        </DialogHeader>

        {/* 2 colunas: 5 selects empilhados passavam da altura da tela em 13" */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 pt-2 sm:grid-cols-2">
          {/* Contexto */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1.5 text-xs sm:col-span-2">
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">Contato:</span>
              <span className="font-medium truncate">{contactName || "—"}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">Cliente:</span>
              <span className="font-medium truncate">{clienteName || "Sem cliente vinculado"}</span>
            </div>
            {aiSummary && (
              <div className="flex gap-2 pt-1.5 border-t border-border/50">
                <Bot className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-muted-foreground line-clamp-3 italic">{aiSummary}</p>
              </div>
            )}
          </div>

          {/* Produto */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Produto <Req /></Label>
            <Select value={produtoId} onValueChange={handleProdutoChange}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {produtos.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Categoria */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Categoria <Req /></Label>
            <Select value={categoryId} onValueChange={handleCategoryChange} disabled={!produtoId}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {filteredCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subcategoria */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Subcategoria <Req /></Label>
            <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={!categoryId}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {subcategories.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tipo de serviço */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Tipo de serviço <Req /></Label>
            <Select value={serviceTypeId} onValueChange={setServiceTypeId}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {serviceTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tipo de horário */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Tipo de horário</Label>
            <Select value={tipoHorario} onValueChange={setTipoHorario}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="comercial">Comercial</SelectItem>
                <SelectItem value="plantao">Plantão</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Observação */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-sm font-medium">Observação do agente</Label>
            <Textarea
              rows={3}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Observação opcional sobre a classificação..."
              className="resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Classificar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
