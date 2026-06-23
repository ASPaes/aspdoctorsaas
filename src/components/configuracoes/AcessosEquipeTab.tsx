import { useState, useMemo, useEffect, useRef } from "react";
import { QueryClient, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  useTenantInfo,
  useCancelInvite,
  useUpdateUserMaxConcurrentChats,
  useUpdateUserSkills,
} from "@/hooks/useTenantUsers";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

import { toast as sonnerToast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

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
  Building2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";

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
  max_concurrent_chats: number | null;
  skills: string[] | null;
  acesso_todas_unidades: boolean;
}

interface Department {
  id: string;
  name: string;
  is_active: boolean;
  default_instance_id: string | null;
}

interface Funcionario {
  id: number;
  nome: string;
  email: string | null;
  cargo: string | null;
  ativo: boolean;
  department_id: string | null;
}

const accessEquipeQueryKeys = {
  users: (tenantId?: string) => ["tenant-access-users", tenantId] as const,
  dropdownDepartments: (tenantId?: string) => ["tenant-departments-list", tenantId] as const,
  inviteFuncionarios: (tenantId?: string) => ["funcionarios-for-invite", tenantId] as const,
  pendingInvites: (tenantId?: string) => ["access-invites-pending", tenantId] as const,
  pendingApprovals: (tenantId?: string) => ["pending-approvals", tenantId] as const,
};

function resetAccessEquipeTenantQueries(queryClient: QueryClient, tenantId?: string) {
  queryClient.removeQueries({ queryKey: ["tenant-access-users"] });
  queryClient.removeQueries({ queryKey: ["tenant-departments-list"] });
  queryClient.removeQueries({ queryKey: ["funcionarios-for-invite"] });
  queryClient.removeQueries({ queryKey: ["access-invites-pending"] });
  queryClient.removeQueries({ queryKey: ["pending-approvals"] });

  if (!tenantId) return;

  queryClient.setQueryData(accessEquipeQueryKeys.users(tenantId), []);
  queryClient.setQueryData(accessEquipeQueryKeys.dropdownDepartments(tenantId), []);
  queryClient.setQueryData(accessEquipeQueryKeys.inviteFuncionarios(tenantId), []);
  queryClient.setQueryData(accessEquipeQueryKeys.pendingInvites(tenantId), []);
  queryClient.setQueryData(accessEquipeQueryKeys.pendingApprovals(tenantId), []);
}

// ========== Admin-only cells (Limite & Competências) ==========

function MaxChatsCell({
  user,
  onSave,
  isPending,
}: {
  user: AccessUser;
  onSave: (value: number | null) => void;
  isPending: boolean;
}) {
  const initial = user.max_concurrent_chats;
  return (
    <Input
      key={`max-${user.user_id}-${initial ?? "null"}`}
      type="number"
      min={0}
      max={100}
      defaultValue={initial ?? ""}
      placeholder="Padrão"
      disabled={isPending}
      className="w-20 h-8 text-sm"
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") {
          if (initial === null || initial === undefined) return;
          onSave(null);
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 100) return;
        if (n === initial) return;
        onSave(n);
      }}
    />
  );
}

