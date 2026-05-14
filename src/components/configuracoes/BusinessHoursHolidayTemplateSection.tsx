import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Plus, X, Loader2 } from "lucide-react";

interface Template {
  tenant_id: string;
  open_at: string | null;
  close_at: string | null;
  break_start: string | null;
  break_end: string | null;
  has_break: boolean;
}

export default function BusinessHoursHolidayTemplateSection() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [openAt, setOpenAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [hasBreak, setHasBreak] = useState(false);
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");
  const [expanded, setExpanded] = useState(false);

  const { data: template, isLoading } = useQuery<Template | null>({
    queryKey: ["tenant-holiday-template", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("tenant_holiday_template" as any) as any)
        .select("*")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return data as Template | null;
    },
  });

  const hasHorario = !!(template?.open_at && template?.close_at);

  useEffect(() => {
    if (template) {
      setOpenAt(template.open_at?.slice(0, 5) ?? "");
      setCloseAt(template.close_at?.slice(0, 5) ?? "");
      setHasBreak(template.has_break);
      setBreakStart(template.break_start?.slice(0, 5) ?? "");
      setBreakEnd(template.break_end?.slice(0, 5) ?? "");
      // Expande automaticamente se já existe horário salvo
      if (template.open_at && template.close_at) {
        setExpanded(true);
      }
    }
  }, [template]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tid) throw new Error("tenant_id ausente");
      if (!openAt || !closeAt) throw new Error("Preencha abertura e fechamento.");
      if (openAt >= closeAt) throw new Error("Abertura deve ser antes do fechamento.");
      if (hasBreak) {
        if (!breakStart || !breakEnd) throw new Error("Preencha os horários do intervalo.");
        if (breakStart >= breakEnd) throw new Error("Início do intervalo deve ser antes do fim.");
        if (breakStart <= openAt || breakEnd >= closeAt) throw new Error("Intervalo deve estar dentro do horário de funcionamento.");
      }

      const payload: any = {
        tenant_id: tid,
        open_at: openAt,
        close_at: closeAt,
        has_break: hasBreak,
        break_start: hasBreak ? breakStart : null,
        break_end: hasBreak ? breakEnd : null,
      };
      const { error } = await (supabase.from("tenant_holiday_template" as any) as any)
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-holiday-template", tid] });
      toast({ title: "Horário em feriados salvo!" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const handleRadioClick = () => {
    setExpanded(!expanded);
  };

  return (
    <div className="rounded-lg border bg-emerald-500/[0.03] border-emerald-500/20 p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleRadioClick}
          className="flex items-center gap-2 flex-wrap hover:opacity-80 transition-opacity"
        >
          <div className={`w-4 h-4 rounded-full ${hasHorario && expanded ? "bg-primary" : "border-2 border-primary"} flex items-center justify-center shrink-0`}>
            {hasHorario && expanded && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
          </div>
          <span className="font-medium text-sm">Horário em feriados</span>
          {expanded && (
            <span className="text-[11px] text-muted-foreground">
              Aplicado apenas a feriados marcados como "horário reduzido" na lista abaixo.
            </span>
          )}
        </button>

        {expanded && !hasBreak && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => { setHasBreak(true); setBreakStart("12:00"); setBreakEnd("13:00"); }}
          >
            <Plus className="h-3 w-3 mr-1" />
            Intervalo
          </Button>
        )}
      </div>

      {expanded && (
        isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2 pl-6 mt-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-14 shrink-0">Turno 1</span>
              <Input type="time" value={openAt} onChange={(e) => setOpenAt(e.target.value)} className="h-8 w-28" />
              <span className="text-xs text-muted-foreground">às</span>
              <Input type="time" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} className="h-8 w-28" />
            </div>

            {hasBreak && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-14 shrink-0">Pausa</span>
                <Input type="time" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} className="h-8 w-28" />
                <span className="text-xs text-muted-foreground">às</span>
                <Input type="time" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)} className="h-8 w-28" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive"
                  onClick={() => { setHasBreak(false); setBreakStart(""); setBreakEnd(""); }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Salvar
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
