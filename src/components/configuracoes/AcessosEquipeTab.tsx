import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  useTenantInfo,
  useCancelInvite,
} from "@/hooks/useTenantUsers";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import {
  Users,
  UserPlus,
  Trash2,
  Loader2,
  Copy,
  Building2,
  Plus,
  Save,
  Check,
  X,
  RotateCcw,
  ShieldAlert,
  Pencil,
  AlertTriangle,
  Mail,
  Link2,
} from "lucide-react";

// ========== Types ==========

interface AccessUser {
  user_id: string;
  email: string | null;
  role: string;
  is_super_admin: boolean;
  status: string;
  funcionario_id: number | null;
  funcionario_nome: string | null;
  funcionario_email: string | null;
  funcionario_ativo: boolean | null;
  department_id: string | null;
  department_name: string | null;
  department_is_active: boolean | null;
  access_status: string | null;
}

interface Department {
  id: string;
  name: string;
  is_active: boolean;
  default_instance_id: string | null;
}

interface DeptInstance {
  id: string;
  department_id: string;
  instance_id: string;
  is_active: boolean;
}

interface Funcionario {
  id: number;
  nome: string;
  email: string | null;
  cargo: string | null;
  ativo: boolean;
  department_id: string | null;
}

// ========== Helpers ==========

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ========== Main Component ==========