function SkillsCell({
  user,
  onSave,
  isPending,
}: {
  user: AccessUser;
  onSave: (next: string[]) => void;
  isPending: boolean;
}) {
  const [draft, setDraft] = useState("");
  const skills = user.skills ?? [];

  const handleAdd = () => {
    const tag = draft.trim().toLowerCase().slice(0, 20);
    if (!tag) return;
    if (skills.includes(tag)) {
      setDraft("");
      return;
    }
    onSave([...skills, tag]);
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1 max-w-xs">
      {skills.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs">
          <span>{tag}</span>
          <button
            type="button"
            onClick={() => onSave(skills.filter((t) => t !== tag))}
            disabled={isPending}
            className="hover:bg-muted-foreground/20 rounded-sm p-0.5 disabled:opacity-50"
            aria-label={`Remover ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleAdd();
          }
        }}
        disabled={isPending}
        placeholder="+ tag"
        maxLength={20}
        className="h-7 w-24 text-xs"
      />
    </div>
  );
}

// ========== Main Component ==========

export default function AcessosEquipeTab() {
  const { profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const tenantId = tid || profile?.tenant_id;

  const prevTenantRef = useRef(tenantId);
  useEffect(() => {
    if (prevTenantRef.current !== tenantId) {
      prevTenantRef.current = tenantId;
      resetAccessEquipeTenantQueries(queryClient, tenantId);

      if (tenantId) {
        void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.users(tenantId) });
        void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.dropdownDepartments(tenantId) });
        void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.inviteFuncionarios(tenantId) });
        void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.pendingInvites(tenantId) });
        void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.pendingApprovals(tenantId) });
        
      }
    }
  }, [tenantId, queryClient]);

  return (
    <div className="space-y-8">
      <UsersSection tenantId={tenantId} />
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

  // Reset invite state when tenant changes
  const prevTidRef = useRef(tenantId);
  useEffect(() => {
    if (prevTidRef.current !== tenantId) {
      prevTidRef.current = tenantId;
      setSelectedFuncId("");
      setShowInviteCard(false);
      setConfirmReject(null);
      setResolveUser(null);
      setResolveFuncId("");
    }
  }, [tenantId]);

  // Fetch users via RPC — pass tenant_id for super admin simulation
  const { data: users = [], isLoading: usersLoading, error: usersError } = useQuery<AccessUser[]>({
    queryKey: accessEquipeQueryKeys.users(tenantId),
    enabled: !!tenantId,
    placeholderData: [],
    refetchOnMount: "always",
    queryFn: async () => {
      const [profilesRes, emailsRes, funcionariosRes, departmentsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, role, is_super_admin, status, access_status, funcionario_id, max_concurrent_chats, skills, acesso_todas_unidades")
          .eq("tenant_id", tenantId!)
          .order("created_at"),
        (supabase.rpc as any)("get_tenant_users_with_email", { p_tenant_id: tenantId! }),
        supabase
          .from("funcionarios")
          .select("id, nome, email, ativo, department_id")
          .eq("tenant_id", tenantId!),
        supabase
          .from("support_departments")
          .select("id, name, is_active")
          .eq("tenant_id", tenantId!),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (emailsRes.error) throw emailsRes.error;
      if (funcionariosRes.error) throw funcionariosRes.error;
      if (departmentsRes.error) throw departmentsRes.error;

      const emailByUserId = new Map<string, string | null>(
        ((emailsRes.data ?? []) as Array<{ user_id: string; email: string | null }>).map((row) => [
          row.user_id,
          row.email,
        ])
      );

      const funcionarioById = new Map<number, Funcionario>(
        ((funcionariosRes.data ?? []) as Funcionario[]).map((funcionario) => [funcionario.id, funcionario])
      );

      const departmentById = new Map<string, Department>(
        ((departmentsRes.data ?? []) as Department[]).map((department) => [department.id, department])
      );

      return ((profilesRes.data ?? []) as Array<{
        user_id: string;
        role: string;
        is_super_admin: boolean;
        status: string;
        access_status: string | null;
        funcionario_id: number | null;
        max_concurrent_chats: number | null;
        skills: string[] | null;
        acesso_todas_unidades: boolean;
      }>).map((profileRow) => {
        const funcionario = profileRow.funcionario_id
          ? funcionarioById.get(profileRow.funcionario_id) ?? null
          : null;
        const department = funcionario?.department_id
          ? departmentById.get(funcionario.department_id) ?? null
          : null;

        return {
          user_id: profileRow.user_id,
          email: emailByUserId.get(profileRow.user_id) ?? funcionario?.email ?? null,
          role: profileRow.role,
          is_super_admin: profileRow.is_super_admin,
          status: profileRow.status,
          funcionario_id: profileRow.funcionario_id,
          funcionario_nome: funcionario?.nome ?? null,
          funcionario_email: funcionario?.email ?? null,
          funcionario_ativo: funcionario?.ativo ?? null,
          department_id: funcionario?.department_id ?? null,
          department_name: department?.name ?? null,
          department_is_active: department?.is_active ?? null,
          access_status: profileRow.access_status,
          max_concurrent_chats: profileRow.max_concurrent_chats,
          skills: profileRow.skills ?? [],
          acesso_todas_unidades: profileRow.acesso_todas_unidades ?? true,
        };
      });
    },
  });

  // Fetch departments for dropdown — filter by tenant
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: accessEquipeQueryKeys.dropdownDepartments(tenantId),
    enabled: !!tenantId,
    placeholderData: [],
    refetchOnMount: "always",
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

  // Fetch unidades_base of tenant
  const { data: allUnidades = [] } = useQuery<Array<{ id: number; nome: string }>>({
    queryKey: ["tenant-unidades-list", tenantId],
    enabled: !!tenantId,
    placeholderData: [],
    queryFn: async () => {
      const { data, error } = await (supabase.from("unidades_base" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tenantId!)
        .eq("is_active", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
  });

  // Fetch profile_unidades and group by user
  const { data: unidadesByUser = new Map<string, number[]>() } = useQuery<Map<string, number[]>>({
    queryKey: ["tenant-profile-unidades", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profile_unidades" as any) as any)
        .select("user_id, unidade_base_id")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      const map = new Map<string, number[]>();
      ((data ?? []) as Array<{ user_id: string; unidade_base_id: number }>).forEach((row) => {
        const arr = map.get(row.user_id) ?? [];
        arr.push(row.unidade_base_id);
        map.set(row.user_id, arr);
      });
      return map;
    },
  });



  // Fetch active funcionários for invite — filter by tenant
  const { data: funcionarios = [] } = useQuery<Funcionario[]>({
    queryKey: accessEquipeQueryKeys.inviteFuncionarios(tenantId),
    enabled: !!tenantId,
    placeholderData: [],
    refetchOnMount: "always",
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
    queryKey: accessEquipeQueryKeys.pendingInvites(tenantId),
    enabled: !!tenantId,
    placeholderData: [],
    refetchOnMount: "always",
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
    queryKey: accessEquipeQueryKeys.pendingApprovals(tenantId),
    enabled: !!tenantId,
    placeholderData: [],
    refetchOnMount: "always",
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
      const { error } = await supabase
        .from("profiles")
        .update({ role })
        .eq("user_id", userId)
        .eq("tenant_id", tenantId!);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.users(tenantId) });
      void queryClient.invalidateQueries({ queryKey: ["tenant-users", tenantId] });
      sonnerToast.success("Papel atualizado.");
    },
    onError: (err: any) => sonnerToast.error(err.message),
  });

  const updateDeptMutation = useMutation({
    mutationFn: async ({ funcId, deptId }: { funcId: number; deptId: string | null }) => {
      const { error } = await supabase
        .from("funcionarios")
        .update({ department_id: deptId })
        .eq("id", funcId)
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      // Sync com support_department_members é feito automaticamente
      // pelo trigger trg_sync_funcionario_dept_to_members no banco.
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.users(tenantId) });
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.inviteFuncionarios(tenantId) });
      sonnerToast.success("Setor atualizado.");
    },
    onError: (err: any) => sonnerToast.error(err.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ status })
        .eq("user_id", userId)
        .eq("tenant_id", tenantId!);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.users(tenantId) });
      void queryClient.invalidateQueries({ queryKey: ["tenant-users", tenantId] });
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
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.pendingApprovals(tenantId) });
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.users(tenantId) });
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
        p_tenant_id: tenantId ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.pendingInvites(tenantId) });
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.users(tenantId) });
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.inviteFuncionarios(tenantId) });
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
        .eq("id", inviteId)
        .eq("tenant_id", tenantId!);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.pendingInvites(tenantId) });
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
        .eq("user_id", userId)
        .eq("tenant_id", tenantId!);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.users(tenantId) });
      void queryClient.invalidateQueries({ queryKey: ["tenant-users", tenantId] });
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.pendingApprovals(tenantId) });
      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.inviteFuncionarios(tenantId) });
      sonnerToast.success("Funcionário vinculado e acesso ativado com sucesso.");
      setResolveUser(null);
      setResolveFuncId("");
    },
    onError: (err: any) => sonnerToast.error(err.message),
  });

  const updateMaxChatsMutation = useUpdateUserMaxConcurrentChats();
  const updateSkillsMutation = useUpdateUserSkills();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;

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
                          const link = `${window.location.origin}/signup?invite=${inv.id}`;
                          navigator.clipboard.writeText(link);
                          sonnerToast.success("Link do convite copiado!");
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
                  {isAdmin && (
                    <>
                      <TableHead>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger className="cursor-help">Limite</TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              Quantos atendimentos simultâneos o agente pode receber. Em branco = usa o padrão do tenant (5).
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      <TableHead>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger className="cursor-help">Competências</TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              Tags de especialidade usadas na distribuição por competência.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                    </>
                  )}
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
                      {isAdmin && (
                        <>
                          <TableCell>
                            <MaxChatsCell
                              user={u}
                              isPending={updateMaxChatsMutation.isPending}
                              onSave={(value) =>
                                updateMaxChatsMutation.mutate(
                                  { userId: u.user_id, maxConcurrentChats: value },
                                  {
                                    onSuccess: () => {
                                      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.users(tenantId) });
                                      sonnerToast.success("Limite atualizado.");
                                    },
                                    onError: (err: any) => sonnerToast.error(err.message),
                                  }
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <SkillsCell
                              user={u}
                              isPending={updateSkillsMutation.isPending}
                              onSave={(next) =>
                                updateSkillsMutation.mutate(
                                  { userId: u.user_id, skills: next },
                                  {
                                    onSuccess: () => {
                                      void queryClient.invalidateQueries({ queryKey: accessEquipeQueryKeys.users(tenantId) });
                                      sonnerToast.success("Competências atualizadas.");
                                    },
                                    onError: (err: any) => sonnerToast.error(err.message),
                                  }
                                )
                              }
                            />
                          </TableCell>
                        </>
                      )}
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

