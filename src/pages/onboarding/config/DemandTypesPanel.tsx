import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, GripVertical, Trash2, Loader2, Clock } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SlaInput } from "./SlaInput";
import { formatSlaHuman } from "./utils";

interface DemandType {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string | null;
  ativo: boolean;
  position: number;
  sla_total_minutos: number;
}

const COLOR_PRESETS = [
  "#22C55E", "#0EA5E9", "#8B5CF6", "#EC4899", "#F59E0B",
  "#EF4444", "#14B8A6", "#F97316", "#6366F1", "#6B7280",
];

function ColorPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value || "#6B7280");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-6 w-6 rounded border border-border shrink-0"
          style={{ background: value || "#6B7280" }}
          aria-label="Escolher cor"
        />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 space-y-2" align="start">
        <div className="grid grid-cols-5 gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); }}
              className="h-7 w-7 rounded border border-border hover:scale-110 transition"
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="h-8 w-10 rounded border border-border cursor-pointer"
          />
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 text-xs font-mono" />
          <Button size="sm" className="h-8" onClick={() => { onChange(custom); setOpen(false); }}>OK</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SlaPopover({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(value); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition shrink-0"
          title="Prazo prometido (referência) — não gera o go-live"
        >
          <Clock className="h-3 w-3" />
          {formatSlaHuman(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-3" align="end">
        <SlaInput label="Prazo prometido (referência)" value={draft} onChange={setDraft} />
        <p className="text-[10px] text-muted-foreground leading-tight">
          Não gera o go-live. Serve para avisar quando o plano de etapas não cabe na promessa.
        </p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button size="sm" className="h-8" onClick={() => { onChange(draft); setOpen(false); }}>Salvar</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SortableRow({
  item, onToggle, onRename, onColor, onSla, onDelete,
}: {
  item: DemandType;
  onToggle: (id: string, v: boolean) => void;
  onRename: (id: string, nome: string) => void;
  onColor: (id: string, cor: string) => void;
  onSla: (id: string, minutes: number) => void;
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
      <ColorPicker value={item.cor} onChange={(c) => onColor(item.id, c)} />
      {editing ? (
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { setEditing(false); if (val.trim() && val.trim() !== item.nome) onRename(item.id, val.trim()); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { setVal(item.nome); setEditing(false); }
          }}
          autoFocus
          className="h-8"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex-1 text-left text-sm truncate hover:text-primary">
          {item.nome}
        </button>
      )}
      <SlaPopover value={item.sla_total_minutos ?? 0} onChange={(m) => onSla(item.id, m)} />
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Ativo</span>
        <Switch checked={item.ativo} onCheckedChange={(v) => onToggle(item.id, v)} />
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

export function DemandTypesPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const [novaCor, setNovaCor] = useState("#0EA5E9");
  const [novoSla, setNovoSla] = useState(0);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["onb-demand-types", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_demand_types" as any) as any)
        .select("id, nome, descricao, cor, ativo, position, sla_total_minutos")
        .eq("tenant_id", effectiveTenantId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as DemandType[];
    },
  });

  async function handleAdd() {
    if (!novo.trim() || !effectiveTenantId) return;
    setSaving(true);
    try {
      const maxPos = items.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
      const { error } = await (supabase.from("onboarding_demand_types" as any) as any).insert({
        tenant_id: effectiveTenantId,
        nome: novo.trim(),
        cor: novaCor,
        ativo: true,
        position: maxPos + 1,
        sla_total_minutos: novoSla,
      });
      if (error) throw error;
      setNovo("");
      setNovoSla(0);
      toast.success("Tipo de demanda adicionado");
      qc.invalidateQueries({ queryKey: ["onb-demand-types"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar");
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(id: string, nome: string) {
    const { error } = await (supabase.from("onboarding_demand_types" as any) as any)
      .update({ nome }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-demand-types"] });
  }

  async function handleColor(id: string, cor: string) {
    const { error } = await (supabase.from("onboarding_demand_types" as any) as any)
      .update({ cor }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-demand-types"] });
  }

  async function handleToggle(id: string, ativo: boolean) {
    const { error } = await (supabase.from("onboarding_demand_types" as any) as any)
      .update({ ativo }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-demand-types"] });
  }

  async function handleSla(id: string, sla_total_minutos: number) {
    const { error } = await (supabase.from("onboarding_demand_types" as any) as any)
      .update({ sla_total_minutos }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else { toast.success("Prazo prometido atualizado"); qc.invalidateQueries({ queryKey: ["onb-demand-types"] }); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este tipo de demanda?")) return;
    const { error } = await (supabase.from("onboarding_demand_types" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else { toast.success("Removido"); qc.invalidateQueries({ queryKey: ["onb-demand-types"] }); }
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(items, oldIdx, newIdx);
    qc.setQueryData(["onb-demand-types", effectiveTenantId], reordered.map((r, i) => ({ ...r, position: i + 1 })));
    try {
      await Promise.all(reordered.map((r, i) =>
        (supabase.from("onboarding_demand_types" as any) as any)
          .update({ position: i + 1 }).eq("id", r.id).eq("tenant_id", effectiveTenantId)
      ));
    } catch {
      toast.error("Erro ao reordenar");
      qc.invalidateQueries({ queryKey: ["onb-demand-types"] });
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ColorPicker value={novaCor} onChange={setNovaCor} />
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Novo tipo de demanda (ex: Onboarding PDV Legal)"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Button onClick={handleAdd} disabled={saving || !novo.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Adicionar</>}
          </Button>
        </div>
        <div className="rounded-md border border-border bg-card/50 p-3">
          <SlaInput label="Prazo prometido (referência)" value={novoSla} onChange={setNovoSla} />
          <p className="text-[10px] text-muted-foreground leading-tight mt-1">
            Desde 01/08 o go-live vem da soma das etapas do trilho. Este prazo é a promessa
            comercial: o sistema só avisa quando os dois divergem.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Digite o nome, defina o prazo prometido e clique em Adicionar (ou tecle Enter).</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-md">
          Nenhum tipo de demanda cadastrado.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map((it) => (
                <SortableRow
                  key={it.id}
                  item={it}
                  onToggle={handleToggle}
                  onRename={handleRename}
                  onColor={handleColor}
                  onSla={handleSla}
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
