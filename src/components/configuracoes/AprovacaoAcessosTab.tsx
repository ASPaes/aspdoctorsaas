import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { Check, X, RotateCcw, Loader2, ShieldAlert } from "lucide-react";

interface PendingProfile {
  user_id: string;
  email: string;
  role: string;
  access_status: string;
  invited_at: string | null;
  invited_by: string | null;
  created_at: string;
}

const statusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "outline" },
  active: { label: "Ativo", variant: "default" },
  blocked: { label: "Bloqueado", variant: "destructive" },
};

export default function AprovacaoAcessosTab() {
  const { profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const tenantId = tid || profile?.tenant_id;
  const qc = useQueryClient();

  const [confirmAction, setConfirmAction] = useState<{
    userId: string;
    email: string;
    action: "reject" | "block";
  } | null>(null);

  const { data: pendingUsers = [], isLoading } = useQuery<PendingProfile[]>({
    queryKey: ["pending-approvals", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tenant_users_with_email", {
        p_tenant_id: tenantId!,
      });
      if (error) throw error;
      // Filter to pending/blocked and sort pending first
      return ((data ?? []) as any[])
        .filter((u) => u.status === "ativo" || true) // include all, filter by access_status below
        .map((u) => ({ ...u, access_status: u.access_status ?? "active" } as PendingProfile));
    },
    select: (data) =>
      data
        .filter((u) => ["pending", "blocked"].includes(u.access_status))
        .sort((a, b) => (a.access_status === "pending" ? -1 : 1) - (b.access_status === "pending" ? -1 : 1)),
  });

  const updateAccess = useMutation({
    mutationFn: async ({
      userId,
      newStatus,
      eventType,
      fromStatus,
    }: {
      userId: string;
      newStatus: string;
      eventType: string;
      fromStatus: string;
    }) => {
      const { error: upErr } = await supabase
        .from("profiles")
        .update({
          access_status: newStatus,
          approved_by: profile?.user_id,
          approved_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("tenant_id", tenantId!);
      if (upErr) throw upErr;

      // Audit
      await supabase.from("audit_events").insert({
        tenant_id: tenantId,
        actor_user_id: profile?.user_id,
        event_type: eventType,
        target_user_id: userId,
        metadata: { from: fromStatus, to: newStatus },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-approvals"] });
      qc.invalidateQueries({ queryKey: ["tenant-users"] });
    },
  });

  const handleApprove = (userId: string) => {
    updateAccess.mutate(
      { userId, newStatus: "active", eventType: "INVITE_APPROVED", fromStatus: "pending" },
      {
        onSuccess: () => toast.success("Acesso aprovado!"),
        onError: (e: any) => toast.error(e.message),
      }
    );
  };

  const handleReject = (userId: string, fromStatus: string) => {
    updateAccess.mutate(
      { userId, newStatus: "blocked", eventType: "INVITE_REJECTED", fromStatus },
      {
        onSuccess: () => toast.success("Acesso rejeitado."),
        onError: (e: any) => toast.error(e.message),
      }
    );
  };

  const handleReactivate = (userId: string) => {
    updateAccess.mutate(
      { userId, newStatus: "active", eventType: "INVITE_APPROVED", fromStatus: "blocked" },
      {
        onSuccess: () => toast.success("Acesso reativado!"),
        onError: (e: any) => toast.error(e.message),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Aprovação de Acessos
          </CardTitle>
          <CardDescription>
            Usuários convidados fora do domínio permitido precisam de aprovação manual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhum acesso pendente de aprovação.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Convidado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingUsers.map((u) => {
                  const badge = statusBadge[u.access_status] ?? statusBadge.pending;
                  return (
                    <TableRow key={u.user_id}>
                      <TableCell className="text-sm">{u.email ?? u.user_id}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{u.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={badge.variant}
                          className={
                            u.access_status === "pending"
                              ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30"
                              : ""
                          }
                        >
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.invited_at
                          ? new Date(u.invited_at).toLocaleDateString("pt-BR")
                          : new Date(u.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {u.access_status === "pending" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-green-600 hover:text-green-700"
                                disabled={updateAccess.isPending}
                                onClick={() => handleApprove(u.user_id)}
                              >
                                {updateAccess.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4 mr-1" />
                                )}
                                Aprovar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={updateAccess.isPending}
                                onClick={() =>
                                  setConfirmAction({
                                    userId: u.user_id,
                                    email: u.email ?? u.user_id,
                                    action: "reject",
                                  })
                                }
                              >
                                <X className="h-4 w-4 mr-1" />
                                Rejeitar
                              </Button>
                            </>
                          )}
                          {u.access_status === "blocked" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={updateAccess.isPending}
                              onClick={() => handleReactivate(u.user_id)}
                            >
                              {updateAccess.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4 mr-1" />
                              )}
                              Reativar
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Confirm reject dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar rejeição</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja realmente rejeitar o acesso de{" "}
              <span className="font-medium">{confirmAction?.email}</span>? O usuário ficará bloqueado e
              não poderá acessar os dados do tenant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmAction) {
                  handleReject(confirmAction.userId, "pending");
                  setConfirmAction(null);
                }
              }}
            >
              Rejeitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
