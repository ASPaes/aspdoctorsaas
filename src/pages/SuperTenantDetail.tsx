import { useParams, useNavigate } from "react-router-dom";
import { useSuperTenantDetail } from "@/hooks/useSuperAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";

export default function SuperTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useSuperTenantDetail(id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) return <p className="text-muted-foreground">Tenant não encontrado.</p>;

  const { tenant, users, invites } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/super/tenants")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{tenant.nome}</h1>
          <p className="text-sm text-muted-foreground">
            Plano: {tenant.plano ?? "—"} · Status: {tenant.status} · Max: {tenant.max_users}
          </p>
        </div>
      </div>

      {/* Users */}
      <Card>
        <CardHeader>
          <CardTitle>Usuários ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Super Admin</TableHead>
                <TableHead>Criado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u: any) => (
                <TableRow key={u.user_id}>
                  <TableCell className="font-mono text-xs max-w-[200px] truncate">{u.user_id}</TableCell>
                  <TableCell><Badge variant="outline">{u.role}</Badge></TableCell>
                  <TableCell><Badge variant={u.status === "ativo" ? "default" : "secondary"}>{u.status}</Badge></TableCell>
                  <TableCell>{u.is_super_admin ? "✓" : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Invites */}
      <Card>
        <CardHeader>
          <CardTitle>Convites ({invites.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum convite.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expira em</TableHead>
                  <TableHead>Usado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((inv: any) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell><Badge variant="secondary">{inv.role}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {inv.used_at ? new Date(inv.used_at).toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