export default function AcessosEquipeTab() {
  const { profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const tenantId = tid || profile?.tenant_id;

  return (
    <div className="space-y-8">
      <UsersSection tenantId={tenantId} />
      <Separator />
      <DepartmentsSection tenantId={tenantId} />
    </div>
  );
}

// ==========================================
// A) USERS SECTION
// ==========================================

function UsersSection({ tenantId }: { tenantId: string | undefined }) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: tenant } = useTenantInfo();

  const [selectedFuncId, setSelectedFuncId] = useState<string>("");
  const [showInviteCard, setShowInviteCard] = useState(false);
  const [confirmReject, setConfirmReject] = useState<{ userId: string; email: string } | null>(null);
  const [resolveUser, setResolveUser] = useState<AccessUser | null>(null);
  const [resolveFuncId, setResolveFuncId] = useState<string>("");

  // Fetch users via RPC — pass tenant_id for super admin simulation
  const { data: users = [], isLoading: usersLoading, error: usersError } = useQuery<AccessUser[]>({
    queryKey: ["tenant-access-users", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_tenant_access_users", {
        p_tenant_id: tenantId,
      });
      if (error) {
        // Fallback: RPC may not accept p_tenant_id yet — call without it
        if (error.message?.includes("p_tenant_id")) {
          const { data: d2, error: e2 } = await (supabase.rpc as any)("get_tenant_access_users");
          if (e2) throw e2;
          return (d2 ?? []) as AccessUser[];
        }
        throw error;
      }
      return (data ?? []) as AccessUser[];
    },
    retry: 1,
  });

  // Fetch departments for dropdown — filter by tenant
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["tenant-departments-list", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name, is_active, default_instance_id")
        .eq("tenant_id", tenantId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });

  // Fetch active funcionários for invite — filter by tenant
  const { data: funcionarios = [] } = useQuery<Funcionario[]>({
    queryKey: ["funcionarios-for-invite", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("funcionarios")
        .select("id, nome, email, cargo, ativo, department_id")
        .eq("ativo", true)
        .order("nome");
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Funcionario[];
    },
  });

  // Fetch pending access_invites — filter by tenant
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["access-invites-pending", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("access_invites")
        .select("id, funcionario_id, email, status, invited_at, metadata")
        .eq("status", "pending")
        .order("invited_at", { ascending: false });
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Pending approvals
  const { data: pendingUsers = [] } = useQuery({
    queryKey: ["pending-approvals", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, role, access_status, invited_at, created_at")
        .eq("tenant_id", tenantId!)
        .in("access_status", ["pending", "blocked"]);
      if (error) throw error;

      const { data: usersWithEmail } = await (supabase.rpc as any)("get_tenant_users_with_email", {
        p_tenant_id: tenantId!,
      });
      const emailMap = new Map((usersWithEmail ?? []).map((u: any) => [u.user_id, u.email]));

      return (data ?? []).map((p: any) => ({
        ...p,
        email: emailMap.get(p.user_id) ?? p.user_id,
      }));
    },
  });

  const activeDepts = departments.filter((d) => d.is_active);

  // Selected funcionário info
  const selectedFunc = useMemo(
    () => funcionarios.find((f) => String(f.id) === selectedFuncId),
    [funcionarios, selectedFuncId]
  );

  // Check if funcionário already has a linked profile
  const funcAlreadyLinked = useMemo(() => {
    if (!selectedFunc) return false;
    return users.some((u) => u.funcionario_id === selectedFunc.id);
  }, [selectedFunc, users]);

  // Check if there's a pending invite for this funcionário
  const funcHasPendingInvite = useMemo(() => {
    if (!selectedFunc) return false;
    return pendingInvites.some((inv) => inv.funcionario_id === selectedFunc.id);
  }, [selectedFunc, pendingInvites]);

  // Funcionários available for invite (active, not yet linked to a profile, no pending invite)
  const availableFuncionarios = useMemo(() => {
    const linkedFuncIds = new Set(users.filter((u) => u.funcionario_id).map((u) => u.funcionario_id));
    const pendingFuncIds = new Set(pendingInvites.map((inv) => inv.funcionario_id));
    return funcionarios.filter(
      (f) => !linkedFuncIds.has(f.id) && !pendingFuncIds.has(f.id)
    );
  }, [funcionarios, users, pendingInvites]);

  // Department name helper
  const getDeptName = (deptId: string | null) => {
    if (!deptId) return "—";
    return departments.find((d) => d.id === deptId)?.name ?? "—";
  };

  // Mutations
  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await supabase.from("profiles").update({ role }).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-access-users"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-users"] });
      sonnerToast.success("Papel atualizado.");
    },
    onError: (err: any) => sonnerToast.error(err.message),
  });

  const updateDeptMutation = useMutation({
    mutationFn: async ({ funcId, deptId }: { funcId: number; deptId: string | null }) => {
      const { error } = await supabase
        .from("funcionarios")
        .update({ department_id: deptId })
        .eq("id", funcId);
      if (error) throw error;

      const { data: profileRow } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("funcionario_id", funcId)
        .eq("tenant_id", tenantId!)
        .maybeSingle();

      const userId = profileRow?.user_id;
      if (!userId) return;

      await supabase
        .from("support_department_members")
        .delete()
        .eq("user_id", userId)
        .eq("tenant_id", tenantId!);

      if (deptId) {
        await supabase.from("support_department_members").insert({
          tenant_id: tenantId!,
          department_id: deptId,
          user_id: userId,
          is_active: true,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-access-users"] });
      queryClient.invalidateQueries({ queryKey: ["funcionarios_setores"] });
      sonnerToast.success("Setor atualizado.");
    },
    onError: (err: any) => sonnerToast.error(err.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: string }) => {
      const { error } = await supabase.from("profiles").update({ status }).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-access-users"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-users"] });
      sonnerToast.success("Status atualizado.");
    },
    onError: (err: any) => sonnerToast.error(err.message),
  });

  const updateAccessMutation = useMutation({
    mutationFn: async ({ userId, newStatus }: { userId: string; newStatus: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({
          access_status: newStatus,
          approved_by: profile?.user_id,
          approved_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("tenant_id", tenantId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-access-users"] });
    },
  });

  // Invite via RPC create_access_invite
  const createInviteMutation = useMutation({
    mutationFn: async ({ funcionarioId, email }: { funcionarioId: number; email: string }) => {
      const { data, error } = await (supabase.rpc as any)("create_access_invite", {
        p_funcionario_id: funcionarioId,
        p_email: email,
        p_role: "user",
        p_access_status: "ativo",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-invites-pending"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-access-users"] });
      sonnerToast.success("Convite enviado com sucesso!");
      setSelectedFuncId("");
      setShowInviteCard(false);
    },
    onError: (err: any) => sonnerToast.error(err.message),
  });

  // Cancel access invite
  const cancelAccessInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from("access_invites")
        .delete()
        .eq("id", inviteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-invites-pending"] });
      sonnerToast.success("Convite cancelado.");
    },
    onError: (err: any) => sonnerToast.error(err.message),
  });

  // Resolve unlinked user - link to funcionário
  const linkFuncionarioMutation = useMutation({
    mutationFn: async ({ userId, funcionarioId }: { userId: string; funcionarioId: number }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ funcionario_id: funcionarioId, access_status: "active" } as any)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-access-users"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-users"] });
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
      sonnerToast.success("Funcionário vinculado e acesso ativado com sucesso.");
      setResolveUser(null);
      setResolveFuncId("");
    },
    onError: (err: any) => sonnerToast.error(err.message),
  });

  const handleSendInvite = () => {
    if (!selectedFunc || !selectedFunc.email) return;
    if (funcAlreadyLinked) {
      sonnerToast.error("Este funcionário já possui usuário vinculado.");
      return;
    }
    if (funcHasPendingInvite) {
      sonnerToast.error("Já existe convite pendente para este funcionário.");
      return;
    }
    createInviteMutation.mutate({
      funcionarioId: selectedFunc.id,
      email: selectedFunc.email,
    });
  };

  const activeCount = users.filter((u) => u.status === "ativo").length;
  const maxUsers = tenant?.max_users ?? 1;
  const canInvite = activeCount < maxUsers;

  // Users without funcionário link
  const unlinkedUsers = users.filter((u) => !u.funcionario_id);

  if (usersLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (usersError) {
    return (
      <Card className="border-destructive">
        <CardContent className="py-6">
          <p className="text-destructive text-sm">
            Erro ao carregar usuários: {(usersError as any)?.message ?? "Erro desconhecido"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" />
            Usuários & Convites
          </h2>
          <p className="text-sm text-muted-foreground">
            {activeCount} ativos / {maxUsers} permitidos
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowInviteCard(!showInviteCard)}
          disabled={!canInvite}
        >
          <UserPlus className="h-4 w-4 mr-1" />
          Convidar
        </Button>
      </div>

      {/* Invite Card - Funcionário-based */}
      {showInviteCard && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Convidar Funcionário
            </CardTitle>
            <CardDescription className="text-xs">
              Selecione um funcionário cadastrado para enviar o convite de acesso ao sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Funcionário select */}
            <div className="space-y-1">
              <Label className="text-xs">Funcionário</Label>
              <Select value={selectedFuncId} onValueChange={setSelectedFuncId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um funcionário..." />
                </SelectTrigger>
                <SelectContent>
                  {availableFuncionarios.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      Nenhum funcionário disponível para convite
                    </div>
                  ) : (
                    availableFuncionarios.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        <div className="flex items-center gap-2">
                          <span>{f.nome}</span>
                          {f.email ? (
                            <span className="text-xs text-muted-foreground">({f.email})</span>
                          ) : (
                            <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-500/30">
                              Sem e-mail
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Details when funcionário selected */}
            {selectedFunc && (
              <div className="rounded-md border p-3 space-y-2 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground">
                  Convite vinculado ao Funcionário: <span className="text-foreground font-semibold">{selectedFunc.nome}</span>
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs text-muted-foreground">Email do convite</Label>
                    {selectedFunc.email ? (
                      <p className="text-sm font-medium flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        {selectedFunc.email}
                      </p>
                    ) : (
                      <p className="text-sm text-yellow-600 flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Preencha o e-mail no cadastro do funcionário para convidar.
                      </p>
                    )}
                  </div>

                  <div className="space-y-0.5">
                    <Label className="text-xs text-muted-foreground">Setor</Label>
                    <p className="text-sm">{getDeptName(selectedFunc.department_id)}</p>
                  </div>

                  <div className="space-y-0.5">
                    <Label className="text-xs text-muted-foreground">Papel</Label>
                    <p className="text-sm">
                      <Badge variant="secondary">user</Badge>
                    </p>
                  </div>
                </div>

                {funcAlreadyLinked && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <X className="h-3.5 w-3.5" />
                    Este funcionário já possui usuário vinculado.
                  </p>
                )}
                {funcHasPendingInvite && (
                  <p className="text-xs text-yellow-600 flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Já existe convite pendente para este funcionário.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSendInvite}
                disabled={
                  !selectedFunc ||
                  !selectedFunc.email ||
                  funcAlreadyLinked ||
                  funcHasPendingInvite ||
                  createInviteMutation.isPending
                }
                size="sm"
              >
                {createInviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Enviar Convite
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowInviteCard(false);
                  setSelectedFuncId("");
                }}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Access Invites */}
      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-500" />
              Convites Pendentes ({pendingInvites.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingInvites.map((inv) => {
                const func = funcionarios.find((f) => f.id === inv.funcionario_id);
                return (
                  <div key={inv.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{func?.nome ?? `Func #${inv.funcionario_id}`}</span>
                      <span className="text-muted-foreground">{inv.email}</span>
                      <Badge variant="outline" className="text-xs">
                        {(inv.metadata as any)?.role ?? "user"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground mr-2">
                        {new Date(inv.invited_at).toLocaleDateString("pt-BR")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          const link = `${window.location.origin}/signup`;
                          navigator.clipboard.writeText(link);
                          sonnerToast.success("Link copiado!");
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => cancelAccessInviteMutation.mutate(inv.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Approvals */}
      {pendingUsers.length > 0 && (
        <Card className="border-yellow-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-yellow-600" />
              Aprovações Pendentes ({pendingUsers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingUsers.map((u: any) => (
                <div key={u.user_id} className="flex items-center justify-between text-sm">
                  <span>{u.email}</span>
                  <div className="flex items-center gap-1">
                    {u.access_status === "pending" && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-green-600 h-7"
                          onClick={() =>
                            updateAccessMutation.mutate(
                              { userId: u.user_id, newStatus: "active" },
                              { onSuccess: () => sonnerToast.success("Aprovado!") }
                            )
                          }
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Aprovar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive h-7"
                          onClick={() => setConfirmReject({ userId: u.user_id, email: u.email })}
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          Rejeitar
                        </Button>
                      </>
                    )}
                    {u.access_status === "blocked" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() =>
                          updateAccessMutation.mutate(
                            { userId: u.user_id, newStatus: "active" },
                            { onSuccess: () => sonnerToast.success("Reativado!") }
                          )
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        Reativar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Acesso</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isUnlinked = !u.funcionario_id;
                  return (
                    <TableRow key={u.user_id} className={isUnlinked ? "bg-yellow-500/5" : ""}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          {isUnlinked && (
                            <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                          )}
                          <span>{u.funcionario_nome ?? "—"}</span>
                          {isUnlinked && (
                            <Badge
                              variant="outline"
                              className="text-xs text-yellow-700 border-yellow-500/40 bg-yellow-500/10 cursor-pointer hover:bg-yellow-500/20"
                              onClick={() => {
                                setResolveUser(u);
                                setResolveFuncId("");
                              }}
                            >
                              Sem vínculo
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.email ?? u.funcionario_email ?? "—"}
                      </TableCell>
                      <TableCell>
                        {u.funcionario_id ? (
                          <Select
                            value={u.department_id ?? "none"}
                            onValueChange={(v) =>
                              updateDeptMutation.mutate({
                                funcId: u.funcionario_id!,
                                deptId: v === "none" ? null : v,
                              })
                            }
                          >
                            <SelectTrigger className="w-36 h-8">
                              <SelectValue placeholder="Sem setor" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sem setor</SelectItem>
                              {activeDepts.map((d) => (
                                <SelectItem key={d.id} value={d.id}>
                                  {d.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.role}
                          onValueChange={(v) => updateRoleMutation.mutate({ userId: u.user_id, role: v })}
                          disabled={u.user_id === profile?.user_id || u.is_super_admin}
                        >
                          <SelectTrigger className="w-24 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">admin</SelectItem>
                            <SelectItem value="head">head</SelectItem>
                            <SelectItem value="user">user</SelectItem>
                            <SelectItem value="viewer">viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.access_status ?? "active"}
                          onValueChange={(v) => {
                            // Block activating user without funcionário link
                            if (v === "active" && !u.funcionario_id) {
                              sonnerToast.error("Não é possível ativar um usuário sem funcionário vinculado.");
                              return;
                            }
                            const label = v === "active" ? "ativo" : v === "blocked" ? "bloqueado" : "pendente";
                            const msg = v === "active"
                              ? "Usuário poderá acessar o chat imediatamente."
                              : `Usuário ficará ${label} e não poderá acessar o sistema.`;
                            if (confirm(msg + " Confirma?")) {
                              updateAccessMutation.mutate(
                                { userId: u.user_id, newStatus: v },
                                {
                                  onSuccess: () => sonnerToast.success(`Acesso alterado para ${label}.`),
                                }
                              );
                            }
                          }}
                          disabled={u.user_id === profile?.user_id || u.is_super_admin}
                        >
                          <SelectTrigger className="w-28 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">
                              <span className="text-green-700">Ativo</span>
                            </SelectItem>
                            <SelectItem value="pending">
                              <span className="text-yellow-700">Pendente</span>
                            </SelectItem>
                            <SelectItem value="blocked">
                              <span className="text-red-700">Bloqueado</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.status}
                          onValueChange={(v) => {
                            // Block activating user without funcionário link
                            if (v === "ativo" && !u.funcionario_id) {
                              sonnerToast.error("Não é possível ativar um usuário sem funcionário vinculado.");
                              return;
                            }
                            updateStatusMutation.mutate({ userId: u.user_id, status: v });
                          }}
                          disabled={u.user_id === profile?.user_id}
                        >
                          <SelectTrigger className="w-24 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ativo">ativo</SelectItem>
                            <SelectItem value="inativo">inativo</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Confirm reject */}
      <AlertDialog open={!!confirmReject} onOpenChange={(o) => !o && setConfirmReject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejeitar acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário <strong>{confirmReject?.email}</strong> ficará bloqueado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (confirmReject) {
                  updateAccessMutation.mutate(
                    { userId: confirmReject.userId, newStatus: "blocked" },
                    { onSuccess: () => sonnerToast.success("Acesso rejeitado.") }
                  );
                  setConfirmReject(null);
                }
              }}
            >
              Rejeitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resolve unlinked user dialog */}
      <Dialog open={!!resolveUser} onOpenChange={(o) => !o && setResolveUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Resolver vínculo
            </DialogTitle>
            <DialogDescription>
              O usuário <strong>{resolveUser?.email ?? resolveUser?.user_id}</strong> não está vinculado a nenhum funcionário.
              Selecione um funcionário para vincular ou desative o acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-sm">Vincular a funcionário</Label>
              <Select value={resolveFuncId} onValueChange={setResolveFuncId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um funcionário..." />
                </SelectTrigger>
                <SelectContent>
                  {funcionarios
                    .filter((f) => !users.some((u) => u.funcionario_id === f.id))
                    .map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.nome} {f.email ? `(${f.email})` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (resolveUser) {
                  updateStatusMutation.mutate(
                    { userId: resolveUser.user_id, status: "inativo" },
                    {
                      onSuccess: () => {
                        sonnerToast.success("Usuário desativado.");
                        setResolveUser(null);
                      },
                    }
                  );
                }
              }}
            >
              Desativar acesso
            </Button>
            <Button
              disabled={!resolveFuncId || linkFuncionarioMutation.isPending}
              onClick={() => {
                if (resolveUser && resolveFuncId) {
                  linkFuncionarioMutation.mutate({
                    userId: resolveUser.user_id,
                    funcionarioId: Number(resolveFuncId),
                  });
                }
              }}
            >
              {linkFuncionarioMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Link2 className="h-4 w-4" />
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Access status badge helper
function AccessStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  
  const map: Record<string, { label: string; className: string }> = {
    active: { label: "Ativo", className: "bg-green-500/10 text-green-700 border-green-500/30" },
    ativo: { label: "Ativo", className: "bg-green-500/10 text-green-700 border-green-500/30" },
    pending: { label: "Pendente", className: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30" },
    blocked: { label: "Bloqueado", className: "bg-red-500/10 text-red-700 border-red-500/30" },
  };

  const info = map[status] ?? { label: status, className: "" };

  return (
    <Badge variant="outline" className={`text-xs ${info.className}`}>
      {info.label}
    </Badge>
  );
}

// ==========================================
// B) DEPARTMENTS SECTION
// ==========================================

function DepartmentsSection({ tenantId }: { tenantId: string | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { instances } = useWhatsAppInstances();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formFallback, setFormFallback] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  // Departments — filter by tenant
  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["support_departments", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("support_departments")
        .select("*")
        .order("name");
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Linked instances for selected dept
  const { data: deptInstances = [] } = useQuery<DeptInstance[]>({
    queryKey: ["support_department_instances", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_department_instances")
        .select("*")
        .eq("department_id", selectedId!);
      if (error) throw error;
      return (data ?? []) as DeptInstance[];
    },
  });

  const selectedDept = departments.find((d: any) => d.id === selectedId);
  const linkedInstanceIds = new Set(deptInstances.map((di) => di.instance_id));

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      const slug = slugify(formName);
      if (!slug) throw new Error("Nome inválido");
      if (!tenantId) throw new Error("Tenant não identificado");

      const payload = {
        name: formName.trim(),
        slug,
        description: formDesc.trim() || null,
        is_active: formActive,
        is_default_fallback: formFallback,
        tenant_id: tenantId,
      };

      if (isCreating) {
        const { error } = await supabase.from("support_departments").insert(payload);
        if (error) throw error;
      } else if (selectedId) {
        const { name, slug: s, description, is_active, is_default_fallback } = payload;
        const { error } = await supabase
          .from("support_departments")
          .update({ name, slug: s, description, is_active, is_default_fallback })
          .eq("id", selectedId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-departments-list"] });
      toast({ title: "Setor salvo!" });
      setIsCreating(false);
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const toggleInstanceMutation = useMutation({
    mutationFn: async ({ instanceId, linked }: { instanceId: string; linked: boolean }) => {
      if (!selectedId || !tenantId) return;
      if (linked) {
        await supabase
          .from("support_department_instances")
          .delete()
          .eq("department_id", selectedId)
          .eq("instance_id", instanceId);
        if (selectedDept?.default_instance_id === instanceId) {
          await supabase
            .from("support_departments")
            .update({ default_instance_id: null })
            .eq("id", selectedId);
        }
      } else {
        await supabase.from("support_department_instances").insert({
          department_id: selectedId,
          instance_id: instanceId,
          tenant_id: tenantId,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_department_instances", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["support_departments"] });
    },
  });

  const setDefaultInstanceMutation = useMutation({
    mutationFn: async (instanceId: string | null) => {
      if (!selectedId) return;
      const { error } = await supabase
        .from("support_departments")
        .update({ default_instance_id: instanceId })
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments"] });
      toast({ title: "Instância padrão atualizada" });
    },
  });

  const selectDept = (dept: any) => {
    setSelectedId(dept.id);
    setIsCreating(false);
    setFormName(dept.name);
    setFormDesc(dept.description ?? "");
    setFormActive(dept.is_active);
    setFormFallback(dept.is_default_fallback);
  };

  const startCreate = () => {
    setSelectedId(null);
    setIsCreating(true);
    setFormName("");
    setFormDesc("");
    setFormActive(true);
    setFormFallback(false);
  };

  const handleSave = () => {
    if (!formActive && selectedDept?.is_active) {
      setConfirmDeactivate(true);
      return;
    }
    saveMutation.mutate();
  };

  const showDetail = isCreating || selectedId;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Setores
        </h2>
        <Button size="sm" onClick={startCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Novo Setor
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="flex gap-4">
          {/* Left: dept list */}
          <div className="hidden md:block w-56 shrink-0 space-y-1.5">
            {departments.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum setor</p>
            )}
            {departments.map((d: any) => (
              <button
                key={d.id}
                onClick={() => selectDept(d)}
                className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent ${
                  selectedId === d.id ? "border-primary bg-accent" : "border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate flex-1">{d.name}</span>
                  {!d.is_active && <Badge variant="secondary" className="text-xs">Inativo</Badge>}
                </div>
              </button>
            ))}
          </div>

          {/* Mobile selector */}
          <div className="md:hidden w-full">
            <Select
              value={selectedId ?? ""}
              onValueChange={(v) => {
                const dept = departments.find((d: any) => d.id === v);
                if (dept) selectDept(dept);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um setor" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Right: detail */}
          <div className="flex-1 min-w-0">
            {!showDetail ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Building2 className="mx-auto h-8 w-8 mb-2 opacity-40" />
                  <p className="text-sm">Selecione um setor ou crie um novo</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {/* Dept form */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      {isCreating ? "Novo Setor" : "Editar Setor"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Nome</Label>
                      <Input
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="Ex: Suporte Técnico"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Descrição</Label>
                      <Textarea
                        value={formDesc}
                        onChange={(e) => setFormDesc(e.target.value)}
                        placeholder="Opcional"
                        rows={2}
                      />
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <Switch checked={formActive} onCheckedChange={setFormActive} id="dept-active-eq" />
                        <Label htmlFor="dept-active-eq" className="text-sm">Ativo</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={formFallback} onCheckedChange={setFormFallback} id="dept-fallback-eq" />
                        <Label htmlFor="dept-fallback-eq" className="text-sm">Fallback</Label>
                      </div>
                    </div>
                    <Button onClick={handleSave} disabled={!formName.trim() || saveMutation.isPending} size="sm">
                      {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      <Save className="h-4 w-4" />
                      Salvar
                    </Button>
                  </CardContent>
                </Card>

                {/* Instances */}
                {!isCreating && selectedId && instances.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Instâncias do Setor</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        {instances.map((inst) => {
                          const isLinked = linkedInstanceIds.has(inst.id);
                          return (
                            <div key={inst.id} className="flex items-center gap-2">
                              <Checkbox
                                checked={isLinked}
                                onCheckedChange={() =>
                                  toggleInstanceMutation.mutate({ instanceId: inst.id, linked: isLinked })
                                }
                              />
                              <span className="text-sm">{inst.display_name || inst.instance_name}</span>
                            </div>
                          );
                        })}
                      </div>
                      {linkedInstanceIds.size > 0 && (
                        <div className="space-y-1 pt-2 border-t">
                          <Label className="text-xs">Instância Padrão</Label>
                          <Select
                            value={selectedDept?.default_instance_id ?? "none"}
                            onValueChange={(v) =>
                              setDefaultInstanceMutation.mutate(v === "none" ? null : v)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Nenhuma</SelectItem>
                              {instances
                                .filter((i) => linkedInstanceIds.has(i.id))
                                .map((i) => (
                                  <SelectItem key={i.id} value={i.id}>
                                    {i.display_name || i.instance_name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm deactivate */}
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar setor?</AlertDialogTitle>
            <AlertDialogDescription>
              O setor "{formName}" ficará inativo. Funcionários vinculados não serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => saveMutation.mutate()}>
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
