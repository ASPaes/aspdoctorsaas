import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { labelStatus, type GrupoMontado, type IntegracaoId, type IntegracaoStatus } from "@/lib/integracoes";

import logoOmie from "@/assets/integracoes/omie.png";
import logoHiper from "@/assets/integracoes/hiper.png";
import logoPdvLegal from "@/assets/integracoes/pdvlegal.png";
import logoAsaas from "@/assets/integracoes/asaas.png";
import logoAcessoFast from "@/assets/integracoes/acessofast.png";

/**
 * Logomarcas dos parceiros, versionadas no repo. Hotlink para o site deles
 * quebraria a tela silenciosamente quando mudassem o caminho do arquivo.
 */
const LOGOS: Record<IntegracaoId, string> = {
  omie: logoOmie,
  hiper: logoHiper,
  oem: logoPdvLegal,
  asaas: logoAsaas,
  acessofast: logoAcessoFast,
};

/**
 * A pastilha é branca nos dois temas de propósito: o logo do PDV Legal é
 * monocromático preto e sumiria sobre o fundo escuro.
 */
function Logo({ id, nome }: { id: IntegracaoId; nome: string }) {
  return (
    <div className="h-9 w-9 flex-shrink-0 rounded-lg bg-white border border-border/60 grid place-items-center overflow-hidden">
      <img src={LOGOS[id]} alt="" aria-hidden className="max-h-6 max-w-6 object-contain" />
      <span className="sr-only">{nome}</span>
    </div>
  );
}

function StatusPill({ status }: { status: IntegracaoStatus }) {
  const conectado = status.kind === "conectado" || status.kind === "ativo";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium border",
        conectado
          ? "border-transparent bg-success/10 text-success"
          : "border-border text-muted-foreground",
      )}
    >
      {status.kind !== "em-breve" && (
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      )}
      <span className="tabular-nums">{labelStatus(status)}</span>
    </span>
  );
}

interface Props {
  grupos: GrupoMontado[];
  onSelect: (section: string) => void;
}

export function IntegracoesHubView({ grupos, onSelect }: Props) {
  return (
    <div className="space-y-6">
      {grupos.map((grupo) => (
        <section key={grupo.label}>
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            {grupo.label}
          </h3>
          <div className="rounded-lg border overflow-hidden bg-card shadow-sm">
            {grupo.itens.map((item, i) => {
              const conteudo = (
                <>
                  <Logo id={item.id} nome={item.nome} />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-sm font-medium">{item.nome}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{item.descricao}</div>
                  </div>
                  <StatusPill status={item.status} />
                </>
              );

              const classeLinha = cn(
                "w-full flex items-center gap-3 px-4 py-3.5",
                i > 0 && "border-t",
              );

              if (!item.section) {
                return (
                  <div
                    key={item.id}
                    data-testid={`integracao-${item.id}`}
                    className={cn(classeLinha, item.status.kind === "em-breve" && "opacity-60")}
                  >
                    {conteudo}
                    <ChevronRight className="h-4 w-4 invisible" aria-hidden />
                  </div>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`integracao-${item.id}`}
                  onClick={() => onSelect(item.section!)}
                  className={cn(classeLinha, "text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}
                >
                  {conteudo}
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
