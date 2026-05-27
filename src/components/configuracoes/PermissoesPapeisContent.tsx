import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Shield, ShieldCheck, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Role = "admin" | "head" | "user";
type Action = "view" | "insert" | "update" | "delete";
const ROLES: Role[] = ["admin", "head", "user"];
const ACTIONS: Action[] = ["view", "insert", "update", "delete"];
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", head: "Head", user: "User" };

interface Resource {
  key: string;
  module: string;
  label: string;
  description: string | null;
  display_order: number;
}

interface PermRow {
  role: string;
  resource_key: string;
  can_view: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
}

interface TenantRow {
  id: string;
  nome: string;
  rbac_enabled: boolean;
}

function rowOf(rows: PermRow[] | undefined, role: string, key: string): Record<Action, boolean> {
  const r = rows?.find((x) => x.role === role && x.resource_key === key);
  return {
    view: !!r?.can_view,
    insert: !!r?.can_insert,
    update: !!r?.can_update,
    delete: !!r?.can_delete,
  };
}

export default function PermissoesPapeisContent() {
  const { effectiveTenantId: tenantId } = useTenantFilter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Set<string>>(new Set());

  const { data: tenant, isLoading: tenantLoading } = useQuery<TenantRow | null>({
    queryKey: ["tenant-rbac-status", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("tenants" as any) as any)
        .select("id, nome, rbac_enabled")
        .eq("id", tenantId)
        .single();
      if (error) throw error;
      return data as TenantRow;
    },
  });

  const isActive = tenant?.rbac_enabled === true;

  const { data: resources } = useQuery<Resource[]>({
    queryKey: ["rbac-resources"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("resources" as any) as any)
        .select("key, module, label, description, display_order")
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as Resource[];
    },
  });

  const { data: defaults } = useQuery<PermRow[]>({
    queryKey: ["role-permissions-all"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("role_permissions" as any) as any)
        .select("role, resource_key, can_view, can_insert, can_update, can_delete");
      if (error) throw error;
      return (data ?? []) as PermRow[];
    },
  });

  const { data: overrides } = useQuery<PermRow[]>({
    queryKey: ["tenant-role-permissions", tenantId, isActive],
    enabled: !!tenantId && isActive,
    queryFn: async () => {
      const { data, error } = await (supabase.from("tenant_role_permissions" as any) as any)
        .select("role, resource_key, can_view, can_insert, can_update, can_delete")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data ?? []) as PermRow[];
    },
  });

  const { data: lastAudit } = useQuery<{ changed_at: string } | null>({
    queryKey: ["rbac-activation-audit", tenantId, isActive],
    enabled: !!tenantId && isActive,
    queryFn: async () => {
      const { data } = await (supabase.from("permission_audit" as any) as any)
        .select("changed_at")
        .eq("tenant_id", tenantId)
        .order("changed_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });

  const resolved: PermRow[] = useMemo(() => {
    const base = defaults ?? [];
    if (!isActive) return base;
    const ovr = overrides ?? [];
    const map = new Map<string, PermRow>();
    for (const d of base) map.set(`${d.role}|${d.resource_key}`, d);
    for (const o of ovr) map.set(`${o.role}|${o.resource_key}`, o);
    return Array.from(map.values());
  }, [defaults, overrides, isActive]);

  const grouped = useMemo(() => {
    const list = resources ?? [];
    const out: { module: string; items: Resource[] }[] = [];
    const idx = new Map<string, number>();
    for (const r of list) {
      if (!idx.has(r.module)) {
        idx.set(r.module, out.length);
        out.push({ module: r.module, items: [] });
      }
      out[idx.get(r.module)!].items.push(r);
    }
    return out;
  }, [resources]);

  const updateMutation = useMutation({
    mutationFn: async (vars: { role: Role; resource_key: string; action: Action; value: boolean }) => {
      const { data, error } = await (supabase.rpc as any)("update_tenant_permission", {
        p_role: vars.role,
        p_resource_key: vars.resource_key,
        p_action: vars.action,
        p_value: vars.value,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
    },
    onError: (err: any) => {
      toast.error("Erro: " + (err?.message || "falha ao atualizar"));
    },
  });

  const enableMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("enable_rbac_for_tenant");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-rbac-status"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
      toast.success("Gestão de permissões ativada");
    },
    onError: (err: any) => {
      toast.error("Erro: " + (err?.message || "falha ao ativar"));
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (role?: Role) => {
      const { data, error } = await (supabase.rpc as any)("reset_tenant_permissions_to_default", {
        p_role: role ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
      toast.success("Padrões restaurados");
    },
    onError: (err: any) => {
      toast.error("Erro: " + (err?.message || "falha ao restaurar"));
    },
  });

  const handleToggle = async (role: Role, resource_key: string, action: Action, current: boolean) => {
    if (!isActive) return;
    const cellKey = `${role}|${resource_key}|${action}`;
    setPending((prev) => new Set(prev).add(cellKey));
    try {
      await updateMutation.mutateAsync({ role, resource_key, action, value: !current });
    } finally {
      setPending((prev) => {
        const n = new Set(prev);
        n.delete(cellKey);
        return n;
      });
    }
  };

  if (tenantLoading || !resources || !defaults) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!isActive ? (
        <Card className="border-2">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-md bg-muted shrink-0">
                <Shield className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 space-y-2">
                <h3 className="text-base font-semibold">Gestão de permissões desativada</h3>
                <p className="text-sm text-muted-foreground">
                  Todos os usuários do seu tenant operam com permissões padrão por papel. Ative
                  para personalizar o que admin, head e user podem fazer.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="mt-2" disabled={enableMutation.isPending}>
                      {enableMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Ativar gestão de permissões
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Ativar gestão de permissões?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Ao ativar, todas as permissões padrão serão aplicadas ao seu tenant. Você
                        poderá customizar após. Esta ação não bloqueia ninguém imediatamente porque
                        os defaults já refletem o comportamento atual. Confirmar?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => enableMutation.mutate()}>
                        Confirmar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge className="bg-green-600 hover:bg-green-600 text-white gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Gestão de permissões ativa
            </Badge>
            {lastAudit?.changed_at && (
              <span className="text-xs text-muted-foreground">
                desde {new Date(lastAudit.changed_at).toLocaleDateString("pt-BR")}
              </span>
            )}
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={resetMutation.isPending}>
                {resetMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Restaurar padrões
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Restaurar todas as permissões?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso vai desfazer todas as customizações de todos os papéis e voltar aos padrões
                  do sistema. Tem certeza?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => resetMutation.mutate(undefined)}>
                  Restaurar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {!isActive && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-xs text-yellow-700 dark:text-yellow-400">
          Pré-visualização dos padrões. Você poderá customizar após ativar.
        </div>
      )}

      <div className="rounded-md border bg-background overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead className="sticky top-0 bg-background z-10">
            <tr>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 border-b">
                Recurso
                <span className="ml-2 text-[10px] font-normal">(V = ver, I = inserir, U = editar, D = excluir)</span>
              </th>
              {ROLES.map((role) => (
                <th key={role} className="text-left text-xs font-medium text-muted-foreground px-4 py-3 border-b w-[180px]">
                  {ROLE_LABEL[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={cn(!isActive && "opacity-60")}>
            {grouped.map((g) => (
              <>
                <tr key={`mod-${g.module}`} className="bg-muted/40">
                  <td colSpan={4} className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {g.module}
                  </td>
                </tr>
                {g.items.map((res) => (
                  <tr key={res.key} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 border-b border-border/40">
                      <div className="text-sm font-medium">{res.label}</div>
                      {res.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">{res.description}</div>
                      )}
                    </td>
                    {ROLES.map((role) => {
                      const current = rowOf(resolved, role, res.key);
                      const isLockedAdminUsersRoles =
                        role === "admin" && res.key === "usuarios_roles";
                      return (
                        <td key={role} className="px-4 py-2.5 border-b border-border/40">
                          <div className="flex gap-1">
                            {ACTIONS.map((action) => {
                              const value = current[action];
                              const cellKey = `${role}|${res.key}|${action}`;
                              const isPending = pending.has(cellKey);
                              const blockedAdminUpdate =
                                isLockedAdminUsersRoles && action === "update" && value;
                              const disabled = !isActive || isPending || blockedAdminUpdate;
                              return (
                                <button
                                  key={action}
                                  type="button"
                                  onClick={() => handleToggle(role, res.key, action, value)}
                                  disabled={disabled}
                                  className={cn(
                                    "w-7 h-7 rounded text-xs font-mono font-medium transition-colors flex items-center justify-center",
                                    value
                                      ? "bg-green-600 text-white hover:bg-green-700"
                                      : "bg-muted text-muted-foreground hover:bg-muted-foreground/10",
                                    disabled && "opacity-50 cursor-not-allowed",
                                  )}
                                  title={
                                    blockedAdminUpdate
                                      ? "Admin não pode perder edição de papéis"
                                      : `${ROLE_LABEL[role]} – ${action}`
                                  }
                                  aria-label={`${role} ${action} ${res.key}`}
                                >
                                  {isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    action[0].toUpperCase()
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
