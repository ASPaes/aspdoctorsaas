import { useEffect, useState } from "react";
import { startOfDay, endOfDay, differenceInDays } from "date-fns";
import { Loader2, History, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { supabase } from "@/integrations/supabase/client";

interface Instance {
  id: string;
  instance_name: string;
  display_name: string | null;
}

interface RecoverMessagesDialogProps {
  instance: Instance;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface RecoveryStats {
  found: number;
  existing: number;
  inserted: number;
  skipped_no_conversation: number;
  skipped_group: number;
  skipped_unsupported: number;
  pages_scanned?: number;
}

interface RecoveryRun {
  id: string;
  window_start: string;
  window_end: string;
  status: string;
  stats: RecoveryStats | null;
  created_at: string;
}

export const RecoverMessagesDialog = ({ instance, open, onOpenChange }: RecoverMessagesDialogProps) => {
  const today = new Date();
  const [range, setRange] = useState<{ from: Date; to: Date }>({
    from: startOfDay(today),
    to: endOfDay(today),
  });
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<RecoveryStats | null>(null);
  const [runs, setRuns] = useState<RecoveryRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const windowDays = differenceInDays(range.to, range.from);
  const windowTooLarge = windowDays > 7;

  const fetchRuns = async () => {
    setLoadingRuns(true);
    try {
      const { data, error } = await (supabase.from("whatsapp_recovery_runs" as any) as any)
        .select("*")
        .eq("instance_id", instance.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      setRuns((data as RecoveryRun[]) || []);
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    if (open) {
      setLastResult(null);
      fetchRuns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instance.id]);

  const handleRecover = async () => {
    if (windowTooLarge) return;
    setLoading(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("recover-instance-messages", {
        body: {
          instanceId: instance.id,
          windowStart: range.from.toISOString(),
          windowEnd: range.to.toISOString(),
        },
      });
      if (error) {
        toast.error("Falha ao recuperar mensagens: " + (error.message || "Erro desconhecido"));
        return;
      }
      const result = data as any;
      if (result?.ok) {
        const stats = result.stats as RecoveryStats;
        setLastResult(stats);
        toast.success(`${stats.inserted} mensagens recuperadas`);
        fetchRuns();
      } else {
        toast.error("Falha ao recuperar mensagens: " + (result?.error || "Resposta inesperada"));
      }
    } catch (e: any) {
      toast.error("Falha ao recuperar mensagens: " + (e?.message || "Erro desconhecido"));
    } finally {
      setLoading(false);
    }
  };

  const instanceLabel = instance.display_name || instance.instance_name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reestabelecer mensagens</DialogTitle>
          <DialogDescription>Instância: {instanceLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Recupera mensagens que chegaram ao servidor mas não foram entregues à plataforma
            (ex.: falha de webhook). Mensagens que nunca chegaram ao servidor não podem ser
            recuperadas automaticamente.
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Janela de recuperação</label>
            <DateRangePicker
              dateRange={range}
              onDateRangeChange={(r) => setRange({ from: startOfDay(r.from), to: endOfDay(r.to) })}
              align="start"
            />
            {windowTooLarge && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Janela máxima é de 7 dias. Reduza o intervalo para continuar.
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleRecover} disabled={loading || windowTooLarge}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recuperando...
                </>
              ) : (
                "Recuperar mensagens"
              )}
            </Button>
          </div>

          {lastResult && (
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="font-medium mb-1">Resultado</div>
              <div>Encontradas no servidor: <span className="font-medium">{lastResult.found}</span></div>
              <div>Já existiam: <span className="font-medium">{lastResult.existing}</span></div>
              <div>Recuperadas: <span className="font-medium">{lastResult.inserted}</span></div>
              <div>Sem conversa vinculada: <span className="font-medium">{lastResult.skipped_no_conversation}</span></div>
              <div>Grupos ignorados: <span className="font-medium">{lastResult.skipped_group}</span></div>
              <div>Tipos não suportados: <span className="font-medium">{lastResult.skipped_unsupported}</span></div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4" />
              Execuções anteriores
            </div>
            {loadingRuns ? (
              <div className="text-xs text-muted-foreground">Carregando...</div>
            ) : runs.length === 0 ? (
              <div className="text-xs text-muted-foreground">Nenhuma execução anterior.</div>
            ) : (
              <div className="border rounded-md divide-y">
                {runs.map((run) => (
                  <div key={run.id} className="p-2 text-xs flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {new Date(run.created_at).toLocaleString("pt-BR")}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {new Date(run.window_start).toLocaleString("pt-BR")} → {new Date(run.window_end).toLocaleString("pt-BR")}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-medium">{run.stats?.inserted ?? 0} recuperadas</div>
                      <div className="text-muted-foreground">{run.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
