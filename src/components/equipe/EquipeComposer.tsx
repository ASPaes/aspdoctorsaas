import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Bold, Code, Italic, SendHorizontal, AtSign, Paperclip, Ticket, Building2, Headset, FileUp, X, Loader2, AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ehImagem, motivoRecusa, nomeDoColado, subirArquivo, tamanhoLegivel } from "./arquivos";
import { EmojiPickerButton } from "@/components/whatsapp/chat/input/EmojiPickerButton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AvatarPessoa } from "./AvatarPessoa";
import { AnexarDialog } from "./EquipeAnexar";
import { EtiquetaRef } from "./EquipeCartoes";
import { presencaDe } from "./equipeUtils";
import type { Anexo, Pessoa, Ref, TipoRef } from "./tipos";

// Rascunho por conversa: trocar de canal não perde o que estava escrito.
const rascunhos = new Map<string, string>();
const anexosRascunho = new Map<string, { ref: Ref; rotulo: string }[]>();
const MAX_ANEXOS = 5;
const MAX_ARQUIVOS = 10;

// ---- arquivos em andamento, por conversa
// Fora do componente de propósito: o upload continua se a pessoa trocar de
// conversa no meio, e o arquivo está lá quando ela voltar.
type Pendente = { id: string; nome: string; mime: string; tamanho: number; previa?: string; estado: "subindo" | "pronto" | "erro"; anexo?: Anexo; erro?: string };
const pendentes = new Map<string, Pendente[]>();
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());
const VAZIO: Pendente[] = [];
function mudarPendentes(chave: string, fn: (l: Pendente[]) => Pendente[]) {
  const nova = fn(pendentes.get(chave) ?? VAZIO);
  if (nova.length) pendentes.set(chave, nova); else pendentes.delete(chave);
  avisar();
}
// Funções estáveis: com subscribe/getSnapshot novos a cada render, o React
// refaz a inscrição em todo commit e, digitando rápido com arquivo anexado,
// estoura o limite de atualizações ("Maximum update depth exceeded").
function assinarPendentes(f: () => void) {
  ouvintes.add(f);
  return () => { ouvintes.delete(f); };
}
function usePendentes(chave: string): Pendente[] {
  const ler = useCallback(() => pendentes.get(chave) ?? VAZIO, [chave]);
  return useSyncExternalStore(assinarPendentes, ler);
}

export interface ComposerHandle {
  /** Arquivos soltos na conversa (arrastar e soltar fora do campo). */
  adicionarArquivos: (files: File[]) => void;
}

interface Props {
  /** Identifica o rascunho: id do canal, ou "fio-<id>" no painel do fio. */
  chave: string;
  /** Conversa para onde os arquivos sobem. */
  canalId: string;
  placeholder: string;
  pessoas: Pessoa[];
  eu: string;
  permiteTodos: boolean;
  desabilitado?: string | null;
  onEnviar: (texto: string, refs: Ref[], arquivos: Anexo[]) => void;
  /** Seta para cima com o campo vazio: editar a minha última mensagem. */
  onEditarUltima: () => void;
}

type Sugestao = { id: string; nome: string; pessoa?: Pessoa; todos?: boolean };

const MAX_SUGESTOES = 8;

