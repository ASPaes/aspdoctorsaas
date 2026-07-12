import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, GripVertical, Trash2, Loader2, AlertTriangle } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface VendorReturnReason {
  id: string;
  nome: string;
  ativo: boolean;
  atribuivel_vendedor: boolean;
  position: number;
}

function SortableRow({
  item, onToggleAtivo, onToggleAtrib, onRename, onDelete,
}: {
  item: VendorReturnReason;
  onToggleAtivo: (id: string, v: boolean) => void;
  onToggleAtrib: (id: string, v: boolean) => void;
  onRename: (id: string, nome: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.nome);
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
        <button onClick={() => setEditing(true)} className="flex-1 text-left text-sm truncate hover:text-primary flex items-center gap-2">
          <span className="truncate">{item.nome}</span>
          {item.atribuivel_vendedor && (
            <Badge className="text-[9px] border-0 text-white shrink-0" style={{ backgroundColor: "hsl(38 92% 50%)" }}>
              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> atribuível
            </Badge>
          )}
        </button>
      )}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Atribuível</span>
        <Switch checked={item.atribuivel_vendedor} onCheckedChange={(v) => onToggleAtrib(item.id, v)} />
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Ativo</span>
        <Switch checked={item.ativo} onCheckedChange={(v) => onToggleAtivo(item.id, v)} />
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

export function VendorReturnReasonsPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const [novoAtrib, setNovoAtrib] = useState(false);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const KEY = "onb-vendor-return-reasons";

  const { data: items = [], isLoading } = useQuery({
    queryKey: [KEY, effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_vendor_return_reasons" as any) as any)
        .select("id, nome, ativo, atribuivel_vendedor, position")
        .eq("tenant_id", effectiveTenantId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as VendorReturnReason[];
    },
  });

  async function handleAdd() {
    if (!novo.trim() || !effectiveTenantId) return;
    setSaving(true);
    try {
      const maxPos = items.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
      const { error } = await (supabase.from("onboarding_vendor_return_reasons" as any) as any).insert({
        tenant_id: effectiveTenantId,
        nome: novo.trim(),
        ativo: true,
        atribuivel_vendedor: novoAtrib,
        position: maxPos + 1,
      });
      if (error) throw error;
      setNovo("");
      setNovoAtrib(false);
      toast.success("Motivo adicionado");
      qc.invalidateQueries({ queryKey: [KEY] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar");
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(id: string, nome: string) {
    const { error } = await (supabase.from("onboarding_vendor_return_reasons" as any) as any)
      .update({ nome }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function handleToggleAtivo(id: string, ativo: boolean) {
    const { error } = await (supabase.from("onboarding_vendor_return_reasons" as any) as any)
      .update({ ativo }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function handleToggleAtrib(id: string, v: boolean) {
    const { error } = await (supabase.from("onboarding_vendor_return_reasons" as any) as any)
      .update({ atribuivel_vendedor: v }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este motivo?")) return;
    const { error } = await (supabase.from("onboarding_vendor_return_reasons" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else { toast.success("Removido"); qc.invalidateQueries({ queryKey: [KEY] }); }
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(items, oldIdx, newIdx);
    qc.setQueryData([KEY, effectiveTenantId], reordered.map((r, i) => ({ ...r, position: i + 1 })));
    try {
      await Promise.all(reordered.map((r, i) =>
        (supabase.from("onboarding_vendor_return_reasons" as any) as any)
          .update({ position: i + 1 }).eq("id", r.id).eq("tenant_id", effectiveTenantId)
      ));
    } catch {
      toast.error("Erro ao reordenar");
      qc.invalidateQueries({ queryKey: [KEY] });
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Atribuível ao vendedor</strong> = falha do vendedor (ex: faltou dado). Marcações não atribuíveis são impedimentos externos (ex: cliente não responde).
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          placeholder="Novo motivo de retorno ao vendedor"
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <label className="flex items-center gap-1.5 text-xs whitespace-nowrap px-2">
          <Switch checked={novoAtrib} onCheckedChange={setNovoAtrib} />
          Atribuível
        </label>
        <Button onClick={handleAdd} disabled={saving || !novo.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-md">
          Nenhum motivo cadastrado.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map((it) => (
                <SortableRow
                  key={it.id}
                  item={it}
                  onToggleAtivo={handleToggleAtivo}
                  onToggleAtrib={handleToggleAtrib}
                  onRename={handleRename}
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
