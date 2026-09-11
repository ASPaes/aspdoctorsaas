import { Ban, ExternalLink, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EmailProviderPreset, PassoGuia } from "./emailProviders";

/**
 * Passo a passo de cada provedor, com os links que levam direto à tela certa.
 * Mesmo conteúdo no cadastro e no "Como resolver" da lista: a pessoa tem que
 * conseguir sozinha, sem abrir chamado.
 */

function ListaPassos({ passos }: { passos: PassoGuia[] }) {
  return (
    <ol className="space-y-2.5">
      {passos.map((passo, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary tabular-nums">
            {i + 1}
          </span>
          <div className="min-w-0 space-y-1 text-sm leading-snug">
            <p>{passo.texto}</p>
            {passo.link && (
              <a
                href={passo.link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                {passo.link.rotulo}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function GuiaProvedor({ preset, className }: { preset: EmailProviderPreset; className?: string }) {
  const { guia } = preset;

  return (
    <div className={cn("space-y-4", className)}>
      {guia.bloqueio && (
        <div className="flex gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>{guia.bloqueio}</p>
        </div>
      )}

      <p className="text-sm text-muted-foreground">{guia.resumo}</p>

      <ListaPassos passos={guia.passos} />

      {guia.seNaoAparecer && (
        <div className="space-y-2.5 rounded-md border bg-muted/40 px-3 py-3">
          <p className="text-sm font-medium">{guia.seNaoAparecer.titulo}</p>
          <ListaPassos passos={guia.seNaoAparecer.passos} />
        </div>
      )}

      {guia.observacoes && guia.observacoes.length > 0 && (
        <ul className="space-y-1.5">
          {guia.observacoes.map((obs, i) => (
            <li key={i} className="flex gap-2 text-xs text-muted-foreground">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{obs}</span>
            </li>
          ))}
        </ul>
      )}

      {guia.ajuda && (
        <a
          href={guia.ajuda.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {guia.ajuda.rotulo}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
