import * as React from "react";
import { format, subDays, startOfMonth, endOfMonth, startOfYear, startOfQuarter, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DateRange {
  from?: Date;
  to?: Date;
}

interface DateRangePickerProps {
  label: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
  className?: string;
}

const presets: { label: string; range: () => DateRange }[] = [
  { label: "Hoje", range: () => ({ from: new Date(), to: new Date() }) },
  { label: "Últimos 7 dias", range: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: "Últimos 30 dias", range: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: "Este mês", range: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  {
    label: "Mês passado",
    range: () => {
      const prev = subMonths(new Date(), 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    },
  },
  { label: "Este trimestre", range: () => ({ from: startOfQuarter(new Date()), to: new Date() }) },
  { label: "Este ano", range: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

export function DateRangePicker({ label, value, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);

  const hasValue = value?.from || value?.to;

  const handlePreset = (range: DateRange) => {
    onChange(range);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ from: undefined, to: undefined });
  };

  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "w-full justify-start text-left text-xs h-8 pr-1",
              !hasValue && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-1.5 h-3 w-3 shrink-0" />
            <span className="truncate flex-1">
              {value?.from ? (
                value.to ? (
                  `${format(value.from, "dd/MM/yy")} → ${format(value.to, "dd/MM/yy")}`
                ) : (
                  format(value.from, "dd/MM/yy")
                )
              ) : (
                "Selecionar período"
              )}
            </span>
            {hasValue && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                onKeyDown={(e) => e.key === "Enter" && handleClear(e as any)}
                className="ml-1 rounded-sm p-0.5 hover:bg-accent shrink-0"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" side="bottom">
          <div className="flex flex-col sm:flex-row">
            {/* Presets sidebar */}
            <div className="border-b sm:border-b-0 sm:border-r p-2 sm:p-3 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-x-visible sm:min-w-[140px]">
              <p className="hidden sm:block text-xs font-medium text-muted-foreground mb-1">Atalhos</p>
              {presets.map((preset) => (
                <Button
                  key={preset.label}
                  variant="ghost"
                  size="sm"
                  className="justify-start text-xs h-7 whitespace-nowrap shrink-0"
                  onClick={() => handlePreset(preset.range())}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            {/* Calendar */}
            <div className="p-2">
              <Calendar
                mode="range"
                selected={value.from ? { from: value.from, to: value.to } : undefined}
                onSelect={(range) => onChange({ from: range?.from, to: range?.to })}
                numberOfMonths={2}
                locale={ptBR}
                className="pointer-events-auto"
                classNames={{
                  months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
                }}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
