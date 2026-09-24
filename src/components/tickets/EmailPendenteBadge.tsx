import { Mail } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Retorno de cliente pendente (DEM-0461, 23/09/2026).
 *
 * O cliente respondeu por e-mail dentro do chamado e ninguém abriu ainda. Some
 * sozinho quando alguém abre o chamado: o texto do e-mail aparece inteiro na
 * linha do tempo, então abrir o chamado já é ler.
 */
export function EmailPendenteBadge({ quantidade }: { quantidade: number }) {
  if (quantidade <= 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          /* mr-2: o número é absoluto e encostava na data do card sem esta folga */
          className="relative mr-2 inline-flex shrink-0 text-accent"
          aria-label="Retorno de cliente pendente"
        >
          <Mail className="h-3.5 w-3.5" />
          <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-white">
            {quantidade > 9 ? "9+" : quantidade}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        Retorno de cliente pendente: {quantidade} e-mail{quantidade > 1 ? "s" : ""} sem leitura
      </TooltipContent>
    </Tooltip>
  );
}
