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
  Plus, GripVertical, Trash2, Loader2, Pencil, Flag, Pause, ChevronRight, Timer,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SlaInput } from "./SlaInput";
import { formatSlaHuman, slugify } from "./utils";

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
  { key: "acompanhamento", label: "Acompanhamento de uso (indicadores)" },
];
const ALL_SECTION_KEYS = SECTION_OPTIONS.map((s) => s.key);

interface Pipeline {
  id: string;
  nome: string;
  descricao: string | null;
  phase_id: string;
  produto_id: number | null;
  sla_total_minutos: number | null;
  ativo: boolean;
  position: number;
  /** Setor cujo expediente mede o SLA. NULL = setor do ticket, depois horário global. */
  department_id: string | null;
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
  /** Entrar nesta etapa dispara a contagem de SLA. No máximo uma por pipeline. */
  inicia_sla: boolean;
}

interface ChecklistGroup {
  id: string;
  stage_id: string;
  nome: string;
  position: number;
}

interface ChecklistItem {
  id: string;
  stage_id: string;
  group_id: string | null;
  texto: string;
  is_required: boolean;
  position: number;
  ativo: boolean;
}

interface Produto { id: number; nome: string; }
interface Departamento { id: string; name: string; }

const DEFAULT_COLORS = ["#22C55E", "#0EA5E9", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#6B7280"];

interface Props {
  /** Jornada selecionada (onboarding_phases.id). Null enquanto o cadastro carrega. */
  phaseId: string | null;
}

export function PipelinesPanel({ phaseId }: Props) {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [pipelineEditing, setPipelineEditing] = useState<Pipeline | null>(null);
  const [pipelineNewOpen, setPipelineNewOpen] = useState(false);
  const [stageEditing, setStageEditing] = useState<Stage | null>(null);
  const [stageNewOpen, setStageNewOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Reset seleção quando a jornada muda
  useEffect(() => {
    setSelectedPipelineId(null);
    setSelectedStageId(null);
  }, [phaseId]);

  const pipelinesQuery = useQuery({
    queryKey: ["onb-pipelines", effectiveTenantId, phaseId],
    enabled: !!effectiveTenantId && !!phaseId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome, descricao, phase_id, produto_id, sla_total_minutos, ativo, position, department_id")
        .eq("tenant_id", effectiveTenantId).eq("phase_id", phaseId).order("position");
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

  const departamentosQuery = useQuery({
    queryKey: ["onb-departamentos", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("support_departments")
        .select("id, name").eq("tenant_id", effectiveTenantId!).order("name");
      if (error) throw error;
      return (data ?? []) as Departamento[];
    },
  });

  const stagesQuery = useQuery({
    queryKey: ["onb-stages", effectiveTenantId, selectedPipelineId],
    enabled: !!effectiveTenantId && !!selectedPipelineId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stages" as any) as any)
        .select("id, pipeline_id, nome, slug, position, sla_minutos, cor, is_initial, is_final, pausa_sla, ativo, visible_sections, inicia_sla")
        .eq("tenant_id", effectiveTenantId).eq("pipeline_id", selectedPipelineId).order("position");
      if (error) throw error;
      return (data ?? []) as Stage[];
    },
  });

  const groupsQuery = useQuery({
    queryKey: ["onb-checklist-groups", effectiveTenantId, selectedStageId],
    enabled: !!effectiveTenantId && !!selectedStageId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stage_checklist_groups" as any) as any)
        .select("id, stage_id, nome, position")
        .eq("tenant_id", effectiveTenantId).eq("stage_id", selectedStageId).order("position");
      if (error) throw error;
      return (data ?? []) as ChecklistGroup[];
    },
  });

  const checklistQuery = useQuery({
    queryKey: ["onb-checklist", effectiveTenantId, selectedStageId],
    enabled: !!effectiveTenantId && !!selectedStageId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_stage_checklist" as any) as any)
        .select("id, stage_id, group_id, texto, is_required, position, ativo")
        .eq("tenant_id", effectiveTenantId).eq("stage_id", selectedStageId).order("position");
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
  });

  const pipelines = pipelinesQuery.data ?? [];
  const stages = stagesQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const checklist = checklistQuery.data ?? [];
  const produtos = produtosQuery.data ?? [];
  const departamentos = departamentosQuery.data ?? [];

  // ==================== Pipeline ops ====================
  async function savePipeline(p: Partial<Pipeline> & { id?: string }, isNew: boolean) {
    if (!effectiveTenantId || !p.nome?.trim()) return;
    const payload: any = {
      nome: p.nome.trim(),
      descricao: p.descricao?.trim() || null,
      phase_id: phaseId,
      produto_id: p.produto_id ?? null,
      sla_total_minutos: p.sla_total_minutos ?? 0,
      ativo: p.ativo ?? true,
      department_id: p.department_id ?? null,
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
      inicia_sla: !!s.inicia_sla,
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
      // índice único parcial uq_onb_stage_inicia_sla_por_pipeline
      if (e?.code === "23505" && String(e?.message ?? "").includes("inicia_sla")) {
        toast.error("Outra etapa deste pipeline já inicia a contagem de SLA. Desmarque nela antes.");
      } else {
        toast.error(e.message || "Erro ao salvar");
      }
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

  // ==================== Checklist group ops ====================
  async function addGroup(nome: string) {
    if (!effectiveTenantId || !selectedStageId || !nome.trim()) return;
    const maxPos = groups.reduce((m, g) => Math.max(m, g.position ?? 0), 0);
    const { error } = await (supabase.from("onboarding_stage_checklist_groups" as any) as any).insert({
      tenant_id: effectiveTenantId,
      stage_id: selectedStageId,
      nome: nome.trim(),
      position: maxPos + 1,
    });
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-checklist-groups"] });
  }

  async function renameGroup(id: string, nome: string) {
    if (!nome.trim()) return;
    const { error } = await (supabase.from("onboarding_stage_checklist_groups" as any) as any)
      .update({ nome: nome.trim() }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-checklist-groups"] });
  }

  async function deleteGroup(id: string) {
    if (!confirm("Remover este checklist e todos os seus itens?")) return;
    const { error } = await (supabase.from("onboarding_stage_checklist_groups" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["onb-checklist-groups"] });
      qc.invalidateQueries({ queryKey: ["onb-checklist"] });
    }
  }

  async function reorderGroups(reordered: ChecklistGroup[]) {
    qc.setQueryData(["onb-checklist-groups", effectiveTenantId, selectedStageId],
      reordered.map((g, i) => ({ ...g, position: i + 1 })));
    try {
      await Promise.all(reordered.map((g, i) =>
        (supabase.from("onboarding_stage_checklist_groups" as any) as any)
          .update({ position: i + 1 }).eq("id", g.id).eq("tenant_id", effectiveTenantId)
      ));
    } catch {
      toast.error("Erro ao reordenar checklists");
      qc.invalidateQueries({ queryKey: ["onb-checklist-groups"] });
    }
  }

  // ==================== Checklist item ops ====================
  async function addChecklistItem(groupId: string, texto: string) {
    if (!effectiveTenantId || !selectedStageId || !texto.trim()) return;
    const maxPos = checklist
      .filter((i) => i.group_id === groupId)
      .reduce((m, i) => Math.max(m, i.position ?? 0), 0);
    const { error } = await (supabase.from("onboarding_stage_checklist" as any) as any).insert({
      tenant_id: effectiveTenantId,
      stage_id: selectedStageId,
      group_id: groupId,
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

  async function reorderChecklist(groupId: string, reordered: ChecklistItem[]) {
    qc.setQueryData(["onb-checklist", effectiveTenantId, selectedStageId],
      (old: ChecklistItem[] | undefined) => {
        const others = (old ?? []).filter((i) => i.group_id !== groupId);
        const updated = reordered.map((r, i) => ({ ...r, position: i + 1 }));
        return [...others, ...updated];
      });
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
              groups={groups}
              items={checklist}
              loading={checklistQuery.isLoading || groupsQuery.isLoading}
              onAddGroup={addGroup}
              onRenameGroup={renameGroup}
              onDeleteGroup={deleteGroup}
              onReorderGroups={reorderGroups}
              onAddItem={addChecklistItem}
              onUpdateItem={updateChecklistItem}
              onDeleteItem={deleteChecklistItem}
              onReorderItems={reorderChecklist}
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
        departamentos={departamentos}
        onClose={() => { setPipelineNewOpen(false); setPipelineEditing(null); }}
        onSave={(p) => { savePipeline(p, !pipelineEditing); setPipelineNewOpen(false); setPipelineEditing(null); }}
        onDelete={pipelineEditing ? () => { deletePipeline(pipelineEditing.id); setPipelineEditing(null); } : undefined}
        onToggleActive={pipelineEditing ? (v) => toggleActivePipeline(pipelineEditing.id, v) : undefined}
      />
      <StageDialog
        open={stageNewOpen || !!stageEditing}
        initial={stageEditing}
        gatilhoStage={stages.find((s) => s.inicia_sla) ?? null}
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
          {stage.inicia_sla && <Timer className="h-3 w-3 text-[hsl(199_89%_48%)]" />}
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
  groups, items, loading,
  onAddGroup, onRenameGroup, onDeleteGroup, onReorderGroups,
  onAddItem, onUpdateItem, onDeleteItem, onReorderItems, sensors,
}: {
  groups: ChecklistGroup[];
  items: ChecklistItem[];
  loading: boolean;
  onAddGroup: (nome: string) => void;
  onRenameGroup: (id: string, nome: string) => void;
  onDeleteGroup: (id: string) => void;
  onReorderGroups: (groups: ChecklistGroup[]) => void;
  onAddItem: (groupId: string, texto: string) => void;
  onUpdateItem: (id: string, patch: Partial<ChecklistItem>) => void;
  onDeleteItem: (id: string) => void;
  onReorderItems: (groupId: string, items: ChecklistItem[]) => void;
  sensors: any;
}) {
  const [novoGrupo, setNovoGrupo] = useState("");
  const itemsByGroup = useMemo(() => {
    const map: Record<string, ChecklistItem[]> = {};
    for (const it of items) {
      const k = it.group_id ?? "__none__";
      (map[k] ??= []).push(it);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return map;
  }, [items]);
  const ungrouped = itemsByGroup["__none__"] ?? [];

  return (
    <div className="space-y-3">
      {/* Novo checklist (grupo) */}
      <div className="flex items-center gap-1">
        <Input
          value={novoGrupo}
          onChange={(e) => setNovoGrupo(e.target.value)}
          placeholder="Adicionar checklist"
          className="h-8 text-sm"
          onKeyDown={(e) => { if (e.key === "Enter" && novoGrupo.trim()) { onAddGroup(novoGrupo); setNovoGrupo(""); } }}
        />
        <Button size="icon" className="h-8 w-8"
          onClick={() => { if (novoGrupo.trim()) { onAddGroup(novoGrupo); setNovoGrupo(""); } }}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : groups.length === 0 && ungrouped.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">Nenhum checklist. Crie um acima.</div>
      ) : (
        <>
          <DndContext
            sensors={sensors} collisionDetection={closestCenter}
            onDragEnd={(e) => {
              if (!e.over || e.active.id === e.over.id) return;
              const oldIdx = groups.findIndex((g) => g.id === e.active.id);
              const newIdx = groups.findIndex((g) => g.id === e.over!.id);
              if (oldIdx < 0 || newIdx < 0) return;
              onReorderGroups(arrayMove(groups, oldIdx, newIdx));
            }}
          >
            <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {groups.map((g) => (
                  <SortableGroup
                    key={g.id}
                    group={g}
                    items={itemsByGroup[g.id] ?? []}
                    sensors={sensors}
                    onRename={onRenameGroup}
                    onDelete={onDeleteGroup}
                    onAddItem={onAddItem}
                    onUpdateItem={onUpdateItem}
                    onDeleteItem={onDeleteItem}
                    onReorderItems={onReorderItems}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {ungrouped.length > 0 && (
            <div className="rounded-md border border-dashed border-border p-2 space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide px-1">Sem checklist</p>
              {ungrouped.map((it) => (
                <div key={it.id} className="flex items-center gap-1.5 p-1.5 rounded-md border border-border bg-card">
                  {it.is_required && <span className="h-2 w-2 rounded-full bg-destructive/70 shrink-0" title="Obrigatório" />}
                  <span className="flex-1 text-xs truncate">{it.texto}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDeleteItem(it.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
        <span className="inline-block w-2 h-2 rounded-full bg-destructive/70 mr-1 align-middle" />
        Itens obrigatórios travam a passagem de etapa.
      </p>
    </div>
  );
}

// ============================================================================
// Sortable checklist group (Trello: checklist nomeado com seus itens)
// ============================================================================
function SortableGroup({
  group, items, sensors, onRename, onDelete, onAddItem, onUpdateItem, onDeleteItem, onReorderItems,
}: {
  group: ChecklistGroup;
  items: ChecklistItem[];
  sensors: any;
  onRename: (id: string, nome: string) => void;
  onDelete: (id: string) => void;
  onAddItem: (groupId: string, texto: string) => void;
  onUpdateItem: (id: string, patch: Partial<ChecklistItem>) => void;
  onDeleteItem: (id: string) => void;
  onReorderItems: (groupId: string, items: ChecklistItem[]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const [novo, setNovo] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(group.nome);

  return (
    <div ref={setNodeRef} style={style} className="rounded-md border border-border bg-card/40">
      {/* Header do grupo */}
      <div className="group/head flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground p-0.5">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        {editingName ? (
          <Input
            value={nameVal} autoFocus className="h-7 text-xs font-semibold"
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={() => { setEditingName(false); if (nameVal.trim() && nameVal.trim() !== group.nome) onRename(group.id, nameVal.trim()); else setNameVal(group.nome); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setNameVal(group.nome); setEditingName(false); } }}
          />
        ) : (
          <button onClick={() => setEditingName(true)} className="flex-1 text-left text-xs font-semibold truncate">
            {group.nome}
          </button>
        )}
        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{items.length}</Badge>
        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover/head:opacity-100"
          onClick={() => onDelete(group.id)}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>

      {/* Itens do grupo */}
      <div className="p-2 space-y-1.5">
        <div className="flex items-center gap-1">
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Novo item do checklist"
            className="h-8 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && novo.trim()) { onAddItem(group.id, novo); setNovo(""); } }}
          />
          <Button size="icon" className="h-8 w-8"
            onClick={() => { if (novo.trim()) { onAddItem(group.id, novo); setNovo(""); } }}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {items.length === 0 ? (
          <div className="text-[11px] text-muted-foreground text-center py-2">Nenhum item</div>
        ) : (
          <DndContext
            sensors={sensors} collisionDetection={closestCenter}
            onDragEnd={(e) => {
              if (!e.over || e.active.id === e.over.id) return;
              const oldIdx = items.findIndex((i) => i.id === e.active.id);
              const newIdx = items.findIndex((i) => i.id === e.over!.id);
              if (oldIdx < 0 || newIdx < 0) return;
              onReorderItems(group.id, arrayMove(items, oldIdx, newIdx));
            }}
          >
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {items.map((it) => (
                  <SortableChecklistRow key={it.id} item={it} onUpdate={onUpdateItem} onDelete={onDeleteItem} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
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
  open, initial, produtos, departamentos, onClose, onSave, onDelete, onToggleActive,
}: {
  open: boolean; initial: Pipeline | null; produtos: Produto[]; departamentos: Departamento[];
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
  const [departmentId, setDepartmentId] = useState<string>("__none__");

  useEffect(() => {
    if (open) {
      setNome(initial?.nome ?? "");
      setDescricao(initial?.descricao ?? "");
      setProdutoId(initial?.produto_id != null ? String(initial.produto_id) : "__all__");
      setSlaMin(initial?.sla_total_minutos ?? 0);
      setAtivo(initial?.ativo ?? true);
      setDepartmentId(initial?.department_id ?? "__none__");
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Produto</Label>
              <Select value={produtoId} onValueChange={setProdutoId}>
                <SelectTrigger><SelectValue placeholder="Universal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Universal (todos)</SelectItem>
                  {produtos.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Setor</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="Horário global" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Horário global</SelectItem>
                  {departamentos.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              department_id: departmentId === "__none__" ? null : departmentId,
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
  open, initial, gatilhoStage, onClose, onSave,
}: {
  open: boolean; initial: Stage | null;
  /** Etapa que hoje detém a flag de início de SLA neste pipeline (se houver). */
  gatilhoStage: Stage | null;
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
  const [iniciaSla, setIniciaSla] = useState(false);
  const [visibleSections, setVisibleSections] = useState<string[]>(ALL_SECTION_KEYS);
  const [secoesOpen, setSecoesOpen] = useState(false);

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
      setIniciaSla(!!initial?.inicia_sla);
      setVisibleSections(initial?.visible_sections ?? ALL_SECTION_KEYS);
      setSecoesOpen(false);
    }
  }, [open, initial]);

  function toggleSection(key: string) {
    setVisibleSections((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  const autoSlug = useMemo(() => slugify(nome), [nome]);

  // Só uma etapa por pipeline pode iniciar o SLA. Se outra já detém a flag, esta
  // perde a opção — para trocar, desmarque na etapa que a tem hoje.
  const gatilhoEmOutra = !!gatilhoStage && gatilhoStage.id !== initial?.id;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar etapa" : "Nova etapa"}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-2 -mx-2 py-1 -my-1">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)}
                placeholder={autoSlug || "auto-gerado do nome"} />
            </div>

            <div className="space-y-1.5">
              <Label>Cor</Label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c} type="button" onClick={() => setCor(c)}
                    aria-label={`Cor ${c}`} aria-pressed={cor === c}
                    className={`h-7 w-7 rounded-full border-2 transition-transform ${cor === c ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
                <input type="color" value={cor} onChange={(e) => setCor(e.target.value)}
                  aria-label="Cor personalizada"
                  className="h-7 w-9 rounded border border-border bg-transparent cursor-pointer" />
              </div>
            </div>
            <SlaInput label="SLA da etapa" value={slaMin} onChange={setSlaMin} />
          </div>

          <div className="space-y-1.5 mt-4">
            <Label>Comportamento</Label>
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-3">
                <ToggleRow
                  icon={<Flag className="h-3.5 w-3.5 text-primary" />}
                  label="Etapa inicial" checked={isInitial} onChange={setIsInitial}
                  className="border-b border-border sm:border-r"
                />
                <ToggleRow
                  icon={<Flag className="h-3.5 w-3.5 text-destructive" />}
                  label="Etapa final" checked={isFinal} onChange={setIsFinal}
                  className="border-b border-border sm:border-r"
                />
                <ToggleRow
                  icon={<Pause className="h-3.5 w-3.5 text-amber-500" />}
                  label="Pausar SLA" checked={pausaSla} onChange={setPausaSla}
                  className="border-b border-border"
                />
              </div>
              <ToggleRow
                icon={<Timer className="h-3.5 w-3.5 text-[hsl(199_89%_48%)]" />}
                label="Inicia a contagem de SLA"
                checked={iniciaSla} onChange={setIniciaSla}
                disabled={gatilhoEmOutra}
                hint={gatilhoEmOutra
                  ? `Já definida em «${gatilhoStage!.nome}» — desmarque lá para usar aqui`
                  : "O cronômetro parte quando a jornada entra nesta etapa"}
              />
            </div>
          </div>

          {/* --- avançado: seções visíveis --- */}
          <Collapsible open={secoesOpen} onOpenChange={setSecoesOpen} className="mt-5">
            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-muted/40 transition-colors">
              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${secoesOpen ? "rotate-90" : ""}`} />
              <span className="text-sm font-medium flex-1">Seções visíveis nesta etapa</span>
              <Badge variant="outline" className="text-[10px]">
                {visibleSections.length} de {ALL_SECTION_KEYS.length}
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-3">
                <p className="text-[11px] text-muted-foreground mb-2">
                  As seções desmarcadas ficam ocultas no detalhe da jornada quando ela está nesta etapa.
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
                  {SECTION_OPTIONS.map((opt) => {
                    const checked = visibleSections.includes(opt.key);
                    return (
                      <label
                        key={opt.key}
                        className="flex items-start gap-2 text-xs cursor-pointer rounded-md border border-border/50 p-2 hover:bg-muted/40 transition-colors"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleSection(opt.key)}
                          className="mt-0.5"
                        />
                        <span className="leading-tight">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="sm:justify-between items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch checked={ativo} onCheckedChange={setAtivo} />
            <span className="text-sm">Etapa ativa</span>
          </label>
          <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!nome.trim()} onClick={() => onSave({
            id: initial?.id, nome, slug, sla_minutos: slaMin, cor,
            is_initial: isInitial, is_final: isFinal, pausa_sla: pausaSla, ativo,
            visible_sections: visibleSections,
            inicia_sla: gatilhoEmOutra ? false : iniciaSla,
          })}>Salvar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Linha densa de switch dentro do bloco "Comportamento". */
function ToggleRow({
  icon, label, hint, checked, onChange, disabled, className,
}: {
  icon?: React.ReactNode; label: string; hint?: string;
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 ${disabled ? "opacity-60" : ""} ${className ?? ""}`}>
      {icon ? <span className="shrink-0">{icon}</span> : <span className="w-3.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <Label className="text-sm font-normal leading-tight block">{label}</Label>
        {hint && <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} className="shrink-0" />
    </div>
  );
}
