import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, CheckCircle, Trash2, Pencil } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import KBEditDialog from "./kb/KBEditDialog";

type KBArticle = {
  id: string;
  title: string | null;
  summary: string | null;
  problem: string;
  solution: string;
  tags: string[] | null;
  status: string;
  area_id: string | null;
  source_attendance_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  area?: { nome: string } | null;
  attendance?: { attendance_code: string } | null;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  approved: "Aprovado",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

export default function KBTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [editingArticle, setEditingArticle] = useState<KBArticle | null>(null);

  // Fetch areas for filter
  const { data: areas } = useQuery({
    queryKey: ["support_areas", tid],
    queryFn: async () => {
      let q = supabase.from("support_areas").select("id, nome").eq("ativo", true);
      if (tid) q = q.eq("tenant_id", tid);
      const { data } = await q.order("nome");
      return data || [];
    },
  });

  // Fetch KB articles
  const { data: articles, isLoading } = useQuery({
    queryKey: ["kb_articles", tid, statusFilter, areaFilter],
    queryFn: async () => {
      let q = supabase
        .from("support_kb_articles")
        .select("*, area:support_areas(nome), attendance:support_attendances(attendance_code)")
        .order("created_at", { ascending: false });
      if (tid) q = q.eq("tenant_id", tid);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (areaFilter !== "all") q = q.eq("area_id", areaFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as KBArticle[];
    },
  });

  // Filtered by search
  const filtered = useMemo(() => {
    if (!articles) return [];
    if (!search.trim()) return articles;
    const s = search.toLowerCase();
    return articles.filter(
      (a) =>
        (a.title || "").toLowerCase().includes(s) ||
        a.problem.toLowerCase().includes(s) ||
        a.solution.toLowerCase().includes(s) ||
        (a.tags || []).some((t) => t.toLowerCase().includes(s))
    );
  }, [articles, search]);

  // Approve mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, any> }) => {
      const { error } = await supabase
        .from("support_kb_articles")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kb_articles"] });
      toast.success("Artigo atualizado");
    },
    onError: (err: any) => {
      toast.error("Erro ao atualizar: " + err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("support_kb_articles")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kb_articles"] });
      toast.success("Artigo excluído");
    },
    onError: (err: any) => {
      toast.error("Erro ao excluir: " + err.message);
    },
  });

  const approve = (id: string) => {
    updateMutation.mutate({
      id,
      payload: {
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: profile?.user_id || null,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Base de Conhecimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por título, problema ou tags..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="approved">Aprovado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Área" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as áreas</SelectItem>
                {(areas || []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum artigo encontrado.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Área</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Atendimento</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((article) => (
                    <TableRow key={article.id}>
                      <TableCell className="font-medium max-w-[250px] truncate">
                        {article.title || "Sem título"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(article.area as any)?.nome || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[article.status] || ""}>
                          {STATUS_LABELS[article.status] || article.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[150px]">
                        <div className="flex flex-wrap gap-1">
                          {(article.tags || []).slice(0, 3).map((t, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {t}
                            </Badge>
                          ))}
                          {(article.tags || []).length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              +{(article.tags || []).length - 3}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {(article.attendance as any)?.attendance_code ? (
                          <span className="font-mono text-xs">
                            {(article.attendance as any).attendance_code}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setEditingArticle(article)} title="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {isAdmin && article.status === "draft" && (
                            <Button variant="ghost" size="icon" onClick={() => approve(article.id)} title="Aprovar">
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            </Button>
                          )}
                          {isAdmin && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" title="Excluir">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Excluir artigo?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Esta ação não pode ser desfeita. O artigo será removido permanentemente da base de conhecimento.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteMutation.mutate(article.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Excluir
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      {editingArticle && (
        <KBEditDialog
          article={editingArticle}
          areas={areas || []}
          onClose={() => setEditingArticle(null)}
        />
      )}
    </div>
  );
}
