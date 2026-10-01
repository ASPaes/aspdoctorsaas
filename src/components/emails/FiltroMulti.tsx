import { useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** a partir daqui a lista ganha campo de busca; com poucas opções ele só atrapalha */
const MINIMO_PARA_BUSCA = 6;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Filtro de marcar vários, no mesmo formato dos seletores da aba de e-mail.
 * Some com o contador quando nada está marcado, para a barra não ficar suja.
 *
 * Caixa marcável sempre visível e e-mail inteiro na linha de baixo (pedido de
 * 30/09/2026): com o "✓" invisível até o clique ninguém percebia que dava para
 * marcar mais de uma, e o endereço cortado na mesma linha do nome não dizia
 * qual caixa era.
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
  /** `cor` desenha a bolinha da caixa na frente do nome (DEM-0497) */
  opcoes: { id: string; label: string; detalhe?: string; cor?: string | null }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [busca, setBusca] = useState("");
  const alternar = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const termo = semAcento(busca.trim());
  const visiveis = termo
    ? opcoes.filter((o) => semAcento(`${o.label} ${o.detalhe ?? ""}`).includes(termo))
    : opcoes;
  const todasVisiveisMarcadas = visiveis.length > 0 && visiveis.every((o) => value.includes(o.id));
  const marcarVisiveis = () => {
    const ids = visiveis.map((o) => o.id);
    onChange(todasVisiveisMarcadas ? value.filter((v) => !ids.includes(v)) : [...new Set([...value, ...ids])]);
  };

  return (
    <Popover onOpenChange={(aberto) => !aberto && setBusca("")}>
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
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-1"
        onWheel={(e) => e.stopPropagation()}
      >
        {opcoes.length >= MINIMO_PARA_BUSCA && (
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={`Buscar ${rotulo.toLowerCase()}...`}
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        )}
        <div className="max-h-[320px] overflow-y-auto overscroll-contain">
          {visiveis.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {opcoes.length === 0 ? "Nada para filtrar." : "Nada encontrado."}
            </p>
          ) : (
            visiveis.map((o) => {
              const marcada = value.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="checkbox"
                  aria-checked={marcada}
                  onClick={() => alternar(o.id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted",
                    marcada && "bg-accent/10",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                      marcada ? "border-accent bg-accent text-white" : "border-muted-foreground/50",
                    )}
                    aria-hidden
                  >
                    {marcada && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {o.cor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.cor }} aria-hidden />}
                      <span className="truncate">{o.label}</span>
                    </span>
                    {o.detalhe && (
                      <span className="block break-all text-xs text-muted-foreground" title={o.detalhe}>
                        {o.detalhe}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {(opcoes.length >= MINIMO_PARA_BUSCA || value.length > 0) && (
          <div className="mt-1 flex items-center justify-between border-t border-border px-1 pt-1">
            {opcoes.length >= MINIMO_PARA_BUSCA && visiveis.length > 0 ? (
              <button
                type="button"
                onClick={marcarVisiveis}
                className="rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              >
                {todasVisiveisMarcadas ? "Desmarcar" : "Marcar"} {termo ? "encontradas" : "todas"}
              </button>
            ) : (
              <span />
            )}
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              >
                Limpar seleção ({value.length})
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
