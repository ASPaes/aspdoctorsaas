import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarClock, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentScheduledUntil: string | null;
  isScheduling: boolean;
  isUnscheduling: boolean;
  onConfirmSchedule: (scheduledUntilIso: string) => void;
  onConfirmUnschedule: () => void;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string): Date {
  return new Date(value);
}

const MAX_DAYS = 60;

export function ScheduleAttendanceDialog({
  open,
  onOpenChange,
  currentScheduledUntil,
  isScheduling,
  isUnscheduling,
  onConfirmSchedule,
  onConfirmUnschedule,
}: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!currentScheduledUntil && new Date(currentScheduledUntil) > new Date();

  useEffect(() => {
    if (open) {
      const initial = isEditing
        ? new Date(currentScheduledUntil!)
        : (() => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            d.setHours(9, 0, 0, 0);
            return d;
          })();
      setValue(toLocalInputValue(initial));
      setError(null);
    }
  }, [open, currentScheduledUntil, isEditing]);

  const presets = [
    {
      label: "+2h",
      compute: () => {
        const d = new Date();
        d.setHours(d.getHours() + 2);
        return d;
      },
    },
    {
      label: "+4h",
      compute: () => {
        const d = new Date();
        d.setHours(d.getHours() + 4);
        return d;
      },
    },
    {
      label: "Amanhã 9h",
      compute: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
    {
      label: "Próx. seg 9h",
      compute: () => {
        const d = new Date();
        const dow = d.getDay();
        const daysToMon = ((1 - dow + 7) % 7) || 7;
        d.setDate(d.getDate() + daysToMon);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
  ];

  const applyPreset = (compute: () => Date) => {
    setValue(toLocalInputValue(compute()));
    setError(null);
  };

  const handleConfirm = () => {
    if (!value) {
      setError("Selecione uma data e horário");
      return;
    }
    const date = fromLocalInputValue(value);
    if (isNaN(date.getTime())) {
      setError("Data inválida");
      return;
    }
    if (date <= new Date()) {
      setError("A data precisa ser futura");
      return;
    }
    const max = new Date();
    max.setDate(max.getDate() + MAX_DAYS);
    if (date > max) {
      setError(`Máximo ${MAX_DAYS} dias`);
      return;
    }
    onConfirmSchedule(date.toISOString());
  };

  const minLocal = toLocalInputValue(new Date(Date.now() + 60_000));
  const maxLocal = (() => {
    const d = new Date();
    d.setDate(d.getDate() + MAX_DAYS);
    return toLocalInputValue(d);
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            {isEditing ? "Editar agendamento" : "Agendar atendimento"}
          </DialogTitle>
          <DialogDescription>
            Enquanto agendado, este chat NÃO encerrará por inatividade e ficará fora dos indicadores de SLA. Ao passar do horário, volta ao normal automaticamente.
          </DialogDescription>
        </DialogHeader>

        {isEditing && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">
              Agendado até{" "}
              <strong className="font-semibold">
                {format(new Date(currentScheduledUntil!), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </strong>
            </span>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="scheduled-until">Retomar em</Label>
            <Input
              id="scheduled-until"
              type="datetime-local"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              min={minLocal}
              max={maxLocal}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {presets.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => applyPreset(p.compute)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isScheduling || isUnscheduling}
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {isEditing && (
              <Button
                variant="outline"
                onClick={onConfirmUnschedule}
                disabled={isScheduling || isUnscheduling}
                className="w-full sm:w-auto"
              >
                <X className="h-4 w-4 mr-2" />
                {isUnscheduling ? "Removendo..." : "Remover"}
              </Button>
            )}
            <Button
              onClick={handleConfirm}
              disabled={isScheduling || isUnscheduling}
              className="w-full sm:w-auto"
            >
              <CalendarClock className="h-4 w-4 mr-2" />
              {isScheduling ? "Agendando..." : isEditing ? "Atualizar" : "Agendar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
