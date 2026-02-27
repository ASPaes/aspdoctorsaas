import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useTenantInfo,
  useTenantUsers,
  useTenantInvites,
  useUpdateUserRole,
  useUpdateUserStatus,
  useCreateInvite,
  useCancelInvite,
} from "@/hooks/useTenantUsers";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Users, UserPlus, Trash2, Loader2, Copy } from "lucide-react";

export default function UsuariosTab() {
  const { profile } = useAuth();
  const { data: tenant, isLoading: tenantLoading } = useTenantInfo();
  const { data: users = [], isLoading: usersLoading } = useTenantUsers();
  const { data: invites = [], isLoading: invitesLoading } = useTenantInvites();
  const updateRole = useUpdateUserRole();
  const updateStatus = useUpdateUserStatus();
  const createInvite = useCreateInvite();
  const cancelInvite = useCancelInvite();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");

  const activeUsers = users.filter((u) => u.status === "ativo").length;
  const maxUsers = tenant?.max_users ?? 1;
  const canInvite = activeUsers < maxUsers;

  const handleInvite = () => {
    if (!inviteEmail.trim() || !tenant) return;
    createInvite.mutate(
      { email: inviteEmail.trim(), role: inviteRole, tenantId: tenant.id },
      {
        onSuccess: () => {
          toast.success("Convite enviado!");
          setInviteEmail("");
        },
        onError: (err: any) => toast.error(err.message),
      }
    );
  };

  const handleRoleChange = (userId: string, role: string) => {
    updateRole.mutate(
      { userId, role },
      {
        onSuccess: () => toast.success("Role atualizado."),
        onError: (err: any) => toast.error(err.message),
      }
    );
  };

  const handleStatusChange = (userId: string, status: string) => {
    updateStatus.mutate(
      { userId, status },
      {
        onSuccess: () => toast.success("Status atualizado."),
        onError: (err: any) => toast.error(err.message),
      }
    );
  };

  if (tenantLoading || usersLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Counter */}
      <Card>
        <CardContent className="flex items-center gap-4 py-4">
          <Users className="h-8 w-8 text-primary" />
          <div>
            <p className="text-sm text-muted-foreground">Usuários ativos</p>
            <p className="text-2xl font-bold">
              {activeUsers} <span className="text-base font-normal text-muted-foreground">/ {maxUsers}</span>
            </p>
          </div>
          {!canInvite && (
            <Badge variant="destructive" className="ml-auto">Limite atingido</Badge>
          )}
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Usuários</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.user_id}>
                  <TableCell className="text-sm">{u.email ?? u.user_id}</TableCell>
                  <TableCell>
                    <Select
                      value={u.role}
                      onValueChange={(v) => handleRoleChange(u.user_id, v)}
                      disabled={u.user_id === profile?.user_id || u.is_super_admin}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="user">user</SelectItem>
                        <SelectItem value="viewer">viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={u.status}
                      onValueChange={(v) => handleStatusChange(u.user_id, v)}
                      disabled={u.user_id === profile?.user_id}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ativo">ativo</SelectItem>
                        <SelectItem value="inativo">inativo</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
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
          <CardTitle>Convites</CardTitle>
          <CardDescription>Convide novos membros para o workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="email@exemplo.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="w-32 space-y-1">
              <label className="text-sm font-medium">Role</label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="viewer">viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleInvite} disabled={!canInvite || createInvite.isPending || !inviteEmail.trim()}>
              {createInvite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Convidar
            </Button>
          </div>

          {invitesLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expira em</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell><Badge variant="secondary">{inv.role}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Copiar link do convite"
                          onClick={() => {
                            const link = `${window.location.origin}/signup?invite=${inv.token}`;
                            navigator.clipboard.writeText(link);
                            toast.success("Link copiado!");
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Cancelar convite"
                          onClick={() =>
                            cancelInvite.mutate(inv.id, {
                              onSuccess: () => toast.success("Convite cancelado."),
                              onError: (err: any) => toast.error(err.message),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
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
