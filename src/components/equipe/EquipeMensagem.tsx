import { memo, useEffect, useRef, useState } from "react";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import { Copy, Pencil, SmilePlus, Trash2, AlertCircle, Loader2, MessageSquareReply, Bookmark, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AvatarPessoa } from "./AvatarPessoa";
import { TextoFormatado } from "./TextoFormatado";
import { EquipeCartoes } from "./EquipeCartoes";
import { EquipeAnexos } from "./EquipeAnexos";
import { hora } from "./equipeUtils";
import type { Mensagem, Pessoa } from "./tipos";

const RAPIDAS = ["👍", "✅", "👀", "🙏"];

interface Props {
  msg: Mensagem;
  continuacao: boolean;
  eu: string;
  pessoas: Map<string, Pessoa>;
  podeApagarDosOutros: boolean;
  editando: boolean;
  // handlers recebem a mensagem: o pai passa funções estáveis e o memo funciona
  onEditar: (m: Mensagem | null) => void;
  onSalvarEdicao: (m: Mensagem, corpo: string) => Promise<void>;
  onReagir: (m: Mensagem, emoji: string) => void;
  onApagar: (m: Mensagem) => void;
  onRetentar: (m: Mensagem) => void;
  /** Dentro do painel do fio: sem "responder no fio" e sem contagem de respostas. */
  noFio?: boolean;
  salva: boolean;
  podeFixar: boolean;
  /** Pisca quando a pessoa chega aqui pela busca, salvos ou fixadas. */
  destacada?: boolean;
  onAbrirFio?: (m: Mensagem) => void;
  onFixar: (m: Mensagem, fixar: boolean) => void;
  onSalvar: (m: Mensagem, salvar: boolean) => void;
}

function SeletorEmoji({ onEscolher, children }: { onEscolher: (e: string) => void; children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto border-0 p-0" align="end">
        <EmojiPicker
          onEmojiClick={(d: EmojiClickData) => { onEscolher(d.emoji); setAberto(false); }}
          autoFocusSearch
          theme={Theme.AUTO}
          searchPlaceHolder="Buscar emoji"
          previewConfig={{ showPreview: false }}
          height={360}
        />
      </PopoverContent>
    </Popover>
  );
}

