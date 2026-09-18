import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

export interface OpcaoMulti {
  id: string;
  label: string;
  detalhe?: string | null;
  /** Preenchido = não pode ser escolhida (ex.: já está em outra regra). */
  bloqueio?: string | null;
}

/**
 * Mesmo visual do SetoresMultiSelect, mais o motivo de uma opção estar travada:
 * setor e pessoa só podem estar em uma regra de horário.
 */
export function OpcoesMultiSelect({
  id,
  opcoes,
  value,
  onChange,
  placeholder,
  vazio,
  chipClassName,
}: {
  id?: string;
  opcoes: OpcaoMulti[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  vazio: string;
  chipClassName?: string;
}) {
  const selecionadas = opcoes.filter((o) => value.includes(o.id));
  const alternar = (oid: string) =>
    onChange(value.includes(oid) ? value.filter((v) => v !== oid) : [...value, oid]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className="flex min-h-[40px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {selecionadas.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {selecionadas.map((o) => (
                <Badge key={o.id} variant="secondary" className={cn("gap-1 text-xs", chipClassName)}>
                  {o.label}
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remover ${o.label}`}
                    className="opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      alternar(o.id);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
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
          {opcoes.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{vazio}</div>
          ) : (
            opcoes.map((o) => {
              const marcada = value.includes(o.id);
              const travada = !!o.bloqueio && !marcada;
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={travada}
                  onClick={() => alternar(o.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    travada ? "cursor-not-allowed opacity-50" : "hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary",
                      marcada ? "bg-primary text-primary-foreground" : "opacity-50",
                    )}
                  >
                    {marcada && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{travada ? o.bloqueio : o.detalhe}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
