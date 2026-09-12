import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Filtro de marcar vários, no mesmo formato dos seletores da aba de e-mail.
 * Some com o contador quando nada está marcado, para a barra não ficar suja.
 */
export function FiltroMulti({
  rotulo,
  icone,
  opcoes,
  value,
  onChange,
}: {
  rotulo: string;
  icone?: React.ReactNode;
  opcoes: { id: string; label: string; detalhe?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const alternar = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 items-center gap-2 rounded-md border px-3 text-sm",
            value.length > 0 ? "border-accent bg-accent/5" : "border-input bg-background",
          )}
        >
          {icone}
          {rotulo}
          {value.length > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold text-accent">
              {value.length}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1" onWheel={(e) => e.stopPropagation()}>
        <div className="max-h-[300px] overflow-y-auto overscroll-contain">
          {opcoes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nada para filtrar.</p>
          ) : (
            opcoes.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => alternar(o.id)}
                className="relative flex w-full items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <Check className={cn("h-4 w-4", value.includes(o.id) ? "opacity-100" : "opacity-0")} />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {o.label}
                  {o.detalhe && <span className="ml-1 text-xs text-muted-foreground">{o.detalhe}</span>}
                </span>
              </button>
            ))
          )}
        </div>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 w-full rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            Limpar seleção
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
