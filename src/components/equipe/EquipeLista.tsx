import { useMemo } from "react";
import { BellOff, Bookmark, Hash, Lock, MessagesSquare, Plus, Search, SquarePen, Users, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AvatarPessoa } from "./AvatarPessoa";
import { nomeDaConversa, presencaDe } from "./equipeUtils";
import type { Conversa, Pessoa } from "./tipos";

interface Props {
  conversas: Conversa[];
  pessoas: Map<string, Pessoa>;
  eu: string | null;
  selecionada: string | null;
  carregando: boolean;
  podeCriarCanal: boolean;
  onSelecionar: (id: string) => void;
  onNovaConversa: () => void;
  onNovoCanal: () => void;
  onProcurar: () => void;
  vista: "fios" | "salvos" | null;
  onVista: (v: "fios" | "salvos") => void;
  fiosNaoLidos: number;
  fiosMencoes: number;
  onBuscar: () => void;
}

function IconeConversa({ c, pessoas }: { c: Conversa; pessoas: Map<string, Pessoa> }) {
  if (c.tipo === "dm") {
    const id = c.outros[0] ?? null;
    return <AvatarPessoa userId={id} pessoa={pessoas.get(id ?? "")} tamanho="xs" comPresenca anel="ring-card" />;
  }
  if (c.tipo === "grupo") {
    return (
      <span className="grid h-5 w-5 place-items-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
        {c.outros.length + 1}
      </span>
    );
  }
  const Icone = c.tipo === "setor" ? Users : c.privado ? Lock : Hash;
  return <Icone className="h-4 w-4 shrink-0 opacity-70" />;
}

function Item({ c, ativo, pessoas, onClick }: { c: Conversa; ativo: boolean; pessoas: Map<string, Pessoa>; onClick: () => void }) {
  const nome = nomeDaConversa(c, pessoas);
  const temNovidade = c.nao_lidas > 0 && !c.silenciado;
  const presenca = c.tipo === "dm" ? presencaDe(pessoas.get(c.outros[0] ?? "")).texto : null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={presenca ? `${nome} · ${presenca}` : (c.previa ?? nome)}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        ativo ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted",
        temNovidade && !ativo && "font-semibold text-foreground",
        c.arquivado && "opacity-60",
      )}
    >
      <IconeConversa c={c} pessoas={pessoas} />
      <span className="min-w-0 flex-1 truncate">{nome}</span>
      {c.silenciado && <BellOff className="h-3.5 w-3.5 shrink-0 opacity-50" />}
      {c.mencoes > 0 ? (
        <span className={cn("shrink-0 rounded-full px-1.5 text-[11px] font-bold leading-5",
          ativo ? "bg-primary-foreground text-primary" : "bg-rose-500 text-white")}>
          @{c.mencoes > 1 ? c.mencoes : ""}
        </span>
      ) : temNovidade && (
        <span className={cn("min-w-[20px] shrink-0 rounded-full px-1.5 text-center text-[11px] font-bold leading-5",
          ativo ? "bg-primary-foreground text-primary" : c.tipo === "dm" || c.tipo === "grupo" ? "bg-rose-500 text-white" : "bg-muted-foreground/20")}>
          {c.nao_lidas > 99 ? "99+" : c.nao_lidas}
        </span>
      )}
    </button>
  );
}

function Atalho({ icone: Icone, rotulo, ativo, onClick, contador = 0, mencao }: {
  icone: typeof Hash; rotulo: string; ativo: boolean; onClick: () => void; contador?: number; mencao?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        ativo ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted", contador > 0 && !ativo && "font-semibold text-foreground")}>
      <Icone className="h-4 w-4 shrink-0 opacity-70" />
      <span className="flex-1">{rotulo}</span>
      {contador > 0 && (
        <span className={cn("min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-bold leading-5",
          ativo ? "bg-primary-foreground text-primary" : mencao ? "bg-rose-500 text-white" : "bg-muted-foreground/20")}>
          {mencao ? "@" : ""}{contador > 99 ? "99+" : contador}
        </span>
      )}
    </button>
  );
}

function Secao({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-2 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</span>
        {acao}
      </div>
      {children}
    </div>
  );
}

export function EquipeLista({
  conversas, pessoas, eu, selecionada, carregando, podeCriarCanal,
  onSelecionar, onNovaConversa, onNovoCanal, onProcurar,
  vista, onVista, fiosNaoLidos, fiosMencoes, onBuscar,
}: Props) {
  const { canais, diretas } = useMemo(() => {
    const filtra = (_c: Conversa) => true;
    const ordemTipo = { geral: 0, setor: 1, canal: 2, dm: 3, grupo: 3 } as const;
    const canais = conversas
      .filter((c) => c.tipo !== "dm" && c.tipo !== "grupo" && filtra(c))
      .sort((a, b) => ordemTipo[a.tipo] - ordemTipo[b.tipo] || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR"));
    const diretas = conversas.filter((c) => (c.tipo === "dm" || c.tipo === "grupo") && filtra(c));
    return { canais, diretas };
  }, [conversas]);

  const eu_ = eu ? pessoas.get(eu) : undefined;
  const minhaPresenca = presencaDe(eu_);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-3">
        <AvatarPessoa userId={eu} pessoa={eu_} tamanho="md" comPresenca anel="ring-card" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{eu_?.nome ?? "Você"}</div>
          <div className="truncate text-xs text-muted-foreground">{minhaPresenca.texto}</div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onNovaConversa} aria-label="Nova conversa">
              <SquarePen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Nova conversa</TooltipContent>
        </Tooltip>
      </div>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={onBuscar}
          className="flex h-8 w-full items-center gap-2 rounded-md border bg-background px-2 text-sm text-muted-foreground hover:border-foreground/30"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Buscar</span>
          <kbd className="rounded border px-1.5 font-sans text-[10px]">Ctrl K</kbd>
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {carregando && conversas.length === 0 ? (
          <div className="space-y-2 px-2 pt-4">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-6 animate-pulse rounded bg-muted" />)}
          </div>
        ) : (
          <>
            <div className="space-y-0.5 pt-2">
              <Atalho icone={MessagesSquare} rotulo="Fios" ativo={vista === "fios"} onClick={() => onVista("fios")}
                contador={fiosNaoLidos} mencao={fiosMencoes > 0} />
              <Atalho icone={Bookmark} rotulo="Salvos" ativo={vista === "salvos"} onClick={() => onVista("salvos")} />
            </div>
            <Secao
              titulo="Canais"
              acao={
                <div className="flex items-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" onClick={onProcurar} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Procurar canais">
                        <Compass className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Procurar canais</TooltipContent>
                  </Tooltip>
                  {podeCriarCanal && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" onClick={onNovoCanal} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Criar canal">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Criar canal</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              }
            >
              {canais.map((c) => (
                <Item key={c.id} c={c} ativo={c.id === selecionada} pessoas={pessoas} onClick={() => onSelecionar(c.id)} />
              ))}
            </Secao>

            <Secao
              titulo="Mensagens diretas"
              acao={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={onNovaConversa} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Nova conversa">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Nova conversa</TooltipContent>
                </Tooltip>
              }
            >
              {diretas.map((c) => (
                <Item key={c.id} c={c} ativo={c.id === selecionada} pessoas={pessoas} onClick={() => onSelecionar(c.id)} />
              ))}
              {diretas.length === 0 && (
                <button type="button" onClick={onNovaConversa} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
                  Converse com um colega
                </button>
              )}
            </Secao>
          </>
        )}
      </nav>
    </aside>
  );
}
