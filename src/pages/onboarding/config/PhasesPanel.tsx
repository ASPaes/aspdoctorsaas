import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  useOnboardingPhases,
  ONBOARDING_PHASES_QUERY_KEY,
  type OnboardingPhase,
} from "@/hooks/useOnboardingPhases";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, GripVertical, Trash2, Loader2, Lock } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableRow({
  item, podeDesativar, onToggle, onRename, onRecolor, onDelete,
}: {
  item: OnboardingPhase;
  podeDesativar: boolean;
  onToggle: (id: string, v: boolean) => void;
  onRename: (id: string, nome: string) => void;
  onRecolor: (id: string, cor: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.nome);
  const isSystem = item.slug !== null;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded-md border border-border bg-card ${item.ativo ? "" : "opacity-60"}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1">
        <GripVertical className="h-4 w-4" />
      </button>

      <input
        type="color"
        value={item.cor ?? "#6B7280"}
        onChange={(e) => onRecolor(item.id, e.target.value)}
        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        title="Cor da jornada"
      />

      {editing ? (
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { setEditing(false); if (val.trim() && val.trim() !== item.nome) onRename(item.id, val.trim()); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setVal(item.nome); setEditing(false); } }}
          autoFocus
          className="h-8"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex-1 text-left text-sm truncate hover:opacity-80" style={{ color: item.cor ?? undefined }}>
          {item.nome}
          {isSystem && <span className="ml-2 font-mono text-[10px] text-muted-foreground">{item.slug}</span>}
        </button>
      )}

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Ativa</span>
              <Switch
                checked={item.ativo}
                disabled={item.ativo && !podeDesativar}
                onCheckedChange={(v) => onToggle(item.id, v)}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[260px] text-xs">
            {item.ativo && !podeDesativar
              ? "É preciso manter ao menos uma jornada ativa."
              : "Jornada desativada some do quadro e da configuração. Nada é apagado."}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {isSystem ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground px-1.5">
                <Lock className="h-3 w-3" /> Padrão
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[260px] text-xs">
              Jornada padrão do sistema. Pode ser renomeada, recolorida, reordenada e desativada — mas não excluída.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      )}
    </div>
  );
}

export function PhasesPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const [novaCor, setNovaCor] = useState("#8B5CF6");
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // somenteAtivas: false — a configuração mostra também as desativadas, para religar.
  const { data: items = [], isLoading } = useOnboardingPhases(effectiveTenantId, { somenteAtivas: false });

  const qtdAtivas = items.filter((i) => i.ativo).length;

  function invalidate() {
    qc.invalidateQueries({ queryKey: [ONBOARDING_PHASES_QUERY_KEY] });
    // o quadro e a configuração de pipelines dependem da lista de jornadas
    qc.invalidateQueries({ queryKey: ["onboarding-pipelines"] });
  }

  async function handleAdd() {
    if (!novo.trim() || !effectiveTenantId) return;
    setSaving(true);
    try {
      const maxPos = items.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
      const { error } = await (supabase.from("onboarding_phases" as any) as any).insert({
        tenant_id: effectiveTenantId,
        nome: novo.trim(),
        cor: novaCor,
        ativo: true,
        position: maxPos + 1,
      });
      if (error) throw error;
      setNovo("");
      toast.success("Jornada adicionada");
      invalidate();
    } catch (e: any) {
      toast.error(e.code === "23505" ? "Já existe uma jornada com esse nome" : (e.message || "Erro ao adicionar"));
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, campos: Record<string, unknown>) {
    const { error } = await (supabase.from("onboarding_phases" as any) as any)
      .update(campos).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else invalidate();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover esta jornada? Só é possível se nenhum pipeline ou jornada apontar para ela.")) return;
    const { error } = await (supabase.from("onboarding_phases" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) {
      toast.error(error.code === "23503"
        ? "Esta jornada está em uso e não pode ser excluída. Desative-a."
        : error.message);
      return;
    }
    toast.success("Jornada removida");
    invalidate();
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(items, oldIdx, newIdx);
    qc.setQueryData(
      [ONBOARDING_PHASES_QUERY_KEY, effectiveTenantId, false],
      reordered.map((r, i) => ({ ...r, position: i + 1 })),
    );
    try {
      await Promise.all(reordered.map((r, i) =>
        (supabase.from("onboarding_phases" as any) as any)
          .update({ position: i + 1 }).eq("id", r.id).eq("tenant_id", effectiveTenantId)
      ));
    } catch {
      toast.error("Erro ao reordenar");
    } finally {
      invalidate();
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={novaCor}
            onChange={(e) => setNovaCor(e.target.value)}
            className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
            title="Cor da jornada"
          />
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Nova jornada (ex: Pós-venda)"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Button onClick={handleAdd} disabled={saving || !novo.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Adicionar</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A ordem aqui é a ordem das abas do quadro e do trilho da jornada. Com uma jornada ativa só,
          o quadro deixa de mostrar as abas.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-md">
          Nenhuma jornada cadastrada.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map((it) => (
                <SortableRow
                  key={it.id}
                  item={it}
                  podeDesativar={qtdAtivas > 1}
                  onToggle={(id, v) => patch(id, { ativo: v })}
                  onRename={(id, nome) => patch(id, { nome })}
                  onRecolor={(id, cor) => patch(id, { cor })}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
