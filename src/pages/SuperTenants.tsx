import { useState } from "react";
import { useSuperTenants, useUpdateTenant } from "@/hooks/useSuperAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Eye, Save, Loader2 } from "lucide-react";

export default function SuperTenants() {
  const { data: tenants = [], isLoading } = useSuperTenants();
  const updateTenant = useUpdateTenant();
  const navigate = useNavigate();
  const [edits, setEdits] = useState<Record<string, any>>({});

  const getEdit = (id: string) => edits[id] ?? {};
  const setEdit = (id: string, patch: any) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleSave = (id: string) => {
    const edit = getEdit(id);
    if (!Object.keys(edit).length) return;
    const payload: any = { id };
    if (edit.status !== undefined) payload.status = edit.status;
    if (edit.max_users !== undefined) payload.max_users = parseInt(edit.max_users, 10);
    if (edit.plano !== undefined) payload.plano = edit.plano;
    updateTenant.mutate(payload, {
      onSuccess: () => {
        toast.success("Tenant atualizado.");
        setEdits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      },
      onError: (err: any) => toast.error(err.message),
    });
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
      <div>
        <h1 className="text-2xl font-bold">Super Admin — Tenants</h1>
        <p className="mt-1 text-muted-foreground">Gerencie todos os tenants do sistema.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Max Users</TableHead>
                <TableHead>Ativos</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((t) => {
                const edit = getEdit(t.id);
                const hasChanges = Object.keys(edit).length > 0;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.nome}</TableCell>
                    <TableCell>
                      <Select
                        value={edit.status ?? t.status}
                        onValueChange={(v) => setEdit(t.id, { status: v })}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ativo">ativo</SelectItem>
                          <SelectItem value="inativo">inativo</SelectItem>
                          <SelectItem value="suspenso">suspenso</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="w-24"
                        value={edit.plano ?? t.plano ?? ""}
                        onChange={(e) => setEdit(t.id, { plano: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="w-20"
                        type="number"
                        min={1}
                        value={edit.max_users ?? t.max_users}
                        onChange={(e) => setEdit(t.id, { max_users: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t.user_count}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {hasChanges && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleSave(t.id)}
                            disabled={updateTenant.isPending}
                          >
                            {updateTenant.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => navigate(`/super/tenants/${t.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
