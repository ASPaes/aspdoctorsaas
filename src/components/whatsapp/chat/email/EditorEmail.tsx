import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { TextAlign } from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Check,
  ChevronDown,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Redo2,
  RemoveFormatting,
  Smile,
  SpellCheck,
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { normalizarUrl } from "./travaEnvioEmail";

export interface ConteudoEditor {
  html: string;
  /** texto puro, com linha em branco entre blocos: é a parte text/plain do e-mail */
  texto: string;
  vazio: boolean;
}

interface Props {
  id: string;
  /** HTML aplicado quando `versao` muda (IA gerou ou corrigiu, tela reabriu) */
  valor: string;
  versao: number;
  onChange: (conteudo: ConteudoEditor) => void;
  desabilitado?: boolean;
  placeholder?: string;
  onCorrigirGramatica?: () => void;
  corrigindo?: boolean;
  /** vai entre o texto e a barra (a frase da assinatura) */
  rodape?: ReactNode;
  /** botão Anexar, no começo do grupo da direita */
  acaoAnexar?: ReactNode;
}

/**
 * Corpo do e-mail do chat com a barra de formatação aprovada em 15/09/2026
 * (mockup "Editor do E-mail"). Anexo fica para a segunda entrega.
 *
 * Tudo o que a barra produz precisa sobreviver em cliente de e-mail: fonte,
 * tamanho e cor saem como `style` inline (TextStyle), alinhamento idem, e o
 * `htmlParaEmail` completa as margens na hora do envio. Título, código e
 * régua ficam desligados de propósito.
 */
const FONTES = [
  { rotulo: "Sans Serif", valor: "" },
  { rotulo: "Serif", valor: "Georgia, 'Times New Roman', serif" },
  { rotulo: "Largura fixa", valor: "'Courier New', Courier, monospace" },
];

const TAMANHOS = [
  { rotulo: "Pequeno", valor: "12px" },
  { rotulo: "Normal", valor: "" },
  { rotulo: "Grande", valor: "18px" },
  { rotulo: "Enorme", valor: "24px" },
];

// legíveis no fundo claro do e-mail e no escuro da tela
const CORES = [
  { rotulo: "Padrão", valor: "" },
  { rotulo: "Cinza", valor: "#64748B" },
  { rotulo: "Vermelho", valor: "#DC2626" },
  { rotulo: "Laranja", valor: "#EA580C" },
  { rotulo: "Verde", valor: "#16A34A" },
  { rotulo: "Azul", valor: "#2563EB" },
  { rotulo: "Roxo", valor: "#7C3AED" },
];

const ALINHAMENTOS = [
  { rotulo: "À esquerda", valor: "left", Icone: AlignLeft },
  { rotulo: "Centralizado", valor: "center", Icone: AlignCenter },
  { rotulo: "À direita", valor: "right", Icone: AlignRight },
  { rotulo: "Justificado", valor: "justify", Icone: AlignJustify },
];

const extrair = (e: Editor): ConteudoEditor => ({
  html: e.getHTML(),
  texto: e.getText({ blockSeparator: "\n\n" }).trim(),
  vazio: e.isEmpty,
});

const CONTEUDO = cn(
  "text-sm leading-relaxed text-foreground",
  "[&_.ProseMirror]:min-h-[220px] [&_.ProseMirror]:px-3.5 [&_.ProseMirror]:py-3 [&_.ProseMirror]:outline-none",
  "[&_.ProseMirror_p]:my-0 [&_.ProseMirror_p+p]:mt-2.5",
  "[&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5",
  "[&_.ProseMirror_ol]:my-2 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5",
  "[&_.ProseMirror_blockquote]:my-2 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-border [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground",
  "[&_.ProseMirror_a]:text-sky-600 [&_.ProseMirror_a]:underline dark:[&_.ProseMirror_a]:text-sky-400",
  "[&_.ProseMirror_p.is-editor-empty:first-child]:before:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child]:before:float-left [&_.ProseMirror_p.is-editor-empty:first-child]:before:h-0 [&_.ProseMirror_p.is-editor-empty:first-child]:before:text-muted-foreground [&_.ProseMirror_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
);