function EditorInline({ inicial, onSalvar, onCancelar }: { inicial: string; onSalvar: (t: string) => Promise<void>; onCancelar: () => void }) {
  const [texto, setTexto] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  const salvar = async () => {
    const t = texto.trim();
    if (!t || t === inicial.trim()) { onCancelar(); return; }
    setSalvando(true);
    try { await onSalvar(t); } finally { setSalvando(false); }
  };
  return (
    <div className="mt-1 rounded-lg border bg-background focus-within:border-sky-500">
      <textarea
        ref={ref}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); salvar(); }
          if (e.key === "Escape") { e.preventDefault(); onCancelar(); }
        }}
        rows={1}
        className="max-h-60 w-full resize-none bg-transparent px-3 py-2 text-sm outline-none"
      />
      <div className="flex items-center justify-end gap-2 px-2 pb-2 text-xs">
        <span className="mr-auto text-muted-foreground">Esc cancela · Enter salva</span>
        <button type="button" onClick={onCancelar} className="rounded-md border px-2.5 py-1 hover:bg-muted">Cancelar</button>
        <button type="button" onClick={salvar} disabled={salvando} className="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground disabled:opacity-60">
          {salvando ? "Salvando" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function EquipeMensagemBase({
  msg, continuacao, eu, pessoas, podeApagarDosOutros, editando,
  onEditar, onSalvarEdicao, onReagir, onApagar, onRetentar,
  noFio, salva, podeFixar, destacada, onAbrirFio, onFixar, onSalvar,
}: Props) {
  const [confirmarApagar, setConfirmarApagar] = useState(false);
  const autor = msg.autor_id ? pessoas.get(msg.autor_id) : undefined;
  const nomeAutor = autor?.nome ?? "Colaborador";
  const minha = msg.autor_id === eu;
  const apagada = !!msg.apagada_em;
  const mencionada = !minha && !apagada && (msg.mencoes?.includes(eu) || msg.menciona_todos);
  const nomesMencionados = (msg.mencoes ?? []).map((id) => pessoas.get(id)?.nome).filter(Boolean) as string[];

  if (msg.tipo === "sistema") {
    return (
      <div className="px-4 py-1 text-center text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{nomeAutor}</span> {msg.corpo} · {hora(msg.created_at)}
      </div>
    );
  }

  const reacoes = Object.entries(msg.reacoes ?? {}).filter(([, us]) => us.length > 0);
  const podeAgir = !apagada && !msg._pendente && !msg._falhou;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(msg.corpo);
      toast.success("Texto copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <div
      data-msg-id={msg.id}
      className={cn(
        "group relative flex gap-3 px-4 transition-colors duration-700 hover:bg-muted/40",
        continuacao && !msg.fixada_em ? "py-0.5" : "pt-2 pb-0.5",
        mencionada && "bg-amber-400/10 hover:bg-amber-400/15 border-l-2 border-amber-400",
        msg.fixada_em && !mencionada && "bg-sky-500/5",
        editando && "bg-sky-500/5 hover:bg-sky-500/5",
        destacada && "bg-sky-500/20 hover:bg-sky-500/20",
      )}
    >
      <div className="w-9 shrink-0">
        {continuacao ? (
          <span className="invisible block pt-1 text-right text-[10px] tabular-nums text-muted-foreground group-hover:visible">
            {hora(msg.created_at)}
          </span>
        ) : (
          <AvatarPessoa userId={msg.autor_id} pessoa={autor} tamanho="md" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {msg.fixada_em && !apagada && (
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-400">
            <Pin className="h-3 w-3" />
            Fixada{msg.fixada_por ? ` por ${msg.fixada_por === eu ? "você" : pessoas.get(msg.fixada_por)?.nome?.split(" ")[0] ?? "um colega"}` : ""}
          </div>
        )}
        {(!continuacao || msg.fixada_em) && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold">{nomeAutor}</span>
            {autor?.setor && <span className="text-[11px] text-muted-foreground">{autor.setor}</span>}
            <span className="text-[11px] tabular-nums text-muted-foreground">{hora(msg.created_at)}</span>
          </div>
        )}

        {apagada ? (
          <p className="text-sm italic text-muted-foreground">Mensagem apagada</p>
        ) : editando ? (
          <EditorInline inicial={msg.corpo} onSalvar={(t) => onSalvarEdicao(msg, t)} onCancelar={() => onEditar(null)} />
        ) : (
          <div className={cn("text-sm", msg._pendente && "opacity-60")}>
            {msg.corpo && <TextoFormatado texto={msg.corpo} nomesMencionados={nomesMencionados} meuNome={pessoas.get(eu)?.nome} />}
            {msg.editada_em && <span className="ml-1 text-[11px] text-muted-foreground">(editada)</span>}
          </div>
        )}

        {/* enquanto a mensagem não chega ao banco, o link do arquivo ainda não existe */}
        {!apagada && (msg.anexos?.length ?? 0) > 0 && (msg._pendente || msg._falhou
          ? <p className="mt-1 text-xs text-muted-foreground">{msg.anexos.length === 1 ? msg.anexos[0].nome : `${msg.anexos.length} arquivos`}</p>
          : <EquipeAnexos anexos={msg.anexos} />)}
        {!apagada && (msg.refs?.length ?? 0) > 0 && <EquipeCartoes refs={msg.refs} mapa={pessoas} eu={eu} />}

        {msg._pendente && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Enviando
          </span>
        )}
        {msg._falhou && (
          <button type="button" onClick={() => onRetentar(msg)} className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:underline dark:text-rose-400">
            <AlertCircle className="h-3 w-3" /> Não enviada. Toque para tentar de novo
          </button>
        )}

        {reacoes.length > 0 && !apagada && (
          <div className="mt-1 flex flex-wrap gap-1">
            {reacoes.map(([emoji, us]) => {
              const minhaReacao = us.includes(eu);
              const nomes = us.map((u) => (u === eu ? "Você" : pessoas.get(u)?.nome?.split(" ")[0] ?? "Colega"));
              return (
                <Tooltip key={emoji}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onReagir(msg, emoji)}
                      className={cn(
                        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors",
                        minhaReacao ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-background hover:border-foreground/30",
                      )}
                    >
                      <span className="text-sm leading-none">{emoji}</span>{us.length}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{nomes.join(", ")}</TooltipContent>
                </Tooltip>
              );
            })}
            <SeletorEmoji onEscolher={(e) => onReagir(msg, e)}>
              <button type="button" aria-label="Adicionar reação" className="inline-flex h-6 items-center rounded-full border border-dashed px-2 text-muted-foreground hover:text-foreground">
                <SmilePlus className="h-3.5 w-3.5" />
              </button>
            </SeletorEmoji>
          </div>
        )}

        {!noFio && msg.respostas > 0 && onAbrirFio && (
          <button
            type="button"
            onClick={() => onAbrirFio(msg)}
            className="group/fio mt-1 flex w-full max-w-md items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left text-xs hover:border-border hover:bg-background"
          >
            <span className="flex -space-x-1">
              {(msg.respondentes ?? []).slice(0, 3).map((id) => (
                <AvatarPessoa key={id} userId={id} pessoa={pessoas.get(id)} tamanho="xs" className="rounded ring-2 ring-background" />
              ))}
            </span>
            <span className="font-semibold text-sky-700 dark:text-sky-400">
              {msg.respostas} {msg.respostas === 1 ? "resposta" : "respostas"}
            </span>
            {msg.ultima_resposta_em && (
              <span className="text-muted-foreground group-hover/fio:hidden">Última às {hora(msg.ultima_resposta_em)}</span>
            )}
            <span className="hidden text-muted-foreground group-hover/fio:inline">Ver fio</span>
          </button>
        )}
      </div>

      {podeAgir && !editando && (
        <div className="absolute -top-3 right-4 z-10 hidden items-center gap-0.5 rounded-lg border bg-popover p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
          {RAPIDAS.map((e) => (
            <button key={e} type="button" onClick={() => onReagir(msg, e)} className="rounded-md px-1.5 py-0.5 text-sm hover:bg-muted" aria-label={`Reagir com ${e}`}>
              {e}
            </button>
          ))}
          <SeletorEmoji onEscolher={(e) => onReagir(msg, e)}>
            <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Mais reações">
              <SmilePlus className="h-4 w-4" />
            </button>
          </SeletorEmoji>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {!noFio && onAbrirFio && (
            <button type="button" onClick={() => onAbrirFio(msg)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Responder no fio" title="Responder no fio">
              <MessageSquareReply className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => onSalvar(msg, !salva)} className={cn("rounded-md p-1.5 hover:bg-muted", salva ? "text-amber-500" : "text-muted-foreground hover:text-foreground")}
            aria-label={salva ? "Tirar dos salvos" : "Salvar"} title={salva ? "Tirar dos salvos" : "Salvar para depois"}>
            <Bookmark className={cn("h-4 w-4", salva && "fill-current")} />
          </button>
          {podeFixar && !msg.parent_id && (
            <button type="button" onClick={() => onFixar(msg, !msg.fixada_em)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={msg.fixada_em ? "Desafixar" : "Fixar no canal"} title={msg.fixada_em ? "Desafixar" : "Fixar no canal"}>
              {msg.fixada_em ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
          )}
          <button type="button" onClick={copiar} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Copiar texto" title="Copiar texto">
            <Copy className="h-4 w-4" />
          </button>
          {minha && (
            <button type="button" onClick={() => onEditar(msg)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Editar" title="Editar">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {(minha || podeApagarDosOutros) && (
            <button type="button" onClick={() => setConfirmarApagar(true)} className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600" aria-label="Apagar" title="Apagar">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <AlertDialog open={confirmarApagar} onOpenChange={setConfirmarApagar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar mensagem?</AlertDialogTitle>
            <AlertDialogDescription>
              {minha
                ? "Todos passam a ver \"Mensagem apagada\" no lugar dela."
                : `A mensagem de ${nomeAutor} some para todos e fica "Mensagem apagada" no lugar.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => onApagar(msg)} className="bg-rose-600 text-white hover:bg-rose-700">Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const EquipeMensagem = memo(EquipeMensagemBase);
