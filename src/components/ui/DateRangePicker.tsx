import { useEffect, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { startOfMonth, endOfMonth, startOfDay, endOfDay, subDays, subMonths } from "date-fns";
import { CalendarDays } from "lucide-react";
import "react-day-picker/dist/style.css";

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  dateRange: { from: Date; to: Date };
  onDateRangeChange: (range: { from: Date; to: Date }) => void;
  align?: "start" | "center" | "end";
  className?: string;
}

function formatBRDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function parseBRDate(str: string): Date | null {
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function formatShort(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type Shortcut = {
  label: string;
  getRange: () => { from: Date; to: Date };
};

const shortcuts: Shortcut[] = [
  {
    label: "Hoje",
    getRange: () => {
      const today = new Date();
      return { from: today, to: today };
    },
  },
  {
    label: "Últimos 7 dias",
    getRange: () => {
      const today = new Date();
      return { from: subDays(today, 6), to: today };
    },
  },
  {
    label: "Este mês",
    getRange: () => {
      const today = new Date();
      return { from: startOfMonth(today), to: today };
    },
  },
  {
    label: "Mês passado",
    getRange: () => {
      const prev = subMonths(new Date(), 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    },
  },
];

function DateRangePicker({
  dateRange,
  onDateRangeChange,
  align = "start",
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [tempRange, setTempRange] = useState<{ from: Date; to: Date }>(dateRange);
  const [fromInput, setFromInput] = useState(formatBRDate(dateRange.from));
  const [toInput, setToInput] = useState(formatBRDate(dateRange.to));

  useEffect(() => {
    if (open) {
      setTempRange(dateRange);
      setFromInput(formatBRDate(dateRange.from));
      setToInput(formatBRDate(dateRange.to));
    }
  }, [open, dateRange]);

  const handleShortcut = (sc: Shortcut) => {
    const range = sc.getRange();
    onDateRangeChange(range);
    setOpen(false);
  };

  const handleApply = () => {
    onDateRangeChange(tempRange);
    setOpen(false);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const handleSelect = (range: DateRange | undefined) => {
    if (!range) return;
    const from = range.from ?? tempRange.from;
    const to = range.to ?? range.from ?? tempRange.to;
    const next = { from, to };
    setTempRange(next);
    setFromInput(formatBRDate(from));
    setToInput(formatBRDate(to));
  };

  const handleFromBlur = () => {
    const parsed = parseBRDate(fromInput);
    if (parsed) {
      setTempRange((prev) => ({ ...prev, from: parsed }));
    } else {
      setFromInput(formatBRDate(tempRange.from));
    }
  };

  const handleToBlur = () => {
    const parsed = parseBRDate(toInput);
    if (parsed) {
      setTempRange((prev) => ({ ...prev, to: parsed }));
    } else {
      setToInput(formatBRDate(tempRange.to));
    }
  };

  const isShortcutActive = (sc: Shortcut): boolean => {
    const r = sc.getRange();
    return isSameDay(r.from, dateRange.from) && isSameDay(r.to, dateRange.to);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-accent transition-colors",
            className,
          )}
          style={{ fontSize: 12, padding: "5px 12px" }}
        >
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span>
            {formatShort(dateRange.from)} – {formatShort(dateRange.to)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-4 bg-popover" sideOffset={4}>
        <div className="flex flex-row gap-12">
          {/* Atalhos */}
          <div className="flex flex-col gap-1 min-w-[140px]">
            <p className="text-[10px] font-medium uppercase text-muted-foreground mb-1 tracking-wider">
              Atalhos
            </p>
            {shortcuts.map((sc) => {
              const active = isShortcutActive(sc);
              return (
                <button
                  key={sc.label}
                  type="button"
                  onClick={() => handleShortcut(sc)}
                  className={cn(
                    "text-left px-3 py-1.5 text-sm rounded-md transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent text-foreground",
                  )}
                >
                  {sc.label}
                </button>
              );
            })}
          </div>

          {/* Calendário */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                De
                <input
                  type="text"
                  value={fromInput}
                  onChange={(e) => setFromInput(e.target.value)}
                  onBlur={handleFromBlur}
                  placeholder="dd/mm/aaaa"
                  className="w-[100px] text-xs h-7 px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                até
                <input
                  type="text"
                  value={toInput}
                  onChange={(e) => setToInput(e.target.value)}
                  onBlur={handleToBlur}
                  placeholder="dd/mm/aaaa"
                  className="w-[100px] text-xs h-7 px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
            </div>

            <DayPicker
              mode="range"
              numberOfMonths={2}
              locale={ptBR}
              showOutsideDays
              selected={{ from: tempRange.from, to: tempRange.to }}
              onSelect={handleSelect}
              disabled={{ after: new Date() }}
              className="pointer-events-auto"
            />

            <div className="flex justify-end gap-2 border-t border-border pt-2">
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1.5 text-xs rounded-md border border-border bg-card text-foreground hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DateRangePicker };
export type { DateRangePickerProps };
