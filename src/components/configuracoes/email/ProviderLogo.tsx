import { Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { providerByValue } from "./emailProviders";
import gmail from "@/assets/email-providers/gmail.png";
import outlook from "@/assets/email-providers/outlook.svg";
import yahoo from "@/assets/email-providers/yahoo.png";
import zoho from "@/assets/email-providers/zoho.png";
import locaweb from "@/assets/email-providers/locaweb.png";
import hostinger from "@/assets/email-providers/hostinger.svg";
import uolhost from "@/assets/email-providers/uolhost.png";

/**
 * Logo do provedor de e-mail, num quadro branco para ler igual nos dois temas.
 *
 * Origem dos arquivos (src/assets/email-providers), conferida em 10/09/2026:
 *   - gmail, outlook: ícones oficiais do Google (gstatic) e da Microsoft (Fluent).
 *   - yahoo, zoho, locaweb, uolhost: ícone publicado pelo próprio site.
 *   - hostinger: Simple Icons 16.30.0 (CC0), na cor da marca.
 * Outlook e Yahoo não estão no Simple Icons: as duas marcas pediram remoção.
 */
const LOGOS: Record<string, string> = { gmail, outlook, yahoo, zoho, locaweb, hostinger, uolhost };

/** logos que já são um quadro colorido inteiro: ocupam o quadro todo */
const PREENCHE = new Set<string>(["yahoo"]);

const TAMANHOS = {
  sm: "h-7 w-7 rounded-[7px]",
  md: "h-9 w-9 rounded-[9px]",
};

export function ProviderLogo({
  value,
  size = "md",
  className,
}: {
  value: string;
  size?: keyof typeof TAMANHOS;
  className?: string;
}) {
  const provedor = providerByValue(value);
  const src = LOGOS[provedor.value];
  const cheio = PREENCHE.has(provedor.value);

  return (
    <span
      title={provedor.label}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden border border-border/60 bg-white",
        TAMANHOS[size],
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={provedor.label}
          draggable={false}
          className={cn("object-contain", cheio ? "h-full w-full" : "h-[64%] w-[64%]")}
        />
      ) : (
        <Server className="h-1/2 w-1/2 text-slate-500" aria-label={provedor.label} />
      )}
    </span>
  );
}
