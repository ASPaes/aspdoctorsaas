import { useEffect, useMemo, useState } from "react";
import { Hash, Loader2, Lock, MessagesSquare, Search, Users } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AvatarPessoa } from "./AvatarPessoa";
import { RotuloCanal } from "./EquipeVistas";
import { horaCurta, nomeDaConversa, prefixoCanal, presencaDe } from "./equipeUtils";
import { useBuscaMensagens } from "./useEquipe";
import type { Conversa, MensagemComCanal, Pessoa } from "./tipos";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  conversas: Conversa[];
  pessoas: Pessoa[];
  mapa: Map<string, Pessoa>;
  eu: string;
  onAbrirConversa: (id: string) => void;
  onAbrirPessoa: (userId: string) => void;
  onAbrirMensagem: (m: MensagemComCanal) => void;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/** Trecho da mensagem em volta do termo, com o termo em negrito. */
function Trecho({ texto, termo }: { texto: string; termo: string }) {
  const plano = texto.replace(/\s+/g, " ");
  const i = normalizar(plano).indexOf(normalizar(termo));
  if (i < 0) return <span className="line-clamp-2">{plano}</span>;
  const ini = Math.max(0, i - 50);
  return (
    <span className="line-clamp-2">
      {ini > 0 && "…"}{plano.slice(ini, i)}
      <mark className="rounded bg-amber-300/40 px-0.5 text-foreground">{plano.slice(i, i + termo.length)}</mark>
      {plano.slice(i + termo.length, i + termo.length + 120)}
    </span>
  );
}

/**
 * Ctrl+K: pular para qualquer conversa, abrir conversa com um colega ou achar
 * uma mensagem antiga. Conversas e pessoas filtram na hora (já estão na tela);
 * mensagens vão ao banco, que só devolve o que a pessoa pode ler.
 */
export function EquipeBusca({ aberto, onFechar, conversas, pessoas, mapa, eu, onAbrirConversa, onAbrirPessoa, onAbrirMensagem }: Props) {
  const [termo, setTermo] = useState("");
  const [atrasado, setAtrasado] = useState("");
  useEffect(() => { if (aberto) { setTermo(""); setAtrasado(""); } }, [aberto]);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(termo), 300);
    return () => clearTimeout(t);
  }, [termo]);

  const t = normalizar(termo.trim());
  const busca = useBuscaMensagens(atrasado);

  const achadas = useMemo(() => {
    if (!t) return { conversas: conversas.slice(0, 6), pessoas: [] as Pessoa[] };
    return {
      conversas: conversas.filter((c) => normalizar(nomeDaConversa(c, mapa)).includes(t)).slice(0, 6),
      pessoas: pessoas.filter((p) => p.user_id !== eu && normalizar(`${p.nome} ${p.setor ?? ""}`).includes(t)).slice(0, 5),
    };
  }, [t, conversas, pessoas, mapa, eu]);

  const fechar = (fn: () => void) => { fn(); onFechar(); };
  const mensagens = atrasado.trim().length >= 2 ? busca.data ?? [] : [];
  const buscando = termo.trim().length >= 2 && (busca.isFetching || termo !== atrasado);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Buscar na Equipe</DialogTitle>
        <Command shouldFilter={false} className="rounded-none">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              id="equipe-busca-global"
              autoFocus
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Buscar conversa, colega ou mensagem"
              autoComplete="off"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {buscando && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          </div>
          <CommandList className="max-h-[60vh]">
            {!buscando && t && achadas.conversas.length === 0 && achadas.pessoas.length === 0 && mensagens.length === 0 && (
              <CommandEmpty>Nada encontrado para "{termo.trim()}".</CommandEmpty>
            )}

            {achadas.conversas.length > 0 && (
              <CommandGroup heading={t ? "Conversas" : "Recentes"}>
                {achadas.conversas.map((c) => {
                  const Icone = c.tipo === "setor" ? Users : c.tipo === "dm" || c.tipo === "grupo" ? MessagesSquare : c.privado ? Lock : Hash;
                  return (
                    <CommandItem key={c.id} value={`c-${c.id}`} onSelect={() => fechar(() => onAbrirConversa(c.id))} className="gap-2">
                      {c.tipo === "dm"
                        ? <AvatarPessoa userId={c.outros[0] ?? null} pessoa={mapa.get(c.outros[0] ?? "")} tamanho="xs" comPresenca anel="ring-popover" />
                        : <Icone className="h-4 w-4 text-muted-foreground" />}
                      <span className="truncate">{prefixoCanal(c)}{nomeDaConversa(c, mapa)}</span>
                      {c.nao_lidas > 0 && <span className="ml-auto text-xs text-muted-foreground">{c.nao_lidas} não {c.nao_lidas === 1 ? "lida" : "lidas"}</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {achadas.pessoas.length > 0 && (
              <CommandGroup heading="Conversar com">
                {achadas.pessoas.map((p) => (
                  <CommandItem key={p.user_id} value={`p-${p.user_id}`} onSelect={() => fechar(() => onAbrirPessoa(p.user_id))} className="gap-2">
                    <AvatarPessoa userId={p.user_id} pessoa={p} tamanho="xs" comPresenca anel="ring-popover" />
                    <span className="truncate">{p.nome}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">{[p.setor, presencaDe(p).texto].filter(Boolean).join(" · ")}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {mensagens.length > 0 && (
              <CommandGroup heading={`Mensagens (${mensagens.length}${mensagens.length === 30 ? "+" : ""})`}>
                {mensagens.map((m) => (
                  <CommandItem key={m.id} value={`m-${m.id}`} onSelect={() => fechar(() => onAbrirMensagem(m))} className="items-start gap-2 py-2">
                    <AvatarPessoa userId={m.autor_id} pessoa={mapa.get(m.autor_id ?? "")} tamanho="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold">{mapa.get(m.autor_id ?? "")?.nome ?? "Colaborador"}</span>
                        <RotuloCanal tipo={m.canal_tipo} nome={m.canal_nome} outros={m.canal_outros} mapa={mapa} />
                        {m.parent_id && <span className="text-muted-foreground">· no fio</span>}
                        <span className="ml-auto shrink-0 text-muted-foreground">{horaCurta(m.created_at)}</span>
                      </div>
                      <div className="text-sm"><Trecho texto={m.corpo} termo={atrasado.trim()} /></div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {t.length === 1 && <p className="px-4 py-3 text-xs text-muted-foreground">Digite mais uma letra para buscar nas mensagens.</p>}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ navegar</span><span>Enter abrir</span><span>Esc fechar</span>
            <span className="ml-auto">Busca só no que você pode ler</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
