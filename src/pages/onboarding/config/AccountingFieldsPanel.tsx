import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, GripVertical, Trash2, Loader2, Pencil } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type FieldTipo = "text" | "number" | "date" | "option" | "boolean";

interface AccField {
  id: string;
  nome: string;
  tipo: FieldTipo;
  opcoes: string[] | null;
  ativo: boolean;
  position: number;
}

const TIPO_LABEL: Record<FieldTipo, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  option: "Opções",
  boolean: "Sim/Não",
};

const TIPO_COLOR: Record<FieldTipo, string> = {
  text: "hsl(215 16% 47%)",
  number: "hsl(199 89% 48%)",
  date: "hsl(262 83% 58%)",
  option: "hsl(38 92% 50%)",
  boolean: "hsl(142 71% 45%)",
};

const KEY = "onb-accounting-fields";

function SortableRow({
  item, onToggle, onEdit, onDelete,
}: {
  item: AccField;
  onToggle: (id: string, v: boolean) => void;
  onEdit: (item: AccField) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
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
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm truncate">{item.nome}</span>
        <Badge className="text-[9px] border-0 text-white shrink-0" style={{ backgroundColor: TIPO_COLOR[item.tipo] }}>
          {TIPO_LABEL[item.tipo]}
        </Badge>
        {item.tipo === "option" && (item.opcoes?.length ?? 0) > 0 && (
          <span className="text-[10px] text-muted-foreground truncate">
            {(item.opcoes ?? []).join(" · ")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Ativo</span>
        <Switch checked={item.ativo} onCheckedChange={(v) => onToggle(item.id, v)} />
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(item)}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

export function AccountingFieldsPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AccField | null>(null);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<FieldTipo>("text");
  const [opcoesTxt, setOpcoesTxt] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [saving, setSaving] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: [KEY, effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_accounting_fields" as any) as any)
        .select("id, nome, tipo, opcoes, ativo, position")
        .eq("tenant_id", effectiveTenantId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as AccField[];
    },
  });

  function openNew() {
    setEditing(null);
    setNome("");
    setTipo("text");
    setOpcoesTxt("");
    setAtivo(true);
    setDialogOpen(true);
  }

  function openEdit(item: AccField) {
    setEditing(item);
    setNome(item.nome);
    setTipo(item.tipo);
    setOpcoesTxt((item.opcoes ?? []).join("\n"));
    setAtivo(item.ativo);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!nome.trim() || !effectiveTenantId) return;
    setSaving(true);
    try {
      const opcoes = tipo === "option"
        ? opcoesTxt.split("\n").map((s) => s.trim()).filter(Boolean)
        : null;
      if (tipo === "option" && (opcoes?.length ?? 0) === 0) {
        toast.error("Adicione ao menos uma opção");
        setSaving(false);
        return;
      }
      if (editing) {
        const { error } = await (supabase.from("onboarding_accounting_fields" as any) as any)
          .update({ nome: nome.trim(), tipo, opcoes, ativo })
          .eq("id", editing.id).eq("tenant_id", effectiveTenantId);
        if (error) throw error;
      } else {
        const maxPos = items.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
        const { error } = await (supabase.from("onboarding_accounting_fields" as any) as any).insert({
          tenant_id: effectiveTenantId,
          nome: nome.trim(),
          tipo,
          opcoes,
          ativo,
          position: maxPos + 1,
        });
        if (error) throw error;
      }
      setDialogOpen(false);
      toast.success(editing ? "Campo atualizado" : "Campo adicionado");
      qc.invalidateQueries({ queryKey: [KEY] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, v: boolean) {
    const { error } = await (supabase.from("onboarding_accounting_fields" as any) as any)
      .update({ ativo: v }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este campo? Os valores já coletados nas jornadas serão removidos.")) return;
    const { error } = await (supabase.from("onboarding_accounting_fields" as any) as any)
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
        (supabase.from("onboarding_accounting_fields" as any) as any)
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
        Campos fiscais/contábeis coletados no onboarding de cada cliente. Configure quais dados sua contabilidade precisa.
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{items.length} campo(s)</div>
        <Button size="sm" onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> Novo campo</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-md">
          Nenhum campo cadastrado.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map((it) => (
                <SortableRow key={it.id} item={it} onToggle={handleToggle} onEdit={openEdit} onDelete={handleDelete} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar campo" : "Novo campo contábil"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Nome *</label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Regime Tributário" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Tipo *</label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as FieldTipo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TIPO_LABEL) as FieldTipo[]).map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {tipo === "option" && (
              <div className="space-y-1">
                <label className="text-xs font-medium">Opções (uma por linha) *</label>
                <textarea
                  value={opcoesTxt}
                  onChange={(e) => setOpcoesTxt(e.target.value)}
                  className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder={"Simples Nacional\nLucro Presumido\nLucro Real"}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={ativo} onCheckedChange={setAtivo} />
              <span className="text-xs">Ativo</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !nome.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
