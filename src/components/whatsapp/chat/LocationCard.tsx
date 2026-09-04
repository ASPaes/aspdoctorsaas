import { useEffect, useState } from "react";
import { MapPin, ExternalLink, Copy, Check, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCoords, googleMapsUrl, type MessageLocation } from "@/utils/whatsapp/location";

interface LocationCardProps {
  location: MessageLocation;
  isFromMe: boolean;
}

export function LocationCard({ location, isFromMe }: LocationCardProps) {
  const [copiado, setCopiado] = useState(false);
  const coords = formatCoords(location);
  const url = googleMapsUrl(location);
  const titulo = location.name || (location.live ? "Localização em tempo real" : "Localização");

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1500);
    return () => clearTimeout(t);
  }, [copiado]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(coords);
      setCopiado(true);
    } catch {
      /* navegador sem permissão de área de transferência: o link continua valendo */
    }
  };

  return (
    <div className={cn(
      "rounded-md border overflow-hidden mb-1 min-w-[220px] max-w-[300px]",
      isFromMe
        ? "bg-primary-foreground/10 border-primary-foreground/20"
        : "bg-background/50 border-border/50"
    )}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex items-start gap-2.5 p-3 transition-colors",
          isFromMe ? "hover:bg-primary-foreground/10" : "hover:bg-accent/50"
        )}
      >
        <div className={cn(
          "h-10 w-10 rounded-full flex items-center justify-center shrink-0",
          isFromMe ? "bg-primary-foreground/20" : "bg-muted"
        )}>
          <MapPin className={cn("h-5 w-5", isFromMe ? "text-primary-foreground/70" : "text-muted-foreground")} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn(
            "text-sm font-medium truncate",
            isFromMe ? "text-primary-foreground" : "text-foreground"
          )}>
            {titulo}
          </p>
          {location.address && (
            <p className={cn(
              "text-[11px] leading-snug opacity-80 break-words",
              isFromMe ? "text-primary-foreground" : "text-muted-foreground"
            )}>
              {location.address}
            </p>
          )}
          <p className={cn(
            "text-[11px] opacity-70 tabular-nums",
            isFromMe ? "text-primary-foreground" : "text-muted-foreground"
          )}>
            {coords}
          </p>
          {location.live && (
            <span className={cn(
              "inline-flex items-center gap-1 mt-1 text-[10px] font-medium opacity-80",
              isFromMe ? "text-primary-foreground" : "text-muted-foreground"
            )}>
              <Radio className="h-3 w-3" />
              Enviada em tempo real
            </span>
          )}
        </div>
      </a>

      <div className={cn(
        "flex items-stretch border-t text-xs",
        isFromMe ? "border-primary-foreground/20" : "border-border/50"
      )}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex-1 flex items-center justify-center gap-1 h-7 font-medium transition-colors",
            isFromMe
              ? "text-primary-foreground hover:bg-primary-foreground/10"
              : "text-foreground hover:bg-accent"
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Abrir no mapa
        </a>
        <button
          type="button"
          onClick={copiar}
          aria-label="Copiar coordenadas"
          className={cn(
            "flex-1 flex items-center justify-center gap-1 h-7 font-medium border-l transition-colors",
            isFromMe
              ? "border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10"
              : "border-border/50 text-foreground hover:bg-accent"
          )}
        >
          {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