export const EquipeComposer = forwardRef<ComposerHandle, Props>(function EquipeComposer(
  { chave, canalId, placeholder, pessoas, eu, permiteTodos, desabilitado, onEnviar, onEditarUltima }, handle,
) {
  const arquivos = usePendentes(chave);
  const [arrastando, setArrastando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const adicionarArquivos = (files: File[]) => {
    if (desabilitado || files.length === 0) return;
    const livres = MAX_ARQUIVOS - (pendentes.get(chave)?.length ?? 0);
    if (files.length > livres) toast.error(`Até ${MAX_ARQUIVOS} arquivos por mensagem`);
    for (const f of files.slice(0, Math.max(0, livres))) {
      const recusa = motivoRecusa(f);
      if (recusa) { toast.error(recusa); continue; }
      const id = crypto.randomUUID();
      const nome = nomeDoColado(f);
      const previa = ehImagem(f.type) ? URL.createObjectURL(f) : undefined;
      mudarPendentes(chave, (l) => [...l, { id, nome, mime: f.type, tamanho: f.size, previa, estado: "subindo" }]);
      subirArquivo(canalId, f, nome)
        .then((anexo) => mudarPendentes(chave, (l) => l.map((p) => (p.id === id ? { ...p, estado: "pronto", anexo } : p))))
        .catch((e: Error) => mudarPendentes(chave, (l) => l.map((p) => (p.id === id ? { ...p, estado: "erro", erro: e.message } : p))));
    }
    requestAnimationFrame(() => ref.current?.focus());
  };
  const tirarArquivo = (id: string) => mudarPendentes(chave, (l) => {
    const p = l.find((x) => x.id === id);
    if (p?.previa) URL.revokeObjectURL(p.previa);
    return l.filter((x) => x.id !== id);
  });
  useImperativeHandle(handle, () => ({ adicionarArquivos }));

  const [texto, setTexto] = useState(() => rascunhos.get(chave) ?? "");
  const [mencao, setMencao] = useState<{ termo: string; inicio: number } | null>(null);
  const [indice, setIndice] = useState(0);
  const [anexos, setAnexos] = useState(() => anexosRascunho.get(chave) ?? []);
  const [anexar, setAnexar] = useState<TipoRef | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (anexos.length) anexosRascunho.set(chave, anexos); else anexosRascunho.delete(chave);
  }, [anexos, chave]);

  // troca de conversa: guarda o rascunho da anterior e carrega o da nova
  useEffect(() => {
    setAnexos(anexosRascunho.get(chave) ?? []);
    setTexto(rascunhos.get(chave) ?? "");
    setMencao(null);
    requestAnimationFrame(() => ref.current?.focus());
  }, [chave]);

  useEffect(() => {
    if (texto) rascunhos.set(chave, texto); else rascunhos.delete(chave);
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 240)}px`; }
  }, [texto, chave]);

  const sugestoes = useMemo<Sugestao[]>(() => {
    if (!mencao) return [];
    const t = mencao.termo.toLocaleLowerCase("pt-BR");
    const lista: Sugestao[] = pessoas
      .filter((p) => p.user_id !== eu)
      .filter((p) => !t || p.nome.toLocaleLowerCase("pt-BR").split(/\s+/).some((parte) => parte.startsWith(t))
        || p.nome.toLocaleLowerCase("pt-BR").startsWith(t))
      .slice(0, MAX_SUGESTOES)
      .map((p) => ({ id: p.user_id, nome: p.nome, pessoa: p }));
    if (permiteTodos && "todos".startsWith(t)) lista.unshift({ id: "todos", nome: "todos", todos: true });
    return lista;
  }, [mencao, pessoas, eu, permiteTodos]);

  useEffect(() => { setIndice(0); }, [mencao?.termo]);

  const detectarMencao = (valor: string, cursor: number) => {
    const antes = valor.slice(0, cursor);
    // "@" no começo ou depois de espaço, seguido de até 3 palavras sem quebra de linha
    const m = /(?:^|\s)@([\p{L}\p{N}]*(?: [\p{L}\p{N}]*){0,2})$/u.exec(antes);
    if (m && m[1].length <= 30) setMencao({ termo: m[1], inicio: cursor - m[1].length - 1 });
    else setMencao(null);
  };

  const escolher = (s: Sugestao) => {
    if (!mencao) return;
    const el = ref.current;
    const cursor = el?.selectionStart ?? texto.length;
    const novo = `${texto.slice(0, mencao.inicio)}@${s.nome} ${texto.slice(cursor)}`;
    const pos = mencao.inicio + s.nome.length + 2;
    setTexto(novo);
    setMencao(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  };

  const inserir = (trecho: string) => {
    const el = ref.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const novo = texto.slice(0, ini) + trecho + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(ini + trecho.length, ini + trecho.length); });
  };

  /** Envolve a seleção com a marca (negrito, itálico, código). */
  const envolver = (marca: string) => {
    const el = ref.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const sel = texto.slice(ini, fim);
    const novo = texto.slice(0, ini) + marca + sel + marca + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => {
      el?.focus();
      if (sel) el?.setSelectionRange(ini, fim + marca.length * 2);
      else el?.setSelectionRange(ini + marca.length, ini + marca.length);
    });
  };

  const enviar = () => {
    const t = texto.trim();
    if ((!t && anexos.length === 0 && arquivos.length === 0) || desabilitado) return;
    if (arquivos.some((a) => a.estado === "subindo")) { toast.info("Espere os arquivos terminarem de subir"); return; }
    if (arquivos.some((a) => a.estado === "erro")) { toast.error("Tire os arquivos que falharam antes de enviar"); return; }
    onEnviar(t, anexos.map((a) => a.ref), arquivos.map((a) => a.anexo!).filter(Boolean));
    arquivos.forEach((a) => a.previa && URL.revokeObjectURL(a.previa));
    mudarPendentes(chave, () => []);
    setTexto("");
    setAnexos([]);
    setMencao(null);
    rascunhos.delete(chave);
    anexosRascunho.delete(chave);
  };

  const anexarRef = (r: Ref, rotulo: string) => {
    setAnexos((l) => (l.some((a) => a.ref.id === r.id) || l.length >= MAX_ANEXOS ? l : [...l, { ref: r, rotulo }]));
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mencao && sugestoes.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setIndice((i) => (i + 1) % sugestoes.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setIndice((i) => (i - 1 + sugestoes.length) % sugestoes.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); escolher(sugestoes[indice]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMencao(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); return; }
    if (e.key === "ArrowUp" && !texto) { e.preventDefault(); onEditarUltima(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); envolver("*"); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") { e.preventDefault(); envolver("_"); }
  };

  const botao = "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40";

  return (
    <div className="relative px-4 pb-4">
      {mencao && sugestoes.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 z-20 mb-1 overflow-hidden rounded-lg border bg-popover shadow-lg sm:right-auto sm:w-80">
          <div className="border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mencionar</div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {sugestoes.map((s, i) => (
              <li key={s.id} role="option" aria-selected={i === indice}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); escolher(s); }}
                  onMouseEnter={() => setIndice(i)}
                  className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === indice && "bg-muted")}
                >
                  {s.todos ? (
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300"><AtSign className="h-4 w-4" /></span>
                  ) : (
                    <AvatarPessoa userId={s.id} pessoa={s.pessoa} tamanho="sm" comPresenca anel="ring-popover" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{s.todos ? "@todos" : s.nome}</span>
                  <span className="shrink-0 truncate text-xs text-muted-foreground">
                    {s.todos ? "avisa todos daqui" : presencaDe(s.pessoa).texto}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className={cn("relative rounded-xl border bg-background transition-colors focus-within:border-sky-500", desabilitado && "opacity-60",
          arrastando && "border-sky-500 ring-2 ring-sky-500/30")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setArrastando(true); } }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setArrastando(false); adicionarArquivos([...e.dataTransfer.files]); } }}
      >
        {arquivos.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-2.5">
            {arquivos.map((a) => (
              <div key={a.id} title={a.erro ?? a.nome}
                className={cn("group/arq relative flex items-center gap-2 overflow-hidden rounded-lg border bg-muted/40",
                  a.previa ? "h-16 w-16" : "h-12 max-w-[220px] pl-2 pr-7", a.estado === "erro" && "border-rose-500")}>
                {a.previa ? (
                  <img src={a.previa} alt={a.nome} className={cn("h-full w-full object-cover", a.estado !== "pronto" && "opacity-50")} />
                ) : (
                  <>
                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{a.nome}</span>
                      <span className="block text-[11px] text-muted-foreground">{a.estado === "erro" ? "Falhou" : tamanhoLegivel(a.tamanho)}</span>
                    </span>
                  </>
                )}
                {a.estado === "subindo" && <Loader2 className={cn("h-4 w-4 animate-spin text-sky-500", a.previa ? "absolute inset-0 m-auto" : "absolute right-7")} />}
                {a.estado === "erro" && a.previa && <AlertCircle className="absolute inset-0 m-auto h-5 w-5 text-rose-500" />}
                <button type="button" onClick={() => tirarArquivo(a.id)} aria-label={`Tirar ${a.nome}`}
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 text-muted-foreground shadow hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {arrastando && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-sky-500/10 text-sm font-semibold text-sky-700 dark:text-sky-300">
            Solte para anexar
          </div>
        )}
        {anexos.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {anexos.map((a) => (
              <EtiquetaRef key={a.ref.id} r={a.ref} rotulo={a.rotulo} onTirar={() => setAnexos((l) => l.filter((x) => x.ref.id !== a.ref.id))} />
            ))}
          </div>
        )}
        <textarea
          id={`equipe-composer-${chave}`}
          ref={ref}
          value={texto}
          disabled={!!desabilitado}
          onChange={(e) => { setTexto(e.target.value); detectarMencao(e.target.value, e.target.selectionStart); }}
          onClick={(e) => detectarMencao(texto, e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            // print colado (Ctrl+V) vira anexo; texto colado segue normal
            const files = [...e.clipboardData.files];
            if (files.length) { e.preventDefault(); adicionarArquivos(files); }
          }}
          onBlur={() => setTimeout(() => setMencao(null), 150)}
          placeholder={desabilitado ?? placeholder}
          rows={1}
          autoComplete="off"
          className="block max-h-60 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <button type="button" className={botao} onClick={() => envolver("*")} title="Negrito (Ctrl+B)" aria-label="Negrito" disabled={!!desabilitado}><Bold className="h-4 w-4" /></button>
          <button type="button" className={botao} onClick={() => envolver("_")} title="Itálico (Ctrl+I)" aria-label="Itálico" disabled={!!desabilitado}><Italic className="h-4 w-4" /></button>
          <button type="button" className={botao} onClick={() => envolver("`")} title="Código" aria-label="Código" disabled={!!desabilitado}><Code className="h-4 w-4" /></button>
          <button type="button" className={botao} onClick={() => { inserir("@"); setMencao({ termo: "", inicio: (ref.current?.selectionStart ?? texto.length) }); }} title="Mencionar" aria-label="Mencionar" disabled={!!desabilitado}><AtSign className="h-4 w-4" /></button>
          <EmojiPickerButton onEmojiSelect={inserir} disabled={!!desabilitado} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={botao} title="Anexar arquivo, ticket, cliente ou atendimento" aria-label="Anexar"
                disabled={!!desabilitado}>
                <Paperclip className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={() => inputArquivo.current?.click()}><FileUp className="mr-2 h-4 w-4" />Arquivo ou imagem</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAnexar("atendimento")}><Headset className="mr-2 h-4 w-4" />Atendimento (pedir ajuda)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAnexar("ticket")}><Ticket className="mr-2 h-4 w-4" />Ticket</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAnexar("cliente")}><Building2 className="mr-2 h-4 w-4" />Cliente</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ml-auto hidden text-[11px] text-muted-foreground lg:inline">Enter envia · Shift+Enter quebra linha</span>
          <button
            type="button"
            onClick={enviar}
            disabled={(!texto.trim() && anexos.length === 0 && arquivos.length === 0) || arquivos.some((a) => a.estado === "subindo") || !!desabilitado}
            className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
            aria-label="Enviar"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
      {/* montado só quando abre: fechado, ele reconfigurava a consulta a cada tecla */}
      {anexar && <AnexarDialog aberto tipoInicial={anexar} onFechar={() => setAnexar(null)} onEscolher={anexarRef} />}
      <input ref={inputArquivo} id={`equipe-arquivo-${chave}`} type="file" multiple hidden
        onChange={(e) => { adicionarArquivos([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </div>
  );
});
