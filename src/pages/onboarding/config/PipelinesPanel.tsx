import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, GripVertical, Trash2, Loader2, Pencil, Flag, Pause, ChevronRight,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SlaInput } from "./SlaInput";
import { formatSlaHuman, slugify } from "./utils";

type Fase = "onboarding" | "implantacao";

const SECTION_OPTIONS: { key: string; label: string }[] = [
  { key: "participantes", label: "Responsável & participantes" },
  { key: "timeline", label: "Linha do tempo das etapas" },
  { key: "pausas", label: "Tempo parado por motivo" },
  { key: "modulos", label: "Módulos da jornada" },
  { key: "contabilidade", label: "Dados da contabilidade" },
  { key: "treinos", label: "Sub-tickets de treino" },
  { key: "checklist", label: "Checklist da etapa" },
  { key: "atendimentos", label: "Atendimentos vinculados" },
  { key: "eventos", label: "Timeline de eventos" },
  { key: "anexos", label: "Anexos" },
];
const ALL_SECTION_KEYS = SECTION_OPTIONS.map((s) => s.key);

interface Pipeline {
  id: string;
  nome: string;
  descricao: string | null;
  fase: Fase;
  produto_id: number | null;
  sla_total_minutos: number | null;
  ativo: boolean;
  position: number;
}

interface Stage {
  id: string;
  pipeline_id: string;
  nome: string;
  slug: string | null;
  position: number;
  sla_minutos: number | null;
  cor: string | null;
  is_initial: boolean;
  is_final: boolean;
  pausa_sla: boolean;
  ativo: boolean;
  visible_sections: string[] | null;
}

interface ChecklistItem {
  id: string;
  stage_id: string;
  texto: string;
  is_required: boolean;
  position: number;
  ativo: boolean;
}

interface Produto { id: number; nome: string; }

