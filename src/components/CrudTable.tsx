import { useState, useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export interface ColumnDef {
  key: string;
  label: string;
  type?: "text" | "select" | "boolean";
  options?: { value: string | number; label: string }[];
  /** For select type: "number" (default) or "string" (for UUIDs) */
  valueType?: "number" | "string";
  /** Display transform for table cell */
  render?: (value: any, row: any) => string;
}

interface CrudTableProps {
  table: string;
  queryKey: string;
  columns: ColumnDef[];
  /** Optional select() override; defaults to "*" */
  selectQuery?: string;
  /** Column to order by */
  orderBy?: string;
  /** Async validation before save. Return string to block with error message, or void/undefined to proceed. */
  onBeforeSave?: (payload: Record<string, any>, isEdit: boolean) => Promise<string | void>;
}

export default function CrudTable({ table, queryKey, columns, selectQuery = "*", orderBy, onBeforeSave }: CrudTableProps) {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq("tenant_id", tid) : q;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editingRow, setEditingRow] = useState<Record<string, any> | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const prevTidRef = useRef(tid);

  const refreshDependentQueries = async () => {
    const tasks: Promise<unknown>[] = [queryClient.invalidateQueries({ queryKey: [queryKey] })];

    if (table === "funcionarios") {
      queryClient.removeQueries({ queryKey: ["funcionarios-for-invite", tid] });
      queryClient.removeQueries({ queryKey: ["tenant-access-users", tid] });

      tasks.push(
        queryClient.invalidateQueries({ queryKey: ["funcionarios-for-invite", tid] }),
        queryClient.invalidateQueries({ queryKey: ["tenant-access-users", tid] }),
      );
    }

    await Promise.all(tasks);
  };

  // Close modal if tenant changes while it's open — prevents saving with stale select options
  useEffect(() => {
    if (prevTidRef.current !== tid) {
      prevTidRef.current = tid;
      if (dialogOpen) {
        closeDialog();
        toast({ title: "Tenant alterado", description: "O formulário foi fechado. Selecione o setor novamente." });
      }
    }
  }, [tid, dialogOpen]);
  const { data: rows, isLoading } = useQuery({
    queryKey: [queryKey, tid],
    queryFn: async () => {
      let q = (supabase.from(table as any) as any).select(selectQuery);
      if (orderBy) q = q.order(orderBy);
      q = tf(q);
      const { data, error } = await q;
      if (error) throw error;
      return data as Record<string, any>[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      if (editingRow) {
        const { error } = await (supabase.from(table as any) as any).update(payload).eq("id", editingRow.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from(table as any) as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await refreshDependentQueries();
      toast({ title: editingRow ? "Atualizado!" : "Criado!", description: "Registro salvo com sucesso." });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  const [dependencyError, setDependencyError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await (supabase.from(table as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshDependentQueries();
      toast({ title: "Excluído!", description: "Registro removido." });
      setDeleteId(null);
    },
    onError: (err: any) => {
      setDeleteId(null);
      if (err.message?.includes("violates foreign key constraint") || err.code === "23503") {
        setDependencyError("Este registro não pode ser excluído porque está sendo utilizado em outros cadastros. Remova as dependências antes de excluir.");
      } else {
        toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
      }
    },
  });

  const openNew = () => {
    setEditingRow(null);
    const defaults: Record<string, any> = {};
    columns.forEach((c) => {
      defaults[c.key] = c.type === "boolean" ? true : "";
    });
    setFormData(defaults);
    setDialogOpen(true);
  };

  const openEdit = (row: Record<string, any>) => {
    setEditingRow(row);
    const data: Record<string, any> = {};
    columns.forEach((c) => {
      data[c.key] = row[c.key] ?? "";
    });
    setFormData(data);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingRow(null);
    setFormData({});
  };

  const handleSave = async () => {
    const payload: Record<string, any> = {};
    columns.forEach((c) => {
      const val = formData[c.key];
      if (c.type === "select") {
        payload[c.key] = val ? (c.valueType === "string" ? val : Number(val)) : null;
      } else if (c.type === "boolean") {
        payload[c.key] = !!val;
      } else {
        payload[c.key] = val || null;
      }
    });

    // Always include tenant_id on inserts so the DB trigger doesn't use current_tenant_id()
    if (!editingRow && tid) {
      payload.tenant_id = tid;
    }

    // Run custom validation if provided
    if (onBeforeSave) {
      const errorMsg = await onBeforeSave(payload, !!editingRow);
      if (errorMsg) {
        toast({ title: "Validação", description: errorMsg, variant: "destructive" });
        return;
      }
    }

    saveMutation.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.key}>{c.label}</TableHead>
                ))}
                <TableHead className="w-24">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows && rows.length > 0 ? rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((c) => (
                    <TableCell key={c.key}>
                      {c.render
                        ? c.render(row[c.key], row)
                        : c.type === "boolean"
                          ? (row[c.key] ? "Sim" : "Não")
                          : String(row[c.key] ?? "—")}
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(row.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground py-8">
                    Nenhum registro encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRow ? "Editar" : "Novo"} Registro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {columns.map((c) => (
              <div key={c.key} className="space-y-1">
                <Label>{c.label}</Label>
                {c.type === "select" ? (
                  <Select
                    value={formData[c.key]?.toString() ?? ""}
                    onValueChange={(v) => setFormData((p) => ({ ...p, [c.key]: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {c.options?.map((o) => (
                        <SelectItem key={o.value} value={o.value.toString()}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : c.type === "boolean" ? (
                  <Select
                    value={formData[c.key] ? "true" : "false"}
                    onValueChange={(v) => setFormData((p) => ({ ...p, [c.key]: v === "true" }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Sim</SelectItem>
                      <SelectItem value="false">Não</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={formData[c.key] ?? ""}
                    onChange={(e) => setFormData((p) => ({ ...p, [c.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Deseja realmente excluir este registro?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Dependency Error Dialog */}
      <AlertDialog open={dependencyError !== null} onOpenChange={(o) => !o && setDependencyError(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Não é possível excluir
            </AlertDialogTitle>
            <AlertDialogDescription>{dependencyError}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDependencyError(null)}>Entendi</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
