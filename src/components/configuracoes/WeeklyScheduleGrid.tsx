import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Plus, CopyPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────
export interface TimeSlot {
  start: string;
  end: string;
}

export interface DaySchedule {
  active: boolean;
  slots: TimeSlot[];
}

export type BusinessHours = Record<string, DaySchedule>;

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DAY_LABELS: Record<string, string> = {
  mon: "Segunda", tue: "Terça", wed: "Quarta", thu: "Quinta",
  fri: "Sexta", sat: "Sábado", sun: "Domingo",
};

export const DEFAULT_SLOT: TimeSlot = { start: "08:00", end: "18:00" };
export const DEFAULT_DAY: DaySchedule = { active: false, slots: [{ ...DEFAULT_SLOT }] };

// ─── Helpers ─────────────────────────────────────────────────────
/** Parse business_hours JSON with backward compat for old {start,end,active} format */
export function parseBusinessHours(raw: unknown): BusinessHours {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const result: BusinessHours = {};
  for (const key of DAY_KEYS) {
    const day = obj[key];
    if (day && typeof day === "object") {
      const d = day as Record<string, unknown>;
      const active = !!d.active;
      // New format with slots array
      if (Array.isArray(d.slots) && d.slots.length > 0) {
        const slots = (d.slots as Record<string, unknown>[]).map((s) => ({
          start: typeof s.start === "string" ? s.start : "08:00",
          end: typeof s.end === "string" ? s.end : "18:00",
        }));
        result[key] = { active, slots };
      } else if (typeof d.start === "string" && typeof d.end === "string") {
        // Backward compat: old {start, end, active} format → convert to slots
        result[key] = { active, slots: [{ start: d.start, end: d.end }] };
      } else {
        result[key] = { active, slots: [{ ...DEFAULT_SLOT }] };
      }
    } else {
      result[key] = { active: false, slots: [{ ...DEFAULT_SLOT }] };
    }
  }
  return result;
}

export function validateSchedule(schedule: BusinessHours): string | null {
  for (const day of DAY_KEYS) {
    const d = schedule[day];
    if (!d || !d.active) continue;
    for (let i = 0; i < d.slots.length; i++) {
      const s = d.slots[i];
      if (s.start && s.end && s.start >= s.end) {
        return `${DAY_LABELS[day]}, Turno ${i + 1}: início deve ser antes do fim.`;
      }
    }
    if (d.slots.length === 2) {
      const [a, b] = d.slots;
      if (a.end && b.start && a.end > b.start) {
        return `${DAY_LABELS[day]}: turnos se sobrepõem (Turno 1 termina ${a.end}, Turno 2 inicia ${b.start}).`;
      }
    }
  }
  return null;
}

export function cleanSchedule(schedule: BusinessHours): BusinessHours {
  const out: BusinessHours = {};
  for (const day of DAY_KEYS) {
    const d = schedule[day] ?? { active: false, slots: [{ ...DEFAULT_SLOT }] };
    const valid = d.slots.filter((s) => s.start && s.end);
    out[day] = { active: d.active, slots: valid.length > 0 ? valid : [{ ...DEFAULT_SLOT }] };
  }
  return out;
}

/**
 * Copia os turnos de um dia para todos os outros dias da semana.
 * NÃO mexe no ativo/inativo: dia desmarcado recebe os horários e continua desmarcado —
 * assim quem ligar o sábado depois já encontra o horário certo, e nada é ativado sozinho.
 */
export function replicateDay(schedule: BusinessHours, sourceDay: string): BusinessHours {
  const source = schedule[sourceDay];
  if (!source) return schedule;
  const out: BusinessHours = {};
  for (const day of DAY_KEYS) {
    const d = schedule[day] ?? { active: false, slots: [{ ...DEFAULT_SLOT }] };
    out[day] = day === sourceDay
      ? d
      : { active: d.active, slots: source.slots.map((s) => ({ ...s })) };
  }
  return out;
}

// ─── Component ───────────────────────────────────────────────────
export function WeeklyScheduleGrid({
  value,
  onChange,
  idPrefix,
}: {
  value: BusinessHours;
  onChange: (next: BusinessHours) => void;
  idPrefix: string;
}) {
  const { toast } = useToast();

  const updateDayActive = (day: string, active: boolean) => {
    onChange({
      ...value,
      [day]: { ...value[day], active },
    });
  };

  const updateSlot = (day: string, slotIndex: number, field: keyof TimeSlot, val: string) => {
    const dayData = value[day];
    const newSlots = [...dayData.slots];
    newSlots[slotIndex] = { ...newSlots[slotIndex], [field]: val };
    onChange({ ...value, [day]: { ...dayData, slots: newSlots } });
  };

  const addSlot = (day: string) => {
    const dayData = value[day];
    if (dayData.slots.length >= 2) return; // Max 2 slots
    onChange({ ...value, [day]: { ...dayData, slots: [...dayData.slots, { start: "13:00", end: "18:00" }] } });
  };

  const removeSlot = (day: string, slotIndex: number) => {
    const dayData = value[day];
    if (dayData.slots.length <= 1) return; // Keep at least 1
    const newSlots = dayData.slots.filter((_, i) => i !== slotIndex);
    onChange({ ...value, [day]: { ...dayData, slots: newSlots } });
  };

  const replicate = (day: string) => {
    onChange(replicateDay(value, day));
    toast({
      title: `${DAY_LABELS[day]} replicada`,
      description: "Os horários foram copiados para os outros dias. Os dias desmarcados continuam desmarcados.",
    });
  };

  return (
    <div className="rounded-lg border divide-y">
      {DAY_KEYS.map((day) => {
        const s = value[day];
        return (
          <div key={day} className="px-3 py-2 space-y-1">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={s.active}
                onCheckedChange={(v) => updateDayActive(day, !!v)}
                id={`${idPrefix}-${day}`}
              />
              <Label htmlFor={`${idPrefix}-${day}`} className="w-20 text-sm font-medium">
                {DAY_LABELS[day]}
              </Label>
              {s.active && (
                <div className="ml-auto flex items-center gap-1">
                  {s.slots.length < 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => addSlot(day)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Intervalo
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => replicate(day)}
                    title={`Copiar os horários de ${DAY_LABELS[day]} para os outros dias`}
                  >
                    <CopyPlus className="h-3 w-3 mr-1" />
                    Replicar
                  </Button>
                </div>
              )}
            </div>
            {s.active && s.slots.map((slot, idx) => (
              <div key={idx} className="flex items-center gap-2 ml-8">
                <span className="text-xs text-muted-foreground w-14 shrink-0">
                  Turno {idx + 1}
                </span>
                <Input
                  type="time"
                  value={slot.start}
                  onChange={(e) => updateSlot(day, idx, "start", e.target.value)}
                  className="w-28"
                />
                <span className="text-muted-foreground text-sm">às</span>
                <Input
                  type="time"
                  value={slot.end}
                  onChange={(e) => updateSlot(day, idx, "end", e.target.value)}
                  className="w-28"
                />
                {s.slots.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => removeSlot(day, idx)}
                    title="Remover turno"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
