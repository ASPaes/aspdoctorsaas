import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  useOnboardingParticipantRoles,
  ONBOARDING_ROLES_QUERY_KEY,
  type OnboardingParticipantRole,
} from "@/hooks/useOnboardingParticipantRoles";
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
  item, onToggle, onRename, onRecolor, onDelete,
}: {
  item: OnboardingParticipantRole;
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
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 p-2 rounded-md border border-border bg-card">
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1">
        <GripVertical className="h-4 w-4" />
      </button>

      <input
        type="color"
        value={item.cor}
        onChange={(e) => onRecolor(item.id, e.target.value)}
        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        title="Cor do papel"
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
        <button onClick={() => setEditing(true)} className="flex-1 text-left text-sm truncate hover:opacity-80" style={{ color: item.cor }}>
          {item.nome}
        </button>
      )}

      {isSystem ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground px-1.5">
                <Lock className="h-3 w-3" /> Padrão
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[240px] text-xs">
              Papel usado pelo sistema. Pode ser renomeado e recolorido, mas não desativado nem excluído.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Ativo</span>
            <Switch checked={item.ativo} onCheckedChange={(v) => onToggle(item.id, v)} />
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </>
      )}
    </div>
  );
}

export function ParticipantRolesPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const [novaCor, setNovaCor] = useState("#F59E0B");
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { data: items = [], isLoading } = useOnboardingParticipantRoles(effectiveTenantId);

  function invalidate() {
    qc.invalidateQueries({ queryKey: [ONBOARDING_ROLES_QUERY_KEY] });
  }

  async function handleAdd() {
    if (!novo.trim() || !effectiveTenantId) return;
    setSaving(true);
    try {
      const maxPos = items.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
      const { error } = await (supabase.from("onboarding_participant_roles" as any) as any).insert({
        tenant_id: effectiveTenantId,
        nome: novo.trim(),
        cor: novaCor,
        ativo: true,
        position: maxPos + 1,
      });
      if (error) throw error;
      setNovo("");
      toast.success("Papel adicionado");
      invalidate();
    } catch (e: any) {
      toast.error(e.code === "23505" ? "Já existe um papel com esse nome" : (e.message || "Erro ao adicionar"));
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, campos: Record<string, unknown>) {
    const { error } = await (supabase.from("onboarding_participant_roles" as any) as any)
      .update(campos).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else invalidate();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este papel? Participantes que já usam ele continuam como estão.")) return;
    const { error } = await (supabase.from("onboarding_participant_roles" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) {
      toast.error(error.code === "23503" ? "Este papel está em uso e não pode ser excluído. Desative-o." : error.message);
      return;
    }
    toast.success("Papel removido");
    invalidate();
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(items, oldIdx, newIdx);
    qc.setQueryData([ONBOARDING_ROLES_QUERY_KEY, effectiveTenantId, false], reordered.map((r, i) => ({ ...r, position: i + 1 })));
    try {
      await Promise.all(reordered.map((r, i) =>
        (supabase.from("onboarding_participant_roles" as any) as any)
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
            title="Cor do papel"
          />
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Novo papel (ex: Financeiro)"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Button onClick={handleAdd} disabled={saving || !novo.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Adicionar</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Papéis aparecem no bloco “Responsável &amp; participantes” da jornada. Os 4 padrões podem ser renomeados, mas não removidos.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-md">
          Nenhum papel cadastrado.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map((it) => (
                <SortableRow
                  key={it.id}
                  item={it}
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
