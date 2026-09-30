import { ArrowLeft, Bookmark, Hash, MessagesSquare, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AvatarPessoa } from "./AvatarPessoa";
import { TextoFormatado } from "./TextoFormatado";
import { horaCurta, nomeDaConversa, prefixoCanal } from "./equipeUtils";
import { mensagemDeErro, useEquipeAcoes, useMeusFios, useSalvos } from "./useEquipe";
import type { Conversa, Pessoa, TipoCanal } from "./tipos";

/** Monta só o que `nomeDaConversa` precisa, a partir de uma linha com canal. */
export function canalFalso(tipo: TipoCanal, nome: string | null, outros: string[]): Conversa {
  return {
    id: "", tipo, nome, descricao: null, privado: false, department_id: null, arquivado: false,
    ultima_mensagem_em: null, previa: null, previa_autor: null, nao_lidas: 0, mencoes: 0, silenciado: false, outros,
  };
}

export function RotuloCanal({ tipo, nome, outros, mapa }: { tipo: TipoCanal; nome: string | null; outros: string[]; mapa: Map<string, Pessoa> }) {
  const c = canalFalso(tipo, nome, outros);
  const Icone = tipo === "setor" ? Users : tipo === "dm" || tipo === "grupo" ? MessagesSquare : Hash;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
      <Icone className="h-3 w-3 shrink-0" />
      <span className="truncate">{tipo === "dm" || tipo === "grupo" ? `Conversa com ${nomeDaConversa(c, mapa)}` : `${prefixoCanal(c)}${nomeDaConversa(c, mapa)}`}</span>
    </span>
  );
}

function Cabecalho({ titulo, sub, onVoltar }: { titulo: string; sub: string; onVoltar: () => void }) {
  return (
    <header className="flex items-center gap-3 border-b px-4 py-2.5">
      <Button size="icon" variant="ghost" className="-ml-2 h-8 w-8 md:hidden" onClick={onVoltar} aria-label="Voltar para a lista">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-tight">{titulo}</h2>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
    </header>
  );
}

function Vazio({ icone: Icone, titulo, texto }: { icone: typeof Bookmark; titulo: string; texto: string }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <Icone className="mb-3 h-9 w-9 text-muted-foreground/60" />
      <p className="font-semibold">{titulo}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}

// ------------------------------------------------------------------- fios

export function EquipeFiosVista({ mapa, onAbrir, onVoltar }: {
  mapa: Map<string, Pessoa>;
  onAbrir: (canalId: string, raizId: string) => void;
  onVoltar: () => void;
}) {
  const { data: fios = [], isLoading } = useMeusFios();
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <Cabecalho titulo="Fios" sub="Conversas em fio que você começou, respondeu ou onde foi mencionado" onVoltar={onVoltar} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>
        ) : fios.length === 0 ? (
          <Vazio icone={MessagesSquare} titulo="Nenhum fio por aqui" texto="Quando alguém responder a uma mensagem sua, ou você responder a alguém, o fio aparece aqui." />
        ) : (
          <ul className="divide-y">
            {fios.map((f) => {
              const autor = mapa.get(f.autor_id ?? "");
              return (
                <li key={f.raiz_id}>
                  <button type="button" onClick={() => onAbrir(f.canal_id, f.raiz_id)}
                    className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/50", f.nao_lidas > 0 && "bg-sky-500/5")}>
                    <AvatarPessoa userId={f.autor_id} pessoa={autor} tamanho="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <RotuloCanal tipo={f.canal_tipo} nome={f.canal_nome} outros={f.canal_outros} mapa={mapa} />
                        {f.nao_lidas > 0 && (
                          <span className={cn("rounded-full px-1.5 text-[11px] font-bold leading-5 text-white", f.mencoes > 0 ? "bg-rose-500" : "bg-sky-500")}>
                            {f.mencoes > 0 ? "@ " : ""}{f.nao_lidas} {f.nao_lidas === 1 ? "nova" : "novas"}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm">
                        <span className="font-semibold">{autor?.nome ?? "Colaborador"}</span>
                        {f.apagada ? <span className="ml-1 italic text-muted-foreground">Mensagem apagada</span> : (
                          <TextoFormatado texto={f.corpo} className="line-clamp-2" />
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex -space-x-1">
                          {f.respondentes.slice(0, 4).map((id) => <AvatarPessoa key={id} userId={id} pessoa={mapa.get(id)} tamanho="xs" className="rounded ring-2 ring-background" />)}
                        </span>
                        <span className="font-medium text-sky-700 dark:text-sky-400">{f.respostas} {f.respostas === 1 ? "resposta" : "respostas"}</span>
                        <span>· última {horaCurta(f.ultima_resposta_em)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ salvos

export function EquipeSalvosVista({ mapa, onAbrir, onVoltar }: {
  mapa: Map<string, Pessoa>;
  onAbrir: (canalId: string, msgId: string, parentId: string | null) => void;
  onVoltar: () => void;
}) {
  const { data: salvos = [], isLoading } = useSalvos();
  const acoes = useEquipeAcoes();
  const tirar = (id: string) => acoes.salvar.mutate({ msg: { id }, salvar: false }, { onError: (e) => toast.error(mensagemDeErro(e)) });

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <Cabecalho titulo="Salvos" sub="Mensagens que você guardou para voltar depois. Só você vê esta lista." onVoltar={onVoltar} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>
        ) : salvos.length === 0 ? (
          <Vazio icone={Bookmark} titulo="Nada salvo ainda" texto="Passe o mouse numa mensagem e toque no marcador para guardar um procedimento, um link ou um combinado." />
        ) : (
          <ul className="divide-y">
            {salvos.map((m) => {
              const autor = mapa.get(m.autor_id ?? "");
              return (
                <li key={m.id} className="group flex gap-3 px-4 py-3 hover:bg-muted/50">
                  <button type="button" onClick={() => onAbrir(m.canal_id, m.id, m.parent_id)} className="flex min-w-0 flex-1 gap-3 text-left">
                    <AvatarPessoa userId={m.autor_id} pessoa={autor} tamanho="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="text-sm font-semibold">{autor?.nome ?? "Colaborador"}</span>
                        <RotuloCanal tipo={m.canal_tipo} nome={m.canal_nome} outros={m.canal_outros} mapa={mapa} />
                        <span className="text-xs text-muted-foreground">{horaCurta(m.created_at)}</span>
                      </div>
                      {m.apagada ? <p className="text-sm italic text-muted-foreground">Mensagem apagada</p> : (
                        <TextoFormatado texto={m.corpo} className="line-clamp-3 text-sm" />
                      )}
                    </div>
                  </button>
                  <button type="button" onClick={() => tirar(m.id)} className="self-start rounded-md p-1.5 text-amber-500 hover:bg-muted" aria-label="Tirar dos salvos" title="Tirar dos salvos">
                    <Bookmark className="h-4 w-4 fill-current" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
