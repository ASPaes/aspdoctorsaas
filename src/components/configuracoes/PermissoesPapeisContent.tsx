import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { Shield, ShieldCheck, ShieldOff, Loader2, RotateCcw, Info, Save, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Role = "admin" | "head" | "user";
type Action = "view" | "insert" | "update" | "delete";
const ROLES: Role[] = ["admin", "head", "user"];
const ACTIONS: Action[] = ["view", "insert", "update", "delete"];
const CRUD_ENABLED = false; // true reexibe Inserir/Editar/Excluir
const VISIBLE_ACTIONS: Action[] = CRUD_ENABLED ? ACTIONS : ["view"];
const SCREEN_ONLY = true; // mostra só telas (nav.*, cfg.*) + clientes.custos
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", head: "Head", user: "User" };

interface Resource {
  key: string;
  module: string;
  label: string;
  description: string | null;
  where_it_appears: string | null;
  is_navigation: boolean | null;
  hidden: boolean | null;
  parent_key: string | null;
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

interface PendingChange {
  role: Role;
  resource_key: string;
  action: Action;
  value: boolean;
}

const ACTION_LABEL: Record<Action, string> = {
  view: "Ver",
  insert: "Inserir",
  update: "Editar",
  delete: "Excluir",
};

// Anti-lockout cells: admin can never lose these
const LOCKED_CELLS: Array<{ role: Role; resource_key: string; action: Action; reason: string }> = [
  { role: "admin", resource_key: "cfg.permissoes", action: "update", reason: "Anti-lockout: admin sempre pode editar permissões" },
  { role: "admin", resource_key: "cfg.permissoes", action: "view", reason: "Anti-lockout: admin sempre pode ver permissões" },
  { role: "admin", resource_key: "cfg.acessos", action: "view", reason: "Anti-lockout: admin sempre pode ver acessos" },
];

function isLocked(role: Role, resource_key: string, action: Action) {
  return LOCKED_CELLS.find((c) => c.role === role && c.resource_key === resource_key && c.action === action);
}

function pkey(role: string, resource_key: string, action: string) {
  return `${role}-${resource_key}-${action}`;
}

export default function PermissoesPapeisContent() {
  const { effectiveTenantId: tenantId } = useTenantFilter();
  const queryClient = useQueryClient();
  const [pendingChanges, setPendingChanges] = useState<Record<string, PendingChange>>({});

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
    queryKey: ["rbac-resources-v2"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("resources" as any) as any)
        .select("key, module, label, description, where_it_appears, is_navigation, hidden, parent_key, display_order")
        .eq("hidden", false)
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

  // Build O(1) lookup of currently-saved values
  const savedMap = useMemo(() => {
    const m = new Map<string, boolean>();
    const base = defaults ?? [];
    for (const d of base) {
      m.set(pkey(d.role, d.resource_key, "view"), !!d.can_view);
      m.set(pkey(d.role, d.resource_key, "insert"), !!d.can_insert);
      m.set(pkey(d.role, d.resource_key, "update"), !!d.can_update);
      m.set(pkey(d.role, d.resource_key, "delete"), !!d.can_delete);
    }
    if (isActive) {
      for (const o of overrides ?? []) {
        m.set(pkey(o.role, o.resource_key, "view"), !!o.can_view);
        m.set(pkey(o.role, o.resource_key, "insert"), !!o.can_insert);
        m.set(pkey(o.role, o.resource_key, "update"), !!o.can_update);
        m.set(pkey(o.role, o.resource_key, "delete"), !!o.can_delete);
      }
    }
    return m;
  }, [defaults, overrides, isActive]);

  const grouped = useMemo(() => {
    const visible = (resources ?? []).filter(
      (r) => !SCREEN_ONLY || r.key.startsWith("nav.") || r.key.startsWith("cfg.") || r.key === "clientes.custos"
    );
    const groupOf = (r: Resource): { group: string; sub: string } => {
      if (r.key === "clientes.custos") return { group: "Clientes", sub: "" };
      if (r.module.startsWith("Configurações > "))
        return { group: "Configurações", sub: r.module.slice("Configurações > ".length) };
      return { group: r.module, sub: "" };
    };
    const out: { group: string; subgroups: { label: string; items: Resource[] }[] }[] = [];
    const gIdx = new Map<string, number>();
    for (const r of visible) {
      const { group, sub } = groupOf(r);
      if (!gIdx.has(group)) {
        gIdx.set(group, out.length);
        out.push({ group, subgroups: [] });
      }
      const grp = out[gIdx.get(group)!];
      let sg = grp.subgroups.find((s) => s.label === sub);
      if (!sg) {
        sg = { label: sub, items: [] };
        grp.subgroups.push(sg);
      }
      sg.items.push(r);
    }
    for (const g of out)
      for (const s of g.subgroups) s.items.sort((a, b) => a.display_order - b.display_order);
    return out;
  }, [resources]);

  const pendingCount = Object.keys(pendingChanges).length;

  // Warn on unload if dirty
  useEffect(() => {
    if (pendingCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pendingCount]);

  const getEffectiveValue = (role: Role, resource_key: string, action: Action): boolean => {
    const k = pkey(role, resource_key, action);
    if (k in pendingChanges) return pendingChanges[k].value;
    return savedMap.get(k) ?? false;
  };

  const isPending = (role: Role, resource_key: string, action: Action) =>
    pkey(role, resource_key, action) in pendingChanges;

  const handleToggle = (role: Role, resource_key: string, action: Action) => {
    if (!isActive) return;
    if (isLocked(role, resource_key, action)) return;
    const k = pkey(role, resource_key, action);
    const current = getEffectiveValue(role, resource_key, action);
    const saved = savedMap.get(k) ?? false;
    const next = !current;
    setPendingChanges((prev) => {
      const copy = { ...prev };
      if (next === saved) {
        // Reverted to saved value -> drop from pending
        delete copy[k];
      } else {
        copy[k] = { role, resource_key, action, value: next };
      }
      return copy;
    });
  };

  const discard = () => setPendingChanges({});

  const saveMutation = useMutation({
    mutationFn: async () => {
      const changes = Object.values(pendingChanges);
      const results = await Promise.all(
        changes.map((c) =>
          (supabase.rpc as any)("update_tenant_permission", {
            p_role: c.role,
            p_resource_key: c.resource_key,
            p_action: c.action,
            p_value: c.value,
          }),
        ),
      );
      const errors = results.filter((r: any) => r.error);
      if (errors.length > 0) {
        throw new Error(`${errors.length} erro(s): ${errors[0].error.message}`);
      }
      return results.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["tenant-role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
      setPendingChanges({});
      toast.success(`${count} permissão(ões) atualizada(s)`);
    },
    onError: (err: any) => {
      toast.error("Erro ao salvar: " + (err?.message || "falha"));
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
    onError: (err: any) => toast.error("Erro: " + (err?.message || "falha ao ativar")),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("reset_tenant_permissions_to_default", {
        p_role: null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
      setPendingChanges({});
      toast.success("Padrões restaurados");
    },
    onError: (err: any) => toast.error("Erro: " + (err?.message || "falha ao restaurar")),
  });

  if (tenantLoading || !resources || !defaults) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Inert state — show activation card
  if (!isActive) {
    return (
      <div className="space-y-6">
        <Card className="border-2">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-md bg-muted shrink-0">
                <ShieldOff className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 space-y-2">
                <h3 className="text-base font-semibold">Gestão de permissões desativada</h3>
                <p className="text-sm text-muted-foreground">
                  Todos os usuários do seu tenant operam com permissões padrão por papel. Ative para
                  personalizar o que admin, head e user podem fazer em cada módulo do sistema.
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
                        Ao ativar, todas as permissões padrão serão aplicadas ao seu tenant. Esta
                        ação não bloqueia ninguém imediatamente porque os defaults já refletem o
                        comportamento atual. Você poderá customizar depois.
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

        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-xs text-yellow-700 dark:text-yellow-400">
          Pré-visualização dos padrões abaixo. Você poderá customizar após ativar.
        </div>

        <MatrixTable
          grouped={grouped}
          getValue={(r, k, a) => savedMap.get(pkey(r, k, a)) ?? false}
          isPending={() => false}
          onToggle={() => {}}
          disabled
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-green-600 hover:bg-green-600 text-white gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Gestão ativa
            </Badge>
            {pendingCount > 0 && (
              <Badge variant="outline" className="border-orange-400 text-orange-700 dark:text-orange-400 gap-1">
                {pendingCount} mudança{pendingCount > 1 ? "s" : ""} não salva{pendingCount > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={discard}
              disabled={pendingCount === 0 || saveMutation.isPending}
            >
              <Undo2 className="h-4 w-4" />
              Descartar
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={pendingCount === 0 || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Salvar
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={resetMutation.isPending}>
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
                    do sistema. Mudanças pendentes serão descartadas. Tem certeza?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => resetMutation.mutate()}>
                    Restaurar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      <MatrixTable
        grouped={grouped}
        getValue={getEffectiveValue}
        isPending={isPending}
        onToggle={handleToggle}
      />

      {/* Footer save bar */}
      <div className="flex items-center justify-end gap-2 pt-4 border-t">
        <span className="text-xs text-muted-foreground mr-auto">
          {pendingCount > 0
            ? `${pendingCount} mudança${pendingCount > 1 ? "s" : ""} não salva${pendingCount > 1 ? "s" : ""}`
            : "Nenhuma mudança pendente"}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={discard}
          disabled={pendingCount === 0 || saveMutation.isPending}
        >
          <Undo2 className="h-4 w-4" />
          Descartar
        </Button>
        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={pendingCount === 0 || saveMutation.isPending}
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

// ---------- Matrix ----------

interface MatrixTableProps {
  grouped: { group: string; subgroups: { label: string; items: Resource[] }[] }[];
  getValue: (role: Role, resource_key: string, action: Action) => boolean;
  isPending: (role: Role, resource_key: string, action: Action) => boolean;
  onToggle: (role: Role, resource_key: string, action: Action) => void;
  disabled?: boolean;
}

function MatrixTable({ grouped, getValue, isPending, onToggle, disabled }: MatrixTableProps) {
  return (
    <div className={cn("space-y-8", disabled && "opacity-70")}>
      {grouped.map((g) => (
        <section key={g.group} className="rounded-md border bg-background overflow-hidden">
          <header className="bg-muted/40 px-4 py-3 border-b">
            <h3 className="text-sm font-semibold tracking-wide flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              {g.group}
            </h3>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left text-[11px] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 border-b min-w-[240px]">
                    Recurso
                    <span className="ml-2 text-[10px] normal-case font-normal text-muted-foreground/70">
                      {CRUD_ENABLED ? "(V·ver  I·inserir  U·editar  D·excluir)" : "(somente visualização da tela)"}
                    </span>
                  </th>
                  {ROLES.map((role) => (
                    <th
                      key={role}
                      className="text-left text-[11px] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 border-b w-[180px]"
                    >
                      {ROLE_LABEL[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.subgroups.map((sg, i) => (
                  <Fragment key={sg.label || i}>
                    {sg.label && (
                      <tr>
                        <td colSpan={1 + ROLES.length} className="bg-muted/20 px-4 py-1.5 text-[11px] uppercase tracking-wider font-medium text-muted-foreground border-b">
                          {sg.label}
                        </td>
                      </tr>
                    )}
                    {sg.items.map((res) => (
                      <ResourceRow
                        key={res.key}
                        res={res}
                        getValue={getValue}
                        isPending={isPending}
                        onToggle={onToggle}
                        disabled={disabled}
                      />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

interface ResourceRowProps {
  res: Resource;
  getValue: (role: Role, resource_key: string, action: Action) => boolean;
  isPending: (role: Role, resource_key: string, action: Action) => boolean;
  onToggle: (role: Role, resource_key: string, action: Action) => void;
  disabled?: boolean;
}

function ResourceRow({ res, getValue, isPending, onToggle, disabled }: ResourceRowProps) {
  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-3 border-b border-border/40 align-top">
        <div className="flex items-start gap-1.5">
          <div className="min-w-0">
            <div className="text-sm font-medium leading-tight">{res.label}</div>
            {res.where_it_appears && (
              <div className="text-xs text-muted-foreground mt-0.5">{res.where_it_appears}</div>
            )}
          </div>
          {(res.description || res.where_it_appears) && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Detalhes de ${res.label}`}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" className="w-80 text-sm">
                <div className="space-y-2">
                  <div className="font-semibold">{res.label}</div>
                  {res.description && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                        Descrição
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed">{res.description}</p>
                    </div>
                  )}
                  {res.where_it_appears && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                        Onde aparece
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed">{res.where_it_appears}</p>
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground pt-1 border-t font-mono">
                    {res.key}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </td>
      {ROLES.map((role) => (
        <td key={role} className="px-4 py-3 border-b border-border/40 align-top">
          <div className="flex gap-1">
            {VISIBLE_ACTIONS.map((action) => {
              const value = getValue(role, res.key, action);
              const pending = isPending(role, res.key, action);
              const locked = isLocked(role, res.key, action);
              const isDisabled = !!disabled || !!locked;
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => onToggle(role, res.key, action)}
                  disabled={isDisabled}
                  title={locked ? locked.reason : `${ROLE_LABEL[role]} – ${ACTION_LABEL[action]}`}
                  aria-label={`${role} ${action} ${res.key}`}
                  className={cn(
                    "w-7 h-7 rounded text-xs font-mono font-medium transition-all flex items-center justify-center border",
                    value
                      ? "bg-green-500 text-white border-green-500 hover:bg-green-600"
                      : "bg-muted text-muted-foreground border-transparent hover:bg-muted-foreground/10",
                    pending && "border-orange-400 ring-1 ring-orange-200 dark:ring-orange-900",
                    isDisabled && "opacity-50 cursor-not-allowed hover:bg-muted",
                    locked && value && "opacity-60",
                  )}
                >
                  {action[0].toUpperCase()}
                </button>
              );
            })}
          </div>
        </td>
      ))}
    </tr>
  );
}
