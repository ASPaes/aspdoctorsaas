import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

/**
 * Seleção de vários setores, no mesmo formato visual do AgentMultiSelect para
 * os dois campos lado a lado no cadastro da conta de e-mail parecerem um só.
 */
export function SetoresMultiSelect({
  setores,
  value,
  onChange,
}: {
  setores: { id: string; name: string }[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const selecionados = setores.filter((s) => value.includes(s.id));

  const alternar = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-[40px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {selecionados.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {selecionados.map((s) => (
                <Badge key={s.id} variant="secondary" className="text-xs">
                  {s.name}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">Selecionar setores...</span>
          )}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        sideOffset={4}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="max-h-[300px] overflow-y-auto overscroll-contain p-1" onWheel={(e) => e.stopPropagation()}>
          {setores.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Nenhum setor ativo cadastrado.</div>
          ) : (
            setores.map((s) => {
              const marcado = value.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => alternar(s.id)}
                  className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-highlight hover:text-highlight-foreground hover:[--muted-foreground:var(--highlight-muted-foreground)] focus:bg-highlight focus:text-highlight-foreground focus:[--muted-foreground:var(--highlight-muted-foreground)]"
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <Check className={cn("h-4 w-4", marcado ? "opacity-100" : "opacity-0")} />
                  </span>
                  <span className="truncate font-medium">{s.name}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
