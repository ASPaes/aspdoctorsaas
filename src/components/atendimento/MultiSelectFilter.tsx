import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

export interface FilterOption<T extends string | number = string | number> {
  id: T;
  nome: string;
  /**
   * Cabeçalho do grupo. Opcional: sem ele a lista sai plana, como sempre foi.
   * Com ele, também entra na chave de busca do cmdk, que ignora maiúscula e
   * faria "PDV" e "Pdv" (categorias de produtos diferentes) virarem o mesmo item.
   */
  grupo?: string;
}

interface MultiSelectFilterProps<T extends string | number> {
  label: string;
  options: FilterOption<T>[];
  selected: T[];
  onChange: (ids: T[]) => void;
  className?: string;
  /** Placeholder da busca. Default: `Buscar {label}...` — útil quando o label é dinâmico ("3 selecionado(s)"). */
  searchPlaceholder?: string;
}

export function MultiSelectFilter<T extends string | number>({ label, options, selected, onChange, className, searchPlaceholder }: MultiSelectFilterProps<T>) {
  const [open, setOpen] = useState(false);

  const toggle = (id: T) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  const count = selected.length;

  const grupos: { nome: string | undefined; itens: FilterOption<T>[] }[] = [];
  for (const opt of options) {
    const g = grupos.find((x) => x.nome === opt.grupo);
    if (g) g.itens.push(opt);
    else grupos.push({ nome: opt.grupo, itens: [opt] });
  }

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
          <CommandInput placeholder={searchPlaceholder ?? `Buscar ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>Nenhum encontrado.</CommandEmpty>
            {grupos.map((g) => (
            <CommandGroup key={g.nome ?? "__sem_grupo__"} heading={g.nome}>
              {g.itens.map((opt) => {
                const isSel = selected.includes(opt.id);
                return (
                  <CommandItem
                    key={opt.id}
                    value={opt.grupo ? `${opt.nome} ${opt.grupo} ${opt.id}` : opt.nome}
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
            ))}
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
