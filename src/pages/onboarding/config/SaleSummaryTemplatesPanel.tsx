// Templates do "Resumo da venda": o texto com as perguntas que o vendedor
// responde no ticket quando a jornada não veio do sistema comercial.
//
// O template se amarra ao pipeline de ONBOARDING; por isso o select não oferece
// pipeline de implantação (ver pipelinesParaTemplate).

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOnboardingPhases } from "@/hooks/useOnboardingPhases";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, GripVertical, Trash2, Loader2, FileText } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { pipelinesParaTemplate, type TemplateResumo, type PipelineResumo } from "../resumoVenda";

const TABELA = "onboarding_sale_summary_templates";
const KEY = "onb-sale-summary-templates";
const TODOS = "__todos__";

function SortableRow({
  item, pipelineNome, selecionado, onSelect, onToggleAtivo, onDelete,
}: {
  item: TemplateResumo;
  pipelineNome: string;
  selecionado: boolean;
  onSelect: (id: string) => void;
  onToggleAtivo: (id: string, v: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded-md border bg-card ${selecionado ? "border-primary" : "border-border"}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1">
        <GripVertical className="h-4 w-4" />
      </button>
      <button onClick={() => onSelect(item.id)} className="flex-1 min-w-0 text-left">
        <div className="text-sm truncate">{item.nome}</div>
        <div className="text-[10px] text-muted-foreground truncate">{pipelineNome}</div>
      </button>
      {!item.ativo && <Badge variant="secondary" className="text-[9px] shrink-0">inativo</Badge>}
      <Switch checked={item.ativo} onCheckedChange={(v) => onToggleAtivo(item.id, v)} />
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

export function SaleSummaryTemplatesPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<{ nome: string; corpo: string; pipeline_id: string | null } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const fases = useOnboardingPhases(effectiveTenantId, { somenteAtivas: false }).data ?? [];

  const { data: pipelines = [] } = useQuery({
    queryKey: ["onb-pipelines-para-template", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome, phase_id, ativo, position")
        .eq("tenant_id", effectiveTenantId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as PipelineResumo[];
    },
  });
  const pipelinesOferecidos = pipelinesParaTemplate(fases, pipelines);
  const nomeDoPipeline = (id: string | null) =>
    id === null ? "Todos os pipelines" : (pipelines.find((p) => p.id === id)?.nome ?? "Pipeline removido");

  const { data: itens = [], isLoading } = useQuery({
    queryKey: [KEY, effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from(TABELA as any) as any)
        .select("id, nome, corpo, pipeline_id, ativo, position")
        .eq("tenant_id", effectiveTenantId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as TemplateResumo[];
    },
  });

  const selecionado = itens.find((t) => t.id === selecionadoId) ?? null;
  const edicao = rascunho ?? (selecionado
    ? { nome: selecionado.nome, corpo: selecionado.corpo, pipeline_id: selecionado.pipeline_id }
    : null);
  const sujo = !!(selecionado && rascunho && (
    rascunho.nome !== selecionado.nome ||
    rascunho.corpo !== selecionado.corpo ||
    rascunho.pipeline_id !== selecionado.pipeline_id
  ));

  function selecionar(id: string) {
    setSelecionadoId(id);
    setRascunho(null);
  }

  async function adicionar() {
    if (!novo.trim() || !effectiveTenantId) return;
    setSalvando(true);
    try {
      const maxPos = itens.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
      const { data, error } = await (supabase.from(TABELA as any) as any)
        .insert({
          tenant_id: effectiveTenantId,
          nome: novo.trim(),
          corpo: "",
          pipeline_id: pipelinesOferecidos[0]?.id ?? null,
          ativo: true,
          position: maxPos + 1,
        })
        .select("id")
        .single();
      if (error) throw error;
      setNovo("");
      toast.success("Template criado");
      await qc.invalidateQueries({ queryKey: [KEY] });
      if (data?.id) selecionar(data.id);
    } catch (e: any) {
      toast.error(e.message || "Erro ao criar template");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao() {
    if (!selecionado || !rascunho || !effectiveTenantId) return;
    if (!rascunho.nome.trim()) { toast.error("O template precisa de um nome"); return; }
    setSalvando(true);
    const { error } = await (supabase.from(TABELA as any) as any)
      .update({ nome: rascunho.nome.trim(), corpo: rascunho.corpo, pipeline_id: rascunho.pipeline_id })
      .eq("id", selecionado.id)
      .eq("tenant_id", effectiveTenantId);
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    setRascunho(null);
    toast.success("Template salvo");
    qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function alternarAtivo(id: string, ativo: boolean) {
    const { error } = await (supabase.from(TABELA as any) as any)
      .update({ ativo }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function excluir(id: string) {
    // Jornada que usou o template guarda o texto; só o vínculo se perde (FK on delete set null).
    const { count } = await (supabase.from("onboarding_journeys" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", effectiveTenantId)
      .eq("resumo_venda_template_id", id);
    const usos = count ?? 0;
    const aviso = usos > 0
      ? `Este template já foi usado em ${usos} jornada(s). O texto escrito nelas continua lá; só o vínculo se perde. Excluir?`
      : "Excluir este template?";
    if (!confirm(aviso)) return;
    const { error } = await (supabase.from(TABELA as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) { toast.error(error.message); return; }
    if (selecionadoId === id) { setSelecionadoId(null); setRascunho(null); }
    toast.success("Template excluído");
    qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function aoArrastar(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const de = itens.findIndex((i) => i.id === active.id);
    const para = itens.findIndex((i) => i.id === over.id);
    if (de < 0 || para < 0) return;
    const ordenado = arrayMove(itens, de, para);
    qc.setQueryData([KEY, effectiveTenantId], ordenado.map((r, i) => ({ ...r, position: i + 1 })));
    try {
      await Promise.all(ordenado.map((r, i) =>
        (supabase.from(TABELA as any) as any)
          .update({ position: i + 1 }).eq("id", r.id).eq("tenant_id", effectiveTenantId),
      ));
    } catch {
      toast.error("Erro ao reordenar");
      qc.invalidateQueries({ queryKey: [KEY] });
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="space-y-3 min-h-0 overflow-y-auto">
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          O template é o texto que o vendedor recebe no ticket quando a venda <strong className="text-foreground">não</strong> veio
          do sistema comercial. Ele escolhe o template e responde por cima.
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Nome do novo template"
            onKeyDown={(e) => { if (e.key === "Enter") adicionar(); }}
          />
          <Button onClick={adicionar} disabled={salvando || !novo.trim()}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />Adicionar</>}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : itens.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-md">
            Nenhum template cadastrado.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={aoArrastar}>
            <SortableContext items={itens.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {itens.map((t) => (
                  <SortableRow
                    key={t.id}
                    item={t}
                    pipelineNome={nomeDoPipeline(t.pipeline_id)}
                    selecionado={t.id === selecionadoId}
                    onSelect={selecionar}
                    onToggleAtivo={alternarAtivo}
                    onDelete={excluir}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="min-h-0 overflow-y-auto">
        {!edicao || !selecionado ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md p-8">
            Selecione um template para editar.
          </div>
        ) : (
          <div className="space-y-3 rounded-md border border-border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4" /> Template
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Nome</label>
                <Input
                  value={edicao.nome}
                  onChange={(e) => setRascunho({ ...edicao, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Pipeline</label>
                <Select
                  value={edicao.pipeline_id ?? TODOS}
                  onValueChange={(v) => setRascunho({ ...edicao, pipeline_id: v === TODOS ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos os pipelines</SelectItem>
                    {pipelinesOferecidos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Texto do template — as perguntas que o vendedor responde
              </label>
              <Textarea
                value={edicao.corpo}
                onChange={(e) => setRascunho({ ...edicao, corpo: e.target.value })}
                rows={16}
                className="font-mono text-xs leading-relaxed"
                placeholder={"Quem é o cliente?\n\nO que foi vendido?\n\nO que o cliente espera?\n"}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setRascunho(null)} disabled={!sujo}>Descartar</Button>
              <Button onClick={salvarEdicao} disabled={!sujo || salvando}>
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