const DEFAULT_COLORS = ["#22C55E", "#0EA5E9", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#6B7280"];

interface Props {
  fase: Fase;
}

export function PipelinesPanel({ fase }: Props) {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [pipelineEditing, setPipelineEditing] = useState<Pipeline | null>(null);
  const [pipelineNewOpen, setPipelineNewOpen] = useState(false);
  const [stageEditing, setStageEditing] = useState<Stage | null>(null);
  const [stageNewOpen, setStageNewOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Reset seleção quando fase muda
  useEffect(() => {
    setSelectedPipelineId(null);
    setSelectedStageId(null);
  }, [fase]);

  const pipelinesQuery = useQuery({
    queryKey: ["onb-pipelines", effectiveTenantId, fase],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome, descricao, fase, produto_id, sla_total_minutos, ativo, position")
        .eq("tenant_id", effectiveTenantId).eq("fase", fase).order("position");
      if (error) throw error;
      return (data ?? []) as Pipeline[];
    },
  });

  const produtosQuery = useQuery({
    queryKey: ["onb-produtos", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos")
        .select("id, nome").eq("tenant_id", effectiveTenantId!).order("nome");
      if (error) throw error;
      return (data ?? []) as Produto[];
    },
  });

  const stagesQuery = useQuery({
    queryKey: ["onb-stages", effectiveTenantId, selectedPipelineId],
    enabled: !!effectiveTenantId && !!selectedPipelineId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stages" as any) as any)
        .select("id, pipeline_id, nome, slug, position, sla_minutos, cor, is_initial, is_final, pausa_sla, ativo, visible_sections")
        .eq("tenant_id", effectiveTenantId).eq("pipeline_id", selectedPipelineId).order("position");
      if (error) throw error;
      return (data ?? []) as Stage[];
    },
  });

  const checklistQuery = useQuery({
    queryKey: ["onb-checklist", effectiveTenantId, selectedStageId],
    enabled: !!effectiveTenantId && !!selectedStageId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stage_checklist" as any) as any)
        .select("id, stage_id, texto, is_required, position, ativo")
        .eq("tenant_id", effectiveTenantId).eq("stage_id", selectedStageId).order("position");
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
  });

  const pipelines = pipelinesQuery.data ?? [];
  const stages = stagesQuery.data ?? [];
  const checklist = checklistQuery.data ?? [];
  const produtos = produtosQuery.data ?? [];

  // ==================== Pipeline ops ====================
  async function savePipeline(p: Partial<Pipeline> & { id?: string }, isNew: boolean) {
    if (!effectiveTenantId || !p.nome?.trim()) return;
    const payload: any = {
      nome: p.nome.trim(),
      descricao: p.descricao?.trim() || null,
      fase,
      produto_id: p.produto_id ?? null,
      sla_total_minutos: p.sla_total_minutos ?? 0,
      ativo: p.ativo ?? true,
    };
    try {
      if (isNew) {
        const maxPos = pipelines.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
        payload.tenant_id = effectiveTenantId;
        payload.position = maxPos + 1;
        const { error } = await (supabase.from("onboarding_pipelines" as any) as any).insert(payload);
        if (error) throw error;
        toast.success("Pipeline criado");
      } else {
        const { error } = await (supabase.from("onboarding_pipelines" as any) as any)
          .update(payload).eq("id", p.id!).eq("tenant_id", effectiveTenantId);
        if (error) throw error;
        toast.success("Pipeline atualizado");
      }
      qc.invalidateQueries({ queryKey: ["onb-pipelines"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    }
  }

  async function toggleActivePipeline(id: string, ativo: boolean) {
    const { error } = await (supabase.from("onboarding_pipelines" as any) as any)
      .update({ ativo }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-pipelines"] });
  }

  async function deletePipeline(id: string) {
    if (!confirm("Remover este pipeline? Todas as etapas e checklists serão perdidos.")) return;
    const { error } = await (supabase.from("onboarding_pipelines" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else {
      toast.success("Pipeline removido");
      if (selectedPipelineId === id) { setSelectedPipelineId(null); setSelectedStageId(null); }
      qc.invalidateQueries({ queryKey: ["onb-pipelines"] });
    }
  }

  // ==================== Stage ops ====================
  async function saveStage(s: Partial<Stage> & { id?: string }, isNew: boolean) {
    if (!effectiveTenantId || !selectedPipelineId || !s.nome?.trim()) return;
    const payload: any = {
      nome: s.nome.trim(),
      slug: (s.slug?.trim() || slugify(s.nome)),
      sla_minutos: s.sla_minutos ?? 0,
      cor: s.cor || DEFAULT_COLORS[0],
      is_initial: !!s.is_initial,
      is_final: !!s.is_final,
      pausa_sla: !!s.pausa_sla,
      ativo: s.ativo ?? true,
      visible_sections: s.visible_sections ?? ALL_SECTION_KEYS,
    };
    try {
      if (isNew) {
        const maxPos = stages.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
        payload.tenant_id = effectiveTenantId;
        payload.pipeline_id = selectedPipelineId;
        payload.position = maxPos + 1;
        const { error } = await (supabase.from("onboarding_stages" as any) as any).insert(payload);
        if (error) throw error;
        toast.success("Etapa criada");
      } else {
        const { error } = await (supabase.from("onboarding_stages" as any) as any)
          .update(payload).eq("id", s.id!).eq("tenant_id", effectiveTenantId);
        if (error) throw error;
        toast.success("Etapa atualizada");
      }
      qc.invalidateQueries({ queryKey: ["onb-stages"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    }
  }

  async function deleteStage(id: string) {
    if (!confirm("Remover esta etapa? O checklist também será perdido.")) return;
    const { error } = await (supabase.from("onboarding_stages" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else {
      toast.success("Etapa removida");
      if (selectedStageId === id) setSelectedStageId(null);
      qc.invalidateQueries({ queryKey: ["onb-stages"] });
    }
  }

  async function reorderStages(reordered: Stage[]) {
    qc.setQueryData(["onb-stages", effectiveTenantId, selectedPipelineId],
      reordered.map((s, i) => ({ ...s, position: i + 1 })));
    try {
      await Promise.all(reordered.map((s, i) =>
        (supabase.from("onboarding_stages" as any) as any)
          .update({ position: i + 1 }).eq("id", s.id).eq("tenant_id", effectiveTenantId)
      ));
    } catch {
      toast.error("Erro ao reordenar etapas");
      qc.invalidateQueries({ queryKey: ["onb-stages"] });
    }
  }

  // ==================== Checklist ops ====================
  async function addChecklistItem(texto: string) {
    if (!effectiveTenantId || !selectedStageId || !texto.trim()) return;
    const maxPos = checklist.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
    const { error } = await (supabase.from("onboarding_stage_checklist" as any) as any).insert({
      tenant_id: effectiveTenantId,
      stage_id: selectedStageId,
      texto: texto.trim(),
      is_required: false,
      position: maxPos + 1,
      ativo: true,
    });
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-checklist"] });
  }

  async function updateChecklistItem(id: string, patch: Partial<ChecklistItem>) {
    const { error } = await (supabase.from("onboarding_stage_checklist" as any) as any)
      .update(patch).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-checklist"] });
  }

  async function deleteChecklistItem(id: string) {
    const { error } = await (supabase.from("onboarding_stage_checklist" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-checklist"] });
  }

  async function reorderChecklist(reordered: ChecklistItem[]) {
    qc.setQueryData(["onb-checklist", effectiveTenantId, selectedStageId],
      reordered.map((r, i) => ({ ...r, position: i + 1 })));
    try {
      await Promise.all(reordered.map((r, i) =>
        (supabase.from("onboarding_stage_checklist" as any) as any)
          .update({ position: i + 1 }).eq("id", r.id).eq("tenant_id", effectiveTenantId)
      ));
    } catch {
      toast.error("Erro ao reordenar");
      qc.invalidateQueries({ queryKey: ["onb-checklist"] });
    }
  }

  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-4 h-full min-h-0">
      {/* Coluna 1: Pipelines */}
      <div className="flex flex-col border border-border rounded-lg bg-card/50 min-h-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pipelines</span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setPipelineNewOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Novo
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {pipelinesQuery.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : pipelines.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">Nenhum pipeline</div>
          ) : (
            pipelines.map((p) => (
              <div
                key={p.id}
                className={`group flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                  selectedPipelineId === p.id
                    ? "border-primary/40 bg-primary/5"
                    : "border-border hover:bg-muted/50"
                } ${!p.ativo ? "opacity-60" : ""}`}
                onClick={() => { setSelectedPipelineId(p.id); setSelectedStageId(null); }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.nome}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    SLA {formatSlaHuman(p.sla_total_minutos)}
                    {p.produto_id != null && ` · ${produtos.find(x => x.id === p.produto_id)?.nome ?? "produto"}`}
                  </p>
                </div>
                {!p.ativo && <Badge variant="outline" className="text-[9px]">off</Badge>}
                <Button
                  variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); setPipelineEditing(p); }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Coluna 2: Etapas */}
      <div className="flex flex-col border border-border rounded-lg bg-card/50 min-h-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Etapas {selectedPipelineId && `· ${pipelines.find(p => p.id === selectedPipelineId)?.nome}`}
          </span>
          <Button
            size="sm" variant="ghost" className="h-7 px-2"
            disabled={!selectedPipelineId}
            onClick={() => setStageNewOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />Nova
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {!selectedPipelineId ? (
            <div className="text-xs text-muted-foreground text-center py-8">Selecione um pipeline</div>
          ) : stagesQuery.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : stages.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">Nenhuma etapa</div>
          ) : (
            <DndContext
              sensors={sensors} collisionDetection={closestCenter}
              onDragEnd={(e) => {
                if (!e.over || e.active.id === e.over.id) return;
                const oldIdx = stages.findIndex((s) => s.id === e.active.id);
                const newIdx = stages.findIndex((s) => s.id === e.over!.id);
                if (oldIdx < 0 || newIdx < 0) return;
                reorderStages(arrayMove(stages, oldIdx, newIdx));
              }}
            >
              <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {stages.map((s) => (
                  <SortableStageRow
                    key={s.id}
                    stage={s}
                    isSelected={selectedStageId === s.id}
                    onSelect={() => setSelectedStageId(s.id)}
                    onEdit={() => setStageEditing(s)}
                    onDelete={() => deleteStage(s.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      {/* Coluna 3: Checklist */}
      <div className="flex flex-col border border-border rounded-lg bg-card/50 min-h-0">
        <div className="px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Checklist</span>
          {selectedStage && <p className="text-xs text-foreground mt-0.5 truncate">{selectedStage.nome}</p>}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {!selectedStageId ? (
            <div className="text-xs text-muted-foreground text-center py-8">Selecione uma etapa</div>
          ) : (
            <ChecklistEditor
              items={checklist}
              loading={checklistQuery.isLoading}
              onAdd={addChecklistItem}
              onUpdate={updateChecklistItem}
              onDelete={deleteChecklistItem}
              onReorder={reorderChecklist}
              sensors={sensors}
            />
          )}
        </div>
      </div>

      {/* Diálogos */}
      <PipelineDialog
        open={pipelineNewOpen || !!pipelineEditing}
        initial={pipelineEditing}
        produtos={produtos}
        onClose={() => { setPipelineNewOpen(false); setPipelineEditing(null); }}
        onSave={(p) => { savePipeline(p, !pipelineEditing); setPipelineNewOpen(false); setPipelineEditing(null); }}
        onDelete={pipelineEditing ? () => { deletePipeline(pipelineEditing.id); setPipelineEditing(null); } : undefined}
        onToggleActive={pipelineEditing ? (v) => toggleActivePipeline(pipelineEditing.id, v) : undefined}
      />
      <StageDialog
        open={stageNewOpen || !!stageEditing}
        initial={stageEditing}
        onClose={() => { setStageNewOpen(false); setStageEditing(null); }}
        onSave={(s) => { saveStage(s, !stageEditing); setStageNewOpen(false); setStageEditing(null); }}
      />
    </div>
  );
}

// ============================================================================
// Sortable stage row
// ============================================================================
function SortableStageRow({
  stage, isSelected, onSelect, onEdit, onDelete,
}: {
  stage: Stage; isSelected: boolean;
  onSelect: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef} style={style}
      onClick={onSelect}
      className={`group flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
        isSelected ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/50"
      } ${!stage.ativo ? "opacity-60" : ""}`}
    >
      <button {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}
        className="cursor-grab active:cursor-grabbing text-muted-foreground p-0.5">
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: stage.cor || "#6B7280" }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate">{stage.nome}</p>
          {stage.is_initial && <Flag className="h-3 w-3 text-primary" />}
          {stage.is_final && <Flag className="h-3 w-3 text-destructive" />}
          {stage.pausa_sla && <Pause className="h-3 w-3 text-amber-500" />}
        </div>
        <p className="text-[10px] text-muted-foreground">SLA {formatSlaHuman(stage.sla_minutos)}</p>
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}>
        <Pencil className="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}>
        <Trash2 className="h-3 w-3 text-destructive" />
      </Button>
    </div>
  );
}

// ============================================================================
// Checklist editor
// ============================================================================
function ChecklistEditor({
  items, loading, onAdd, onUpdate, onDelete, onReorder, sensors,
}: {
  items: ChecklistItem[]; loading: boolean;
  onAdd: (t: string) => void;
  onUpdate: (id: string, patch: Partial<ChecklistItem>) => void;
  onDelete: (id: string) => void;
  onReorder: (items: ChecklistItem[]) => void;
  sensors: any;
}) {
  const [novo, setNovo] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          placeholder="Novo item do checklist"
          className="h-8 text-sm"
          onKeyDown={(e) => { if (e.key === "Enter" && novo.trim()) { onAdd(novo); setNovo(""); } }}
        />
        <Button size="icon" className="h-8 w-8"
          onClick={() => { if (novo.trim()) { onAdd(novo); setNovo(""); } }}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">Nenhum item</div>
      ) : (
        <DndContext
          sensors={sensors} collisionDetection={closestCenter}
          onDragEnd={(e) => {
            if (!e.over || e.active.id === e.over.id) return;
            const oldIdx = items.findIndex((i) => i.id === e.active.id);
            const newIdx = items.findIndex((i) => i.id === e.over!.id);
            if (oldIdx < 0 || newIdx < 0) return;
            onReorder(arrayMove(items, oldIdx, newIdx));
          }}
        >
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {items.map((it) => (
                <SortableChecklistRow key={it.id} item={it} onUpdate={onUpdate} onDelete={onDelete} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
        <span className="inline-block w-2 h-2 rounded-full bg-destructive/70 mr-1 align-middle" />
        Itens obrigatórios travam a passagem de etapa.
      </p>
    </div>
  );
}

function SortableChecklistRow({
  item, onUpdate, onDelete,
}: {
  item: ChecklistItem;
  onUpdate: (id: string, patch: Partial<ChecklistItem>) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.texto);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}
      className={`group flex items-center gap-1.5 p-1.5 rounded-md border bg-card ${item.is_required ? "border-destructive/40" : "border-border"}`}>
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground p-0.5">
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {item.is_required && <span className="h-2 w-2 rounded-full bg-destructive/70 shrink-0" title="Obrigatório" />}
      {editing ? (
        <Input
          value={val} autoFocus className="h-7 text-xs"
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { setEditing(false); if (val.trim() && val.trim() !== item.texto) onUpdate(item.id, { texto: val.trim() }); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setVal(item.texto); setEditing(false); } }}
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex-1 text-left text-xs truncate">
          {item.texto}
        </button>
      )}
      <div className="flex items-center gap-1 shrink-0">
        <Switch
          checked={item.is_required}
          onCheckedChange={(v) => onUpdate(item.id, { is_required: v })}
          className="scale-75"
        />
        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"
          onClick={() => onDelete(item.id)}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Pipeline dialog
// ============================================================================
function PipelineDialog({
  open, initial, produtos, onClose, onSave, onDelete, onToggleActive,
}: {
  open: boolean; initial: Pipeline | null; produtos: Produto[];
  onClose: () => void;
  onSave: (p: Partial<Pipeline> & { id?: string }) => void;
  onDelete?: () => void;
  onToggleActive?: (v: boolean) => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [produtoId, setProdutoId] = useState<string>("__all__");
  const [slaMin, setSlaMin] = useState(0);
  const [ativo, setAtivo] = useState(true);

  useEffect(() => {
    if (open) {
      setNome(initial?.nome ?? "");
      setDescricao(initial?.descricao ?? "");
      setProdutoId(initial?.produto_id != null ? String(initial.produto_id) : "__all__");
      setSlaMin(initial?.sla_total_minutos ?? 0);
      setAtivo(initial?.ativo ?? true);
    }
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar pipeline" : "Novo pipeline"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Nome *</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Produto</Label>
            <Select value={produtoId} onValueChange={setProdutoId}>
              <SelectTrigger><SelectValue placeholder="Universal (todos os produtos)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Universal (todos os produtos)</SelectItem>
                {produtos.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SlaInput label="SLA total" value={slaMin} onChange={setSlaMin} hideMinutes />
          {initial && onToggleActive && (
            <div className="flex items-center justify-between pt-1 border-t border-border">
              <Label className="text-sm">Ativo</Label>
              <Switch checked={ativo} onCheckedChange={(v) => { setAtivo(v); onToggleActive(v); }} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {onDelete && (
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4 mr-1" /> Remover
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button disabled={!nome.trim()} onClick={() => onSave({
              id: initial?.id,
              nome, descricao,
              produto_id: produtoId === "__all__" ? null : Number(produtoId),
              sla_total_minutos: slaMin,
              ativo,
            })}>Salvar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Stage dialog
// ============================================================================
function StageDialog({
  open, initial, onClose, onSave,
}: {
  open: boolean; initial: Stage | null;
  onClose: () => void;
  onSave: (s: Partial<Stage> & { id?: string }) => void;
}) {
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slaMin, setSlaMin] = useState(0);
  const [cor, setCor] = useState(DEFAULT_COLORS[0]);
  const [isInitial, setIsInitial] = useState(false);
  const [isFinal, setIsFinal] = useState(false);
  const [pausaSla, setPausaSla] = useState(false);
  const [ativo, setAtivo] = useState(true);

  useEffect(() => {
    if (open) {
      setNome(initial?.nome ?? "");
      setSlug(initial?.slug ?? "");
      setSlaMin(initial?.sla_minutos ?? 0);
      setCor(initial?.cor ?? DEFAULT_COLORS[0]);
      setIsInitial(!!initial?.is_initial);
      setIsFinal(!!initial?.is_final);
      setPausaSla(!!initial?.pausa_sla);
      setAtivo(initial?.ativo ?? true);
    }
  }, [open, initial]);

  const autoSlug = useMemo(() => slugify(nome), [nome]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar etapa" : "Nova etapa"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Nome *</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label>Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)}
              placeholder={autoSlug || "auto-gerado do nome"} />
          </div>
          <SlaInput label="SLA da etapa" value={slaMin} onChange={setSlaMin} />
          <div className="space-y-1.5">
            <Label>Cor</Label>
            <div className="flex items-center gap-2 flex-wrap">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c} type="button" onClick={() => setCor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition-transform ${cor === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
              <input type="color" value={cor} onChange={(e) => setCor(e.target.value)}
                className="h-7 w-9 rounded border border-border bg-transparent cursor-pointer" />
            </div>
          </div>
          <div className="space-y-2 pt-1 border-t border-border">
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-1.5">
                <Flag className="h-3.5 w-3.5 text-primary" /> Etapa inicial
              </Label>
              <Switch checked={isInitial} onCheckedChange={setIsInitial} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-1.5">
                <Flag className="h-3.5 w-3.5 text-destructive" /> Etapa final
              </Label>
              <Switch checked={isFinal} onCheckedChange={setIsFinal} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-1.5">
                <Pause className="h-3.5 w-3.5 text-amber-500" /> Pausar SLA nesta etapa
              </Label>
              <Switch checked={pausaSla} onCheckedChange={setPausaSla} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Ativa</Label>
              <Switch checked={ativo} onCheckedChange={setAtivo} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!nome.trim()} onClick={() => onSave({
            id: initial?.id, nome, slug, sla_minutos: slaMin, cor,
            is_initial: isInitial, is_final: isFinal, pausa_sla: pausaSla, ativo,
          })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
