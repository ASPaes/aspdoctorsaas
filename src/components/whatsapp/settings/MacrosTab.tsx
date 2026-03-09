import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, Zap, Hash } from "lucide-react";
import { useWhatsAppMacros, type WhatsAppMacro } from "@/components/whatsapp/hooks/useWhatsAppMacros";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

interface MacroForm {
  title: string;
  content: string;
  shortcut: string;
  category: string;
}

const EMPTY_FORM: MacroForm = { title: "", content: "", shortcut: "", category: "" };

export default function MacrosTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { macros, isLoading, createMacro, updateMacro, deleteMacro, isCreating, isUpdating, isDeleting } = useWhatsAppMacros();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMacro, setEditingMacro] = useState<WhatsAppMacro | null>(null);
  const [form, setForm] = useState<MacroForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppMacro | null>(null);

  const openCreate = () => {
    setEditingMacro(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (macro: WhatsAppMacro) => {
    setEditingMacro(macro);
    setForm({
      title: macro.title,
      content: macro.content,
      shortcut: macro.shortcut || "",
      category: macro.category || "",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.title.trim() || !form.content.trim()) return;

    if (editingMacro) {
      updateMacro({
        id: editingMacro.id,
        updates: {
          title: form.title.trim(),
          content: form.content.trim(),
          shortcut: form.shortcut.trim() || null,
          category: form.category.trim() || null,
        },
      });
    } else {
      createMacro({
        title: form.title.trim(),
        content: form.content.trim(),
        shortcut: form.shortcut.trim() || null,
        category: form.category.trim() || null,
        tenant_id: tid,
        is_global: true,
        is_active: true,
      });
    }
    setDialogOpen(false);
  };

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  const grouped = macros.reduce<Record<string, WhatsAppMacro[]>>((acc, m) => {
    const cat = m.category || "Sem categoria";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Macros / Respostas Rápidas</h2>
          <p className="text-sm text-muted-foreground">Crie respostas pré-definidas para agilizar o atendimento.</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Nova Macro
        </Button>
      </div>

      {macros.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Zap className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <CardTitle className="text-lg mb-1">Nenhuma macro criada</CardTitle>
            <CardDescription>Crie macros para responder mais rápido nas conversas.</CardDescription>
            <Button className="mt-4" onClick={openCreate}><Plus className="h-4 w-4" /> Nova Macro</Button>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">{category}</h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {items.map((macro) => (
                <Card key={macro.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{macro.title}</p>
                        {macro.shortcut && (
                          <Badge variant="outline" className="text-[10px] mt-1">
                            <Hash className="h-2.5 w-2.5 mr-0.5" />{macro.shortcut}
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(macro)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteTarget(macro)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3">{macro.content}</p>
                    <p className="text-[10px] text-muted-foreground mt-2">Usado {macro.usage_count}x</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingMacro ? "Editar Macro" : "Nova Macro"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input placeholder="Ex: Saudação" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Conteúdo *</Label>
              <Textarea placeholder="Olá! Como posso ajudá-lo?" rows={4} value={form.content} onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Atalho</Label>
                <Input placeholder="/saudacao" value={form.shortcut} onChange={(e) => setForm(f => ({ ...f, shortcut: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Input placeholder="Geral" value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleSave} disabled={isCreating || isUpdating || !form.title.trim() || !form.content.trim()}>
              {(isCreating || isUpdating) && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingMacro ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir macro?</AlertDialogTitle>
            <AlertDialogDescription>
              A macro <strong>{deleteTarget?.title}</strong> será desativada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteTarget) deleteMacro(deleteTarget.id); setDeleteTarget(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