export function EditorEmail({
  id,
  valor,
  versao,
  onChange,
  desabilitado = false,
  placeholder = "",
  onCorrigirGramatica,
  corrigindo = false,
  rodape,
  acaoAnexar,
}: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const [sublinharErros, setSublinharErros] = useState(true);
  const sublinharRef = useRef(sublinharErros);
  sublinharRef.current = sublinharErros;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        },
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["paragraph"] }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
    ],
    content: valor,
    editorProps: {
      // função: o corretor do navegador liga e desliga sem recriar o editor
      attributes: () => ({
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Corpo do e-mail",
        lang: "pt-BR",
        spellcheck: sublinharRef.current ? "true" : "false",
      }),
    },
    onUpdate: ({ editor: e }) => onChangeRef.current(extrair(e)),
  });

  /** redesenha atributos e placeholder sem mexer no conteúdo */
  const atualizarVista = () => {
    if (!editor || editor.isDestroyed) return;
    try {
      editor.view.dispatch(editor.state.tr);
    } catch {
      // vista ainda não montada: o próximo ciclo pega o valor atual
    }
  };

  // conteúdo vindo de fora (IA gerou ou corrigiu, tela reabriu) não conta como edição
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(valor, { emitUpdate: false });
    onChangeRef.current(extrair(editor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, versao]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!desabilitado);
  }, [editor, desabilitado]);

  useEffect(atualizarVista, [editor, sublinharErros, placeholder]); // eslint-disable-line react-hooks/exhaustive-deps

  const estado = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const estilo = e.getAttributes("textStyle");
      return {
        negrito: e.isActive("bold"),
        italico: e.isActive("italic"),
        sublinhado: e.isActive("underline"),
        tachado: e.isActive("strike"),
        marcadores: e.isActive("bulletList"),
        numerada: e.isActive("orderedList"),
        citacao: e.isActive("blockquote"),
        link: e.isActive("link"),
        fonte: (estilo.fontFamily as string) || "",
        tamanho: (estilo.fontSize as string) || "",
        cor: (estilo.color as string) || "",
        alinhamento: ALINHAMENTOS.find((a) => a.valor !== "left" && e.isActive({ textAlign: a.valor }))?.valor ?? "left",
        podeDesfazer: e.can().undo(),
        podeRefazer: e.can().redo(),
        vazio: e.isEmpty,
      };
    },
  });

  const bloqueado = desabilitado || !editor;
  const cmd = () => editor!.chain().focus();
  const AlinhamentoAtual = ALINHAMENTOS.find((a) => a.valor === estado?.alinhamento)?.Icone ?? AlignLeft;
  // menu fechando devolve o foco ao botão; o comando é que devolve ao texto
  const semRefoco = (e: Event) => e.preventDefault();

  return (
    <div>
      <div
        className={cn(
          "max-h-[420px] overflow-y-auto rounded-md border border-input bg-background",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
          desabilitado && "opacity-60",
          CONTEUDO,
        )}
      >
        <EditorContent editor={editor} />
      </div>

      {rodape}

      <div
        role="toolbar"
        aria-label="Formatação do e-mail"
        className="mt-3 flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-1.5"
      >
        <BotaoBarra titulo="Desfazer" desabilitado={bloqueado || !estado?.podeDesfazer} onClick={() => cmd().undo().run()}>
          <Undo2 className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra titulo="Refazer" desabilitado={bloqueado || !estado?.podeRefazer} onClick={() => cmd().redo().run()}>
          <Redo2 className="h-4 w-4" />
        </BotaoBarra>

        <Divisor />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <BotaoBarra titulo="Fonte" desabilitado={bloqueado} className="border border-border bg-background px-2 text-xs">
              {FONTES.find((f) => f.valor === estado?.fonte)?.rotulo ?? "Sans Serif"}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </BotaoBarra>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={semRefoco}>
            {FONTES.map((f) => (
              <DropdownMenuItem
                key={f.rotulo}
                onSelect={() => (f.valor ? cmd().setFontFamily(f.valor).run() : cmd().unsetFontFamily().run())}
                style={{ fontFamily: f.valor || "Arial, Helvetica, sans-serif" }}
              >
                <Check className={cn("mr-2 h-3.5 w-3.5", (estado?.fonte ?? "") === f.valor ? "opacity-100" : "opacity-0")} />
                {f.rotulo}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <BotaoBarra titulo="Tamanho da letra" desabilitado={bloqueado} className="ml-1 border border-border bg-background px-2 text-xs">
              {TAMANHOS.find((t) => t.valor === estado?.tamanho)?.rotulo ?? "Normal"}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </BotaoBarra>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={semRefoco}>
            {TAMANHOS.map((t) => (
              <DropdownMenuItem
                key={t.rotulo}
                onSelect={() => (t.valor ? cmd().setFontSize(t.valor).run() : cmd().unsetFontSize().run())}
              >
                <Check className={cn("mr-2 h-3.5 w-3.5", (estado?.tamanho ?? "") === t.valor ? "opacity-100" : "opacity-0")} />
                <span style={{ fontSize: t.valor || "14px" }}>{t.rotulo}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Divisor />

        <BotaoBarra titulo="Negrito" ativo={estado?.negrito} desabilitado={bloqueado} onClick={() => cmd().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra titulo="Itálico" ativo={estado?.italico} desabilitado={bloqueado} onClick={() => cmd().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra titulo="Sublinhado" ativo={estado?.sublinhado} desabilitado={bloqueado} onClick={() => cmd().toggleUnderline().run()}>
          <Underline className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra titulo="Tachado" ativo={estado?.tachado} desabilitado={bloqueado} onClick={() => cmd().toggleStrike().run()}>
          <Strikethrough className="h-4 w-4" />
        </BotaoBarra>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <BotaoBarra titulo="Cor do texto" desabilitado={bloqueado} className="relative">
              <Baseline className="h-4 w-4" />
              <span
                className="absolute inset-x-1.5 bottom-1 h-[3px] rounded-full"
                style={{ background: estado?.cor || "currentColor" }}
                aria-hidden
              />
            </BotaoBarra>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={semRefoco} className="w-44">
            {CORES.map((c) => (
              <DropdownMenuItem
                key={c.rotulo}
                onSelect={() => (c.valor ? cmd().setColor(c.valor).run() : cmd().unsetColor().run())}
              >
                <span
                  className="mr-2 h-3.5 w-3.5 rounded-full border border-border"
                  style={{ background: c.valor || "hsl(var(--foreground))" }}
                  aria-hidden
                />
                <span className="flex-1">{c.rotulo}</span>
                {(estado?.cor ?? "").toLowerCase() === c.valor.toLowerCase() && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Divisor />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <BotaoBarra titulo="Alinhamento" desabilitado={bloqueado}>
              <AlinhamentoAtual className="h-4 w-4" />
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </BotaoBarra>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={semRefoco}>
            {ALINHAMENTOS.map(({ rotulo, valor: alinhamento, Icone }) => (
              <DropdownMenuItem key={alinhamento} onSelect={() => cmd().setTextAlign(alinhamento).run()}>
                <Icone className="mr-2 h-4 w-4" />
                <span className="flex-1">{rotulo}</span>
                {estado?.alinhamento === alinhamento && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <BotaoBarra titulo="Lista numerada" ativo={estado?.numerada} desabilitado={bloqueado} onClick={() => cmd().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra titulo="Lista com marcadores" ativo={estado?.marcadores} desabilitado={bloqueado} onClick={() => cmd().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra titulo="Citação" ativo={estado?.citacao} desabilitado={bloqueado} onClick={() => cmd().toggleBlockquote().run()}>
          <TextQuote className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra
          titulo="Remover formatação"
          desabilitado={bloqueado}
          onClick={() => cmd().unsetAllMarks().clearNodes().unsetTextAlign().run()}
        >
          <RemoveFormatting className="h-4 w-4" />
        </BotaoBarra>

        <div className="ml-auto flex items-center gap-0.5">
          <Divisor />
          {acaoAnexar}
          {editor && <BotaoLink editor={editor} ativo={!!estado?.link} desabilitado={bloqueado} />}

          <BotaoEmoji desabilitado={bloqueado} onEscolher={(emoji) => cmd().insertContent(emoji).run()} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <BotaoBarra titulo="Ortografia" desabilitado={!editor} className="gap-1.5 px-2 text-xs font-medium">
                {corrigindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <SpellCheck className="h-4 w-4" />}
                Ortografia
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </BotaoBarra>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72" onCloseAutoFocus={semRefoco}>
              <DropdownMenuCheckboxItem checked={sublinharErros} onCheckedChange={(v) => setSublinharErros(v === true)}>
                Sublinhar erros ao digitar
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem
                disabled={!onCorrigirGramatica || corrigindo || desabilitado || !!estado?.vazio}
                onSelect={() => onCorrigirGramatica?.()}
                className="justify-between"
              >
                Corrigir gramática do texto
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  usa IA
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal leading-snug text-muted-foreground">
                Clique com o botão direito na palavra sublinhada para ver as sugestões do navegador.
              </DropdownMenuLabel>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function Divisor() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
}

type BotaoBarraProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  titulo: string;
  ativo?: boolean;
  desabilitado?: boolean;
};

/**
 * mousedown com preventDefault: clicar na barra não tira a seleção do texto.
 * forwardRef e ...resto: é o que deixa servir de gatilho de menu (asChild).
 */
export const BotaoBarra = forwardRef<HTMLButtonElement, BotaoBarraProps>(function BotaoBarra(
  { titulo, ativo, desabilitado, className, children, onMouseDown, ...resto },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo === undefined ? undefined : ativo}
      disabled={desabilitado}
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown?.(e);
      }}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-sm text-foreground transition-colors",
        "hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        ativo && "bg-background shadow-sm",
        className,
      )}
      {...resto}
    >
      {children}
    </button>
  );
});

function BotaoLink({ editor, ativo, desabilitado }: { editor: Editor; ativo: boolean; desabilitado: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [endereco, setEndereco] = useState("");
  const [comSelecao, setComSelecao] = useState(false);

  const alternar = (abrir: boolean) => {
    if (abrir) {
      const { from, to, empty } = editor.state.selection;
      setComSelecao(!empty || editor.isActive("link"));
      setTexto(editor.state.doc.textBetween(from, to, " "));
      setEndereco((editor.getAttributes("link").href as string) ?? "");
    }
    setAberto(abrir);
  };

  const aplicar = () => {
    const href = normalizarUrl(endereco);
    const cadeia = editor.chain().focus();
    if (!href) {
      cadeia.extendMarkRange("link").unsetLink().run();
    } else if (comSelecao) {
      cadeia.extendMarkRange("link").setLink({ href }).run();
    } else {
      cadeia.insertContent({ type: "text", text: texto.trim() || href, marks: [{ type: "link", attrs: { href } }] }).run();
    }
    setAberto(false);
  };

  return (
    <Popover open={aberto} onOpenChange={alternar}>
      <PopoverTrigger asChild>
        <BotaoBarra titulo="Inserir link" ativo={ativo} desabilitado={desabilitado}>
          <Link2 className="h-4 w-4" />
        </BotaoBarra>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3" onCloseAutoFocus={(e) => e.preventDefault()}>
        {!comSelecao && (
          <div className="space-y-1.5">
            <Label htmlFor="envio-link-texto" className="text-xs">Texto</Label>
            <Input
              id="envio-link-texto"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Ex.: Manual do Gula Menu"
              className="h-8"
              autoComplete="off"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="envio-link-endereco" className="text-xs">Endereço</Label>
          <Input
            id="envio-link-endereco"
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                aplicar();
              }
            }}
            placeholder="https://"
            className="h-8"
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          {ativo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setAberto(false);
              }}
            >
              Remover
            </Button>
          )}
          <Button type="button" size="sm" onClick={aplicar} disabled={!endereco.trim() && !ativo}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BotaoEmoji({ desabilitado, onEscolher }: { desabilitado: boolean; onEscolher: (emoji: string) => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <BotaoBarra titulo="Inserir emoji" desabilitado={desabilitado}>
          <Smile className="h-4 w-4" />
        </BotaoBarra>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto border-0 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
        <EmojiPicker
          onEmojiClick={(dados: EmojiClickData) => {
            onEscolher(dados.emoji);
            setAberto(false);
          }}
          autoFocusSearch={false}
          theme={Theme.AUTO}
          searchPlaceHolder="Buscar emoji..."
          previewConfig={{ showPreview: false }}
          height={360}
          width={320}
        />
      </PopoverContent>
    </Popover>
  );
}
