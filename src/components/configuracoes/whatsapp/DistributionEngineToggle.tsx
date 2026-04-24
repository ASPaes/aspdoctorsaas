import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, Pause } from "lucide-react";
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
import { toast as sonnerToast } from "sonner";

export function DistributionEngineToggle() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: engineStatus, isLoading } = useQuery({
    queryKey: ["distribution-engine-status", tid],
    enabled: !!tid && !!isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes")
        .select("support_config")
        .eq("tenant_id", tid as string)
        .maybeSingle();
      if (error) throw error;
      const cfg = (data?.support_config ?? {}) as Record<string, unknown>;
      return {
        enabled: Boolean(cfg.distribution_enabled_globally),
      };
    },
    refetchInterval: 15000,
  });

  const toggleEngine = useMutation({
    mutationFn: async (enable: boolean) => {
      const { data: current, error: getErr } = await supabase
        .from("configuracoes")
        .select("support_config")
        .eq("tenant_id", tid as string)
        .single();
      if (getErr) throw getErr;

      const baseConfig = (current?.support_config ?? {}) as Record<string, unknown>;
      const newConfig = {
        ...baseConfig,
        distribution_enabled_globally: enable,
      };

      const { error: updErr } = await supabase
        .from("configuracoes")
        .update({ support_config: newConfig })
        .eq("tenant_id", tid as string);
      if (updErr) throw updErr;

      return enable;
    },
    onSuccess: (enabled) => {
      queryClient.invalidateQueries({ queryKey: ["distribution-engine-status"] });
      if (enabled) {
        sonnerToast.success("Motor de distribuição ativado", {
          description: "Atendimentos serão distribuídos automaticamente conforme as regras.",
        });
      } else {
        sonnerToast.success("Motor pausado", {
          description: "Nenhum novo atendimento será distribuído automaticamente.",
        });
      }
    },
    onError: (err: any) => {
      sonnerToast.error("Erro ao alterar status", {
        description: err?.message || "Tente novamente.",
      });
    },
  });

  if (!isAdmin) return null;

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  const isEnabled = engineStatus?.enabled ?? false;
  const isMutating = toggleEngine.isPending;

  const handleConfirmActivate = () => {
    setShowConfirm(false);
    toggleEngine.mutate(true);
  };

  const handlePause = () => {
    toggleEngine.mutate(false);
  };

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  isEnabled ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"
                }`}
              >
                <Zap className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium">Motor de Distribuição</h3>
                  {isEnabled ? (
                    <Badge className="bg-green-600 hover:bg-green-600">Ativo</Badge>
                  ) : (
                    <Badge variant="secondary">Desligado</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {isEnabled
                    ? "Atendimentos sendo distribuídos automaticamente pelas regras abaixo."
                    : "Quando ativo, atendimentos são distribuídos automaticamente pelas regras abaixo."}
                </p>
              </div>
            </div>

            {isEnabled ? (
              <Button
                variant="destructive"
                onClick={handlePause}
                disabled={isMutating}
                className="shrink-0"
              >
                <Pause className="mr-2 h-4 w-4" />
                {isMutating ? "Pausando..." : "Pausar"}
              </Button>
            ) : (
              <Button
                onClick={() => setShowConfirm(true)}
                disabled={isMutating}
                className="shrink-0 bg-green-600 hover:bg-green-700 text-white"
              >
                <Zap className="mr-2 h-4 w-4" />
                {isMutating ? "Ativando..." : "Ativar"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar motor de distribuição?</AlertDialogTitle>
            <AlertDialogDescription>
              A partir da ativação, os atendimentos começarão a ser distribuídos
              automaticamente aos agentes conforme as regras configuradas abaixo.
              Você pode pausar a qualquer momento clicando no botão "Pausar".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmActivate}>
              Ativar motor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
