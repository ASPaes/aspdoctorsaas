import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

export interface FilterOption {
  id: number;
  nome: string;
}

interface MultiSelectFilterProps {
  label: string;
  options: FilterOption[];
  selected: number[];
  onChange: (ids: number[]) => void;
  className?: string;
}

export function MultiSelectFilter({ label, options, selected, onChange, className }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);

  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  const count = selected.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between gap-2 min-w-[180px]", className)}
        >
          <span className="truncate">{label}</span>
          {count > 0 ? (
            <Badge variant="secondary" className="ml-1 shrink-0">
              {count}
            </Badge>
          ) : (
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Buscar ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>Nenhum encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isSel = selected.includes(opt.id);
                return (
                  <CommandItem
                    key={opt.id}
                    value={opt.nome}
                    onSelect={() => toggle(opt.id)}
                    className="cursor-pointer"
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        isSel ? "bg-primary text-primary-foreground" : "opacity-50"
                      )}
                    >
                      {isSel && <Check className="h-3 w-3" />}
                    </div>
                    <span className="truncate">{opt.nome}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {count > 0 && (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center"
                onClick={() => onChange([])}
              >
                Limpar ({count})
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
