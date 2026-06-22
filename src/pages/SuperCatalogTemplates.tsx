import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import NewCatalogTemplateModal from "@/components/super/NewCatalogTemplateModal";

const KIND_LABELS: Record<string, string> = {
  service_catalog: "Catálogo de serviços",
  service_types: "Tipos de serviço",
  segmentos: "Segmentos",
  areas_atuacao: "Áreas de atuação",
  motivos_cancelamento: "Motivos de cancelamento",
  motivos_pausa: "Motivos de pausa",
};

interface CatalogTemplate {
  id: string;
  nome: string;
  descricao: string | null;
  kind: string;
  origem: string;
  source_tenant_id: string | null;
  is_published: boolean;
  created_at: string;
  item_count: number;
}

export default function SuperCatalogTemplates() {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["super_catalog_templates"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_catalog_templates");
      if (error) throw error;
      return (data ?? []) as CatalogTemplate[];
    },
  });

  const handleTogglePublished = async (id: string, value: boolean) => {
    const { error } = await (supabase.from("catalog_templates" as any) as any)
      .update({ is_published: value })
      .eq("id", id);
    if (error) {
      toast.error("Erro ao atualizar: " + error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["super_catalog_templates"] });
    toast.success(value ? "Template publicado." : "Template despublicado.");
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await (supabase.from("catalog_templates" as any) as any)
      .delete()
      .eq("id", deleteId);
    setDeleteId(null);
    if (error) {
      toast.error("Erro ao excluir: " + error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["super_catalog_templates"] });
    toast.success("Template excluído.");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Super Admin — Templates de catálogo</h1>
          <p className="mt-1 text-muted-foreground">
            Biblioteca de catálogos prontos para novos tenants importarem.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Novo template
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Itens</TableHead>
                <TableHead>Publicado</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhum template cadastrado ainda.
                  </TableCell>
                </TableRow>
              ) : (
                templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium">{t.nome}</div>
                      {t.descricao && (
                        <div className="text-xs text-muted-foreground">{t.descricao}</div>
                      )}
                    </TableCell>
                    <TableCell>{KIND_LABELS[t.kind] ?? t.kind}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {t.origem === "upload" ? "Arquivo" : "Copiado de tenant"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t.item_count}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={t.is_published}
                        onCheckedChange={(v) => handleTogglePublished(t.id, v)}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setDeleteId(t.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o template e todos os seus itens.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
