import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  useOnboardingIndicators,
  ONBOARDING_INDICATORS_QUERY_KEY,
  INDICATOR_TIPOS,
  type OnboardingIndicator,
  type IndicatorTipo,
} from "@/hooks/useOnboardingIndicators";
import { useOnboardingPhases, findPhaseBySlug } from "@/hooks/useOnboardingPhases";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, GripVertical, Trash2, Loader2, AlertTriangle } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableRow({
  item, onToggle, onPatch, onDelete,
}: {
  item: OnboardingIndicator;
  onToggle: (id: string, v: boolean) => void;
  onPatch: (id: string, campos: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.nome);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded-md border border-border bg-card ${item.ativo ? "" : "opacity-60"}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1">
        <GripVertical className="h-4 w-4" />
      </button>

      {editing ? (
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { setEditing(false); if (val.trim() && val.trim() !== item.nome) onPatch(item.id, { nome: val.trim() }); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setVal(item.nome); setEditing(false); } }}
          autoFocus
          className="h-8"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex-1 text-left text-sm truncate hover:opacity-80">
          {item.nome}
        </button>
      )}

      <Select value={item.tipo} onValueChange={(v) => onPatch(item.id, { tipo: v as IndicatorTipo })}>
        <SelectTrigger className="h-8 w-[130px] text-xs shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          {INDICATOR_TIPOS.map((t) => (
            <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        defaultValue={item.unidade ?? ""}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== (item.unidade ?? "")) onPatch(item.id, { unidade: v || null });
        }}
        placeholder="un."
        className="h-8 w-16 text-xs shrink-0"
        title="Unidade mostrada junto do valor (un, R$, %)"
      />

      <div className="flex items-center gap-1.5 text-xs shrink-0">
        <span className="text-muted-foreground">Ativo</span>
        <Switch checked={item.ativo} onCheckedChange={(v) => onToggle(item.id, v)} />
      </div>

      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onDelete(item.id)}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

export function IndicatorsPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const [novoTipo, setNovoTipo] = useState<IndicatorTipo>("numero");
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { data: items = [], isLoading } = useOnboardingIndicators(effectiveTenantId);
  const phases = useOnboardingPhases(effectiveTenantId, { somenteAtivas: false }).data ?? [];
  const acompanhamento = findPhaseBySlug(phases, "acompanhamento");

  function invalidate() {
    qc.invalidateQueries({ queryKey: [ONBOARDING_INDICATORS_QUERY_KEY] });
  }

  async function handleAdd() {
    if (!novo.trim() || !effectiveTenantId) return;
    setSaving(true);
    try {
      const maxPos = items.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
      const { error } = await (supabase.from("onboarding_indicators" as any) as any).insert({
        tenant_id: effectiveTenantId,
        nome: novo.trim(),
        tipo: novoTipo,
        ativo: true,
        position: maxPos + 1,
      });
      if (error) throw error;
      setNovo("");
      toast.success("Indicador adicionado");
      invalidate();
    } catch (e: any) {
      toast.error(e.code === "23505" ? "Já existe um indicador com esse nome" : (e.message || "Erro ao adicionar"));
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, campos: Record<string, unknown>) {
    const { error } = await (supabase.from("onboarding_indicators" as any) as any)
      .update(campos).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else invalidate();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este indicador? Só é possível se nenhuma coleta usar ele.")) return;
    const { error } = await (supabase.from("onboarding_indicators" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) {
      toast.error(error.code === "23503"
        ? "Este indicador já tem coletas lançadas e não pode ser excluído. Desative-o."
        : error.message);
      return;
    }
    toast.success("Indicador removido");
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
      [ONBOARDING_INDICATORS_QUERY_KEY, effectiveTenantId, false],
      reordered.map((r, i) => ({ ...r, position: i + 1 })),
    );
    try {
      await Promise.all(reordered.map((r, i) =>
        (supabase.from("onboarding_indicators" as any) as any)
          .update({ position: i + 1 }).eq("id", r.id).eq("tenant_id", effectiveTenantId)
      ));
    } catch {
      toast.error("Erro ao reordenar");
    } finally {
      invalidate();
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Novo indicador (ex: Nº de vendas)"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Select value={novoTipo} onValueChange={(v) => setNovoTipo(v as IndicatorTipo)}>
            <SelectTrigger className="w-[150px] shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INDICATOR_TIPOS.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} disabled={saving || !novo.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Adicionar</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          São os números que dizem se o cliente destravou depois do go-live. Aparecem na seção
          de acompanhamento da jornada, lançados em qualquer data.
        </p>
      </div>

      {acompanhamento && !acompanhamento.ativo && (
        <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-2.5 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
          <span>
            A jornada <strong>{acompanhamento.nome}</strong> está desativada — os indicadores só
            aparecem na jornada depois de ligá-la na aba <strong>Jornadas</strong> e marcar a seção
            “Acompanhamento” nas etapas dela.
          </span>
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-md">
          Nenhum indicador cadastrado.
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
                  onPatch={patch}
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
