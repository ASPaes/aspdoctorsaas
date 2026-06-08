import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

interface Department {
  id: string;
  name: string;
}

interface TicketTag {
  id: string;
  tenant_id: string;
  name: string;
  color: string;
  department_id: string | null;
  is_active: boolean;
}

const DEFAULT_COLOR = "#3b82f6";
const GLOBAL_VALUE = "__global__";

export default function TicketTagsConfig() {
  const { effectiveTenantId } = useTenantFilter();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const DENY_MSG = "Você não tem acesso a esta ação. Entre em contato com o administrador.";
  const guardInsert = () => { if (!can("cfg.tickets_config", "insert")) { toast.error(DENY_MSG); return false; } return true; };
  const guardUpdate = () => { if (!can("cfg.tickets_config", "update")) { toast.error(DENY_MSG); return false; } return true; };
  const guardDelete = () => { if (!can("cfg.tickets_config", "delete")) { toast.error(DENY_MSG); return false; } return true; };

  const [editTarget, setEditTarget] = useState<TicketTag | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TicketTag | null>(null);

  const [form, setForm] = useState({
    name: "",
    color: DEFAULT_COLOR,
    department_id: null as string | null,
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["support_departments_for_tags", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("support_departments")
        .select("id, name")
        .eq("tenant_id", effectiveTenantId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: tags = [], isLoading } = useQuery<TicketTag[]>({
    queryKey: ["ticket_tags_config", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ticket_tags")
        .select("*")
        .eq("tenant_id", effectiveTenantId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["ticket_tags_config"] });

  const deptName = (id: string | null) =>
    id ? departments.find((d) => d.id === id)?.name ?? "—" : "Global";

  const openNew = () => {
    if (!guardInsert()) return;
    setIsNew(true);
    setEditTarget(null);
    setForm({ name: "", color: DEFAULT_COLOR, department_id: null });
  };

  const openEdit = (t: TicketTag) => {
    setIsNew(false);
    setEditTarget(t);
    setForm({
      name: t.name,
      color: t.color || DEFAULT_COLOR,
      department_id: t.department_id,
    });
  };

  const closeModal = () => {
    setIsNew(false);
    setEditTarget(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Informe o nome da tag");
      return;
    }
    if (!effectiveTenantId) return;

    const payload: any = {
      name: form.name.trim(),
      color: form.color,
      department_id: form.department_id,
    };

    try {
      if (isNew) {
        const { error } = await (supabase as any).from("ticket_tags").insert({
          ...payload,
          tenant_id: effectiveTenantId,
          is_active: true,
        });
        if (error) throw error;
        toast.success("Tag criada");
      } else if (editTarget) {
        const { error } = await (supabase as any)
          .from("ticket_tags")
          .update(payload)
          .eq("id", editTarget.id);
        if (error) throw error;
        toast.success("Tag atualizada");
      }
      closeModal();
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await (supabase as any)
        .from("ticket_tags")
        .update({ is_active: false })
        .eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success("Tag excluída");
      setDeleteTarget(null);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Tags coloridas para classificar tickets. Globais valem para todos os setores.
        </p>
        <Button onClick={openNew} className="h-10">
          <Plus className="h-4 w-4 mr-1" />
          Nova tag
        </Button>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground p-4">Carregando...</div>
      )}

      {!isLoading && tags.length === 0 && (
        <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
          Nenhuma tag cadastrada.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tags.map((t) => (
          <div
            key={t.id}
            className="border rounded-lg p-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
          >
            <div className="flex-1 min-w-0 space-y-1">
              <span
                className="inline-block text-xs px-2 py-1 rounded font-medium max-w-full truncate"
                style={{ background: t.color + "22", color: t.color }}
                title={t.name}
              >
                {t.name}
              </span>
              <div className="text-[11px] text-muted-foreground truncate">
                {t.department_id ? `Setor: ${deptName(t.department_id)}` : "Global"}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => openEdit(t)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget(t)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit/New modal */}
      <Dialog open={isNew || !!editTarget} onOpenChange={(o) => !o && closeModal()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isNew ? "Nova tag" : "Editar tag"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="h-10"
                placeholder="Ex: Urgente"
              />
            </div>
            <div>
              <Label className="text-xs">Cor</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  className="h-10 w-16 p-1"
                />
                <Input
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  className="h-10 flex-1 font-mono text-sm"
                />
              </div>
              {form.name && (
                <div className="mt-2">
                  <span
                    className="inline-block text-xs px-2 py-1 rounded font-medium"
                    style={{ background: form.color + "22", color: form.color }}
                  >
                    {form.name}
                  </span>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Setor</Label>
              <Select
                value={form.department_id ?? GLOBAL_VALUE}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    department_id: v === GLOBAL_VALUE ? null : v,
                  }))
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL_VALUE}>Global (todos os setores)</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir tag?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A tag <strong>{deleteTarget?.name}</strong> será desativada.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
