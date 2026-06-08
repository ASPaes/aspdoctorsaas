import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, ArrowUp, ArrowDown, Trash2, Pencil } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

interface Department {
  id: string;
  name: string;
}

interface TicketStatus {
  id: string;
  tenant_id: string;
  department_id: string;
  name: string;
  slug: string;
  color: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
  is_active: boolean;
}

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

const DEFAULT_COLOR = "#6366f1";

export default function TicketStatusesConfig() {
  const { effectiveTenantId } = useTenantFilter();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const DENY_MSG = "Você não tem acesso a esta ação. Entre em contato com o administrador.";
  const guardInsert = () => { if (!can("cfg.tickets_config", "insert")) { toast.error(DENY_MSG); return false; } return true; };
  const guardUpdate = () => { if (!can("cfg.tickets_config", "update")) { toast.error(DENY_MSG); return false; } return true; };
  const guardDelete = () => { if (!can("cfg.tickets_config", "delete")) { toast.error(DENY_MSG); return false; } return true; };
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<TicketStatus | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TicketStatus | null>(null);

  // Form state for edit/create modal
  const [form, setForm] = useState({
    name: "",
    color: DEFAULT_COLOR,
    is_initial: false,
    is_terminal: false,
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["support_departments_for_statuses", effectiveTenantId],
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

  const activeDeptId = selectedDept ?? departments[0]?.id ?? null;

  const { data: statuses = [], isLoading } = useQuery<TicketStatus[]>({
    queryKey: ["ticket_statuses_config", effectiveTenantId, activeDeptId],
    enabled: !!effectiveTenantId && !!activeDeptId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ticket_statuses")
        .select("*")
        .eq("tenant_id", effectiveTenantId)
        .eq("department_id", activeDeptId)
        .eq("is_active", true)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  const maxPosition = useMemo(
    () => statuses.reduce((m, s) => Math.max(m, s.position ?? 0), 0),
    [statuses]
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["ticket_statuses_config"] });

  const openNew = () => {
    if (!guardInsert()) return;
    setIsNew(true);
    setEditTarget(null);
    setForm({ name: "", color: DEFAULT_COLOR, is_initial: statuses.length === 0, is_terminal: false });
  };

  const openEdit = (s: TicketStatus) => {
    setIsNew(false);
    setEditTarget(s);
    setForm({
      name: s.name,
      color: s.color || DEFAULT_COLOR,
      is_initial: s.is_initial,
      is_terminal: s.is_terminal,
    });
  };

  const closeModal = () => {
    setEditTarget(null);
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Informe o nome do status");
      return;
    }
    if (!effectiveTenantId || !activeDeptId) return;

    const slug = slugify(form.name);
    const payload: any = {
      name: form.name.trim(),
      slug,
      color: form.color,
      is_initial: form.is_initial,
      is_terminal: form.is_terminal,
    };

    try {
      // If marking as initial, unset others first
      if (form.is_initial) {
        await (supabase as any)
          .from("ticket_statuses")
          .update({ is_initial: false })
          .eq("tenant_id", effectiveTenantId)
          .eq("department_id", activeDeptId)
          .neq("id", editTarget?.id ?? "00000000-0000-0000-0000-000000000000");
      }

      if (isNew) {
        const { error } = await (supabase as any).from("ticket_statuses").insert({
          ...payload,
          tenant_id: effectiveTenantId,
          department_id: activeDeptId,
          position: maxPosition + 1,
          is_active: true,
        });
        if (error) throw error;
        toast.success("Status criado");
      } else if (editTarget) {
        // Validate: cannot remove last terminal
        if (editTarget.is_terminal && !form.is_terminal) {
          const remainingTerminals = statuses.filter(
            (s) => s.is_terminal && s.id !== editTarget.id
          ).length;
          if (remainingTerminals === 0) {
            toast.error("Pelo menos um status deve ser final");
            return;
          }
        }
        const { error } = await (supabase as any)
          .from("ticket_statuses")
          .update(payload)
          .eq("id", editTarget.id);
        if (error) throw error;
        toast.success("Status atualizado");
      }
      closeModal();
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    }
  };

  const handleToggleInitial = async (s: TicketStatus) => {
    if (!effectiveTenantId || !activeDeptId) return;
    try {
      if (!s.is_initial) {
        await (supabase as any)
          .from("ticket_statuses")
          .update({ is_initial: false })
          .eq("tenant_id", effectiveTenantId)
          .eq("department_id", activeDeptId);
        await (supabase as any)
          .from("ticket_statuses")
          .update({ is_initial: true })
          .eq("id", s.id);
      } else {
        await (supabase as any)
          .from("ticket_statuses")
          .update({ is_initial: false })
          .eq("id", s.id);
      }
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Erro");
    }
  };

  const handleToggleTerminal = async (s: TicketStatus) => {
    if (s.is_terminal) {
      const remaining = statuses.filter((x) => x.is_terminal && x.id !== s.id).length;
      if (remaining === 0) {
        toast.error("Pelo menos um status deve ser final");
        return;
      }
    }
    try {
      const { error } = await (supabase as any)
        .from("ticket_statuses")
        .update({ is_terminal: !s.is_terminal })
        .eq("id", s.id);
      if (error) throw error;
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Erro");
    }
  };

  const handleMove = async (idx: number, dir: -1 | 1) => {
    const target = statuses[idx];
    const swap = statuses[idx + dir];
    if (!target || !swap) return;
    try {
      await (supabase as any)
        .from("ticket_statuses")
        .update({ position: swap.position })
        .eq("id", target.id);
      await (supabase as any)
        .from("ticket_statuses")
        .update({ position: target.position })
        .eq("id", swap.id);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao reordenar");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.is_terminal) {
      const remaining = statuses.filter((x) => x.is_terminal && x.id !== deleteTarget.id).length;
      if (remaining === 0) {
        toast.error("Não é possível excluir o último status final");
        setDeleteTarget(null);
        return;
      }
    }
    try {
      const { error } = await (supabase as any)
        .from("ticket_statuses")
        .update({ is_active: false })
        .eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success("Status excluído");
      setDeleteTarget(null);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex-1 max-w-sm">
          <Label className="text-xs text-muted-foreground mb-1 block">Setor</Label>
          <Select
            value={activeDeptId ?? ""}
            onValueChange={(v) => setSelectedDept(v)}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Selecione um setor" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openNew} disabled={!activeDeptId} className="h-10">
          <Plus className="h-4 w-4 mr-1" />
          Novo status
        </Button>
      </div>

      <div className="border rounded-lg divide-y">
        {isLoading && (
          <div className="p-4 text-sm text-muted-foreground">Carregando...</div>
        )}
        {!isLoading && statuses.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            {activeDeptId
              ? "Nenhum status configurado neste setor."
              : "Selecione um setor para ver os status."}
          </div>
        )}
        {statuses.map((s, idx) => (
          <div
            key={s.id}
            className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
          >
            <div
              className="h-4 w-4 rounded-full shrink-0 border"
              style={{ background: s.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm truncate">{s.name}</span>
                {s.is_initial && (
                  <Badge variant="outline" className="text-[10px]">Inicial</Badge>
                )}
                {s.is_terminal && (
                  <Badge variant="outline" className="text-[10px]">Final</Badge>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">{s.slug}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-[11px]"
                onClick={() => handleToggleInitial(s)}
                title="Alternar inicial"
              >
                {s.is_initial ? "✓ Inicial" : "Inicial"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-[11px]"
                onClick={() => handleToggleTerminal(s)}
                title="Alternar final"
              >
                {s.is_terminal ? "✓ Final" : "Final"}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={idx === 0}
                onClick={() => handleMove(idx, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={idx === statuses.length - 1}
                onClick={() => handleMove(idx, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => openEdit(s)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget(s)}
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
            <DialogTitle>{isNew ? "Novo status" : "Editar status"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="h-10"
                placeholder="Ex: Em andamento"
              />
              {form.name && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  slug: {slugify(form.name)}
                </div>
              )}
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
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Status inicial</Label>
              <Switch
                checked={form.is_initial}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_initial: v }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Status final</Label>
              <Switch
                checked={form.is_terminal}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_terminal: v }))}
              />
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
            <DialogTitle>Excluir status?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O status <strong>{deleteTarget?.name}</strong> será desativado.
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
