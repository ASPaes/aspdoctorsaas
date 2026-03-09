import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useWhatsAppMacros } from "@/components/whatsapp/hooks/useWhatsAppMacros";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { MacroDialog } from "./MacroDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { WhatsAppMacro } from "@/components/whatsapp/hooks/useWhatsAppMacros";

export function MacrosManager() {
  const { macros, isLoading, deleteMacro } = useWhatsAppMacros();
  const [showDialog, setShowDialog] = useState(false);
  const [editingMacro, setEditingMacro] = useState<WhatsAppMacro | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppMacro | null>(null);

  const handleCreate = () => { setEditingMacro(undefined); setShowDialog(true); };
  const handleEdit = (macro: WhatsAppMacro) => { setEditingMacro(macro); setShowDialog(true); };
  const handleDelete = () => { if (deleteTarget) { deleteMacro(deleteTarget.id); setDeleteTarget(null); } };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div><h2 className="text-2xl font-bold">Macros</h2></div>
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Macros</h2>
          <p className="text-muted-foreground mt-1">Respostas rápidas para agilizar o atendimento</p>
        </div>
        <Button onClick={handleCreate}><Plus className="mr-2 h-4 w-4" />Nova Macro</Button>
      </div>

      {macros.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <p className="text-muted-foreground mb-4">Nenhuma macro configurada</p>
          <Button onClick={handleCreate} variant="outline"><Plus className="mr-2 h-4 w-4" />Criar Primeira Macro</Button>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Atalho</TableHead>
                <TableHead className="hidden md:table-cell">Conteúdo</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Usos</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {macros.map((macro) => (
                <TableRow key={macro.id}>
                  <TableCell className="font-medium">{macro.title}</TableCell>
                  <TableCell>
                    {macro.shortcut ? (
                      <Badge variant="outline" className="font-mono text-xs">/{macro.shortcut}</Badge>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell max-w-[200px] truncate text-muted-foreground">
                    {macro.content}
                  </TableCell>
                  <TableCell>
                    {macro.category ? <Badge variant="secondary">{macro.category}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">{macro.usage_count}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(macro)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(macro)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <MacroDialog open={showDialog} onOpenChange={setShowDialog} macro={editingMacro} />

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir macro?</AlertDialogTitle>
            <AlertDialogDescription>
              A macro "{deleteTarget?.title}" será desativada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
