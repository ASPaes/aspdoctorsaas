import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Search, Sparkles, Undo2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BotaoBarra } from "@/components/whatsapp/chat/email/EditorEmail";
import type { AnexoNaTela } from "@/components/whatsapp/chat/email/AnexosEmail";
import {
  ANEXO_MAX_ARQUIVOS,
  ANEXO_MAX_TOTAL_BYTES,
  formatarTamanho,
} from "@/components/whatsapp/chat/email/travaEnvioEmail";
import {
  camposDoTexto,
  campoAutomatico,
  escaparHtml,
  normalizarCampo,
  preencher,
  trocarDadosPorCampos,
} from "./camposMacro";
import { CORPO_PREVIA, MARCAS_PREVIA as MARCAS, htmlSeguro } from "./htmlSeguro";
import { useContextoMacro, type ContextoMacro } from "./useContextoMacro";
import { BUCKET_MACRO, macroVisivel, registrarUsoDaMacro, useEmailMacros, type EmailMacro } from "./useEmailMacros";

const MacroEmailDialog = lazy(() => import("./MacroEmailDialog"));

/**
 * Macros na tela Enviar e-mail (chat, chamado e jornada). Mockup "Macros de
 * E-mail" aprovado pelo Alexandre em 17/09/2026, com anexos, "Adaptar com IA"
 * e "Salvar este e-mail como macro" já nesta entrega.
 *
 * O hook guarda o estado e as duas telas (chat e chamado) só ligam os fios:
 * como aplicar o texto, os anexos e como pedir a adaptação à IA.
 */

type ResultadoIa = { ok: true; html: string } | { ok: false; mensagem: string };

interface Opcoes {
  open: boolean;
  contexto: ContextoMacro;
  corpoHtml: string;
  corpoVazio: boolean;
  assunto: string;
  anexos: AnexoNaTela[];
  /** põe o texto no editor (versão nova) e o assunto; a tela zera Sotaque/Ajustar e cancela geração em curso */
  aplicar: (r: { html: string; assunto: string }) => void;
  setAnexos: (atualizar: (lista: AnexoNaTela[]) => AnexoNaTela[]) => void;
  adaptarComIa: (html: string) => Promise<ResultadoIa>;
}

interface MacroUsada {
  titulo: string;
  htmlAntes: string;
  assuntoAntes: string;
  anexoIds: string[];
}

export function useMacroNoEmail(o: Opcoes) {
  const ctx = useContextoMacro(o.contexto, o.open);
  const lista = useEmailMacros(o.contexto.tenantId, o.open);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [usada, setUsada] = useState<MacroUsada | null>(null);
  /** uma macro entrou nesta abertura: a partir daí {{campo}} sobrando barra o envio */
  const [algumaUsada, setAlgumaUsada] = useState(false);
  const [adaptando, setAdaptando] = useState(false);
  const [salvarComo, setSalvarComo] = useState<{ assunto: string; corpo_html: string } | null>(null);

  useEffect(() => {
    if (!o.open) return;
    setPaletaAberta(false);
    setUsada(null);
    setAlgumaUsada(false);
    setAdaptando(false);
    setSalvarComo(null);
  }, [o.open]);

  const macros = useMemo(
    () =>
      (lista.data ?? []).filter((m) =>
        macroVisivel(m, ctx.meusSetores, o.contexto.departmentId, ctx.podeCadastrar),
      ),
    [lista.data, ctx.meusSetores, o.contexto.departmentId, ctx.podeCadastrar],
  );

  const usar = (macro: EmailMacro, livres: Record<string, string>, noFim: boolean) => {
    const corpo = preencher(macro.corpo_html, ctx.valores, livres, { html: true }).texto;
    const assuntoMacro = macro.assunto ? preencher(macro.assunto, ctx.valores, livres).texto : "";

    const html = noFim && !o.corpoVazio ? `${o.corpoHtml}${corpo}` : corpo;
    // no fim do texto, o assunto que já existe fica; trocando o texto, vale o da macro (se ela tiver)
    const assunto = noFim && o.assunto.trim() ? o.assunto : assuntoMacro || o.assunto;

    // anexos fixos da macro, respeitando os limites do e-mail
    let total = o.anexos.reduce((s, a) => s + a.tamanho, 0);
    let quantidade = o.anexos.length;
    const novos: AnexoNaTela[] = [];
    const fora: string[] = [];
    for (const a of macro.anexos) {
      if (quantidade >= ANEXO_MAX_ARQUIVOS || total + a.tamanho > ANEXO_MAX_TOTAL_BYTES) {
        fora.push(a.nome);
        continue;
      }
      quantidade += 1;
      total += a.tamanho;
      novos.push({
        id: `macro-${a.id}-${crypto.randomUUID()}`,
        nome: a.nome,
        tamanho: a.tamanho,
        mime: a.mime,
        status: "pronto",
        path: a.path,
        bucket: BUCKET_MACRO,
      });
    }
    if (fora.length) {
      toast.error(
        `Não coube no e-mail (${ANEXO_MAX_ARQUIVOS} arquivos ou ${formatarTamanho(ANEXO_MAX_TOTAL_BYTES)} somados): ${fora.join(", ")}.`,
        { duration: 10000 },
      );
    }

    // "Voltar ao texto anterior" volta para antes da PRIMEIRA macro desta sequência
    setUsada((antes) => ({
      titulo: macro.titulo,
      htmlAntes: antes?.htmlAntes ?? o.corpoHtml,
      assuntoAntes: antes?.assuntoAntes ?? o.assunto,
      anexoIds: [...(antes?.anexoIds ?? []), ...novos.map((n) => n.id)],
    }));
    setAlgumaUsada(true);
    o.aplicar({ html, assunto });
    if (novos.length) o.setAnexos((l) => [...l, ...novos]);
    setPaletaAberta(false);
    void registrarUsoDaMacro(macro.id);
  };

  const voltar = () => {
    if (!usada) return;
    o.aplicar({ html: usada.htmlAntes, assunto: usada.assuntoAntes });
    const ids = new Set(usada.anexoIds);
    o.setAnexos((l) => l.filter((a) => !ids.has(a.id)));
    setUsada(null);
  };

  const adaptar = async () => {
    if (adaptando || o.corpoVazio) return;
    setAdaptando(true);
    try {
      const r = await o.adaptarComIa(o.corpoHtml);
      if (r.ok === false) {
        toast.error(r.mensagem, { duration: 10000 });
        return;
      }
      o.aplicar({ html: r.html, assunto: o.assunto });
      toast.success("Macro adaptada ao caso. Confira o texto antes de enviar.");
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível adaptar o texto.");
    } finally {
      setAdaptando(false);
    }
  };

  /** texto novo da IA (Gerar novo): o "voltar" da macro não faz mais sentido */
  const esquecer = () => setUsada(null);

  /** {{campo}} que sobrou no assunto ou no texto depois de usar macro */
  const pendentes = (): string[] => (algumaUsada ? camposDoTexto(o.assunto, o.corpoHtml) : []);

  const abrirSalvarComo = () => {
    setPaletaAberta(false);
    setSalvarComo({
      assunto: trocarDadosPorCampos(o.assunto, ctx.valores),
      corpo_html: trocarDadosPorCampos(o.corpoHtml, ctx.valores, { html: true }),
    });
  };

  return {
    ...ctx,
    macros,
    carregandoMacros: lista.isLoading,
    paletaAberta,
    setPaletaAberta,
    usada,
    usar,
    voltar,
    adaptar,
    adaptando,
    esquecer,
    pendentes,
    corpoVazio: o.corpoVazio,
    tenantId: o.contexto.tenantId,
    salvarComo,
    abrirSalvarComo,
    fecharSalvarComo: () => setSalvarComo(null),
  };
}

export type MacroNoEmail = ReturnType<typeof useMacroNoEmail>;

/** "Data da visita" e "data da visita" são o mesmo campo livre */
const chave = normalizarCampo;

const semTags = (html: string) => html.replace(/<[^>]*>/g, " ");

function combina(m: EmailMacro, busca: string): boolean {
  const b = chave(busca.replace(/^\/+/, ""));
  if (!b) return true;
  return [m.titulo, m.atalho ?? "", m.categoria ?? "", m.assunto ?? "", semTags(m.corpo_html)].some((t) => chave(t).includes(b));
}

// ── botão e lista ────────────────────────────────────────────────────────────

export function BotaoMacros({ m, desabilitado }: { m: MacroNoEmail; desabilitado?: boolean }) {
  return (
    <>
      <Popover open={m.paletaAberta} onOpenChange={m.setPaletaAberta}>
        <PopoverTrigger asChild>
          <BotaoBarra
            titulo="Macros (ou digite / no começo de uma linha)"
            ativo={m.paletaAberta}
            desabilitado={desabilitado}
            className="gap-1.5 px-2 text-xs font-medium"
          >
            <Zap className="h-4 w-4" />
            Macros
            <kbd className="rounded border border-border px-1 text-[10px] font-semibold text-muted-foreground">/</kbd>
          </BotaoBarra>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={16}
          className="w-[min(780px,calc(100vw-2rem))] p-0"
          // fechando, o foco volta para o texto e não para o botão
          onCloseAutoFocus={(e) => e.preventDefault()}
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {m.paletaAberta && <PaletaMacros m={m} />}
        </PopoverContent>
      </Popover>
      {m.salvarComo && (
        <Suspense fallback={null}>
          <MacroEmailDialog
            open
            onOpenChange={(v) => !v && m.fecharSalvarComo()}
            tenantId={m.tenantId}
            macro={null}
            inicial={m.salvarComo}
            titulo="Salvar este e-mail como macro"
            aviso="Os dados deste cliente viraram campos automáticos. Os anexos do e-mail não entram: adicione aqui os que a macro deve levar sempre."
          />
        </Suspense>
      )}
    </>
  );
}

function PaletaMacros({ m }: { m: MacroNoEmail }) {
  const [busca, setBusca] = useState("");
  const [livres, setLivres] = useState<Record<string, string>>({});
  const listaRef = useRef<HTMLDivElement>(null);

  // grupos: mais usadas por você (até 3) e depois por categoria; buscando, lista única
  const grupos = useMemo(() => {
    const achadas = m.macros.filter((x) => combina(x, busca));
    if (busca.trim()) return [{ titulo: "Resultados", itens: achadas }];
    const minhas = [...achadas]
      .filter((x) => x.meusUsos > 0)
      .sort((a, b) => b.meusUsos - a.meusUsos)
      .slice(0, 3);
    const porCategoria = new Map<string, EmailMacro[]>();
    for (const x of achadas) {
      const cat = x.categoria?.trim() || "Sem categoria";
      porCategoria.set(cat, [...(porCategoria.get(cat) ?? []), x]);
    }
    const categorias = [...porCategoria.entries()]
      .sort(([a], [b]) => (a === "Sem categoria" ? 1 : b === "Sem categoria" ? -1 : a.localeCompare(b, "pt-BR")))
      .map(([titulo, itens]) => ({ titulo, itens }));
    return [...(minhas.length ? [{ titulo: "Mais usadas por você", itens: minhas }] : []), ...categorias];
  }, [m.macros, busca]);

  // a mesma macro pode aparecer em "mais usadas" e na categoria: a navegação usa a ordem da tela
  const ordem = useMemo(() => grupos.flatMap((g) => g.itens.map((i) => `${g.titulo}::${i.id}`)), [grupos]);
  const [posicao, setPosicao] = useState(0);
  useEffect(() => setPosicao(0), [busca]);
  const atual = ordem[Math.min(posicao, Math.max(0, ordem.length - 1))];
  const selecionada = m.macros.find((x) => x.id === atual?.split("::")[1]) ?? null;
  useEffect(() => {
    listaRef.current?.querySelector(`[data-pos="${posicao}"]`)?.scrollIntoView({ block: "nearest" });
  }, [posicao]);

  const previa = useMemo(() => {
    if (!selecionada) return null;
    const corpo = preencher(htmlSeguro(selecionada.corpo_html), m.valores, livres, { html: true, marcar: true });
    const assunto = selecionada.assunto
      ? preencher(escaparHtml(selecionada.assunto), m.valores, livres, { html: true, marcar: true })
      : null;
    // campos livres (e automáticos sem dado) na ordem em que aparecem
    const faltando = camposDoTexto(selecionada.assunto, selecionada.corpo_html).filter((c) => {
      const auto = campoAutomatico(c);
      return !(auto && m.valores[auto]);
    });
    return { corpo: corpo.texto, assunto: assunto?.texto ?? null, faltando };
  }, [selecionada, m.valores, livres]);

  const faltamPreencher = previa?.faltando.filter((c) => !(livres[chave(c)] ?? "").trim()) ?? [];

  const confirmar = (noFim: boolean) => {
    if (!selecionada) return;
    m.usar(selecionada, livres, noFim);
  };

  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPosicao((p) => Math.min(p + 1, ordem.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPosicao((p) => Math.max(p - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!selecionada) return;
      // falta campo: o Enter leva para o primeiro a preencher, em vez de inserir com buraco
      if (faltamPreencher.length) {
        document.getElementById(`macro-livre-${chave(faltamPreencher[0])}`)?.focus();
        return;
      }
      confirmar(false);
    }
  };

  let pos = -1;
  return (
    <div className="grid max-h-[min(520px,70vh)] grid-cols-1 overflow-hidden sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
      <div className="flex min-h-0 flex-col border-b border-border sm:border-b-0 sm:border-r">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={teclas}
            placeholder="Buscar macro por nome, atalho ou texto"
            aria-label="Buscar macro"
            className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
          />
        </div>
        <div ref={listaRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 max-h-[200px] sm:max-h-none">
          {m.carregandoMacros ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando macros...
            </div>
          ) : ordem.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              {m.macros.length === 0
                ? "Nenhuma macro de e-mail cadastrada. O cadastro fica em Configurações › Atendimento › Canais › E-mail › Macros."
                : "Nenhuma macro encontrada."}
            </p>
          ) : (
            grupos.map((g) => (
              <div key={g.titulo}>
                <div className="px-3 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.titulo}
                </div>
                {g.itens.map((x) => {
                  pos += 1;
                  const meu = pos;
                  const ativo = meu === Math.min(posicao, ordem.length - 1);
                  return (
                    <button
                      key={`${g.titulo}-${x.id}`}
                      type="button"
                      data-pos={meu}
                      onClick={() => setPosicao(meu)}
                      onDoubleClick={() => !faltamPreencher.length && confirmar(false)}
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 px-3 py-1.5 text-left text-sm",
                        ativo ? "bg-sky-500/10" : "hover:bg-muted",
                      )}
                    >
                      <span className="truncate">{x.titulo}</span>
                      {x.atalho && <span className="font-mono text-[11px] text-sky-600 dark:text-sky-400">/{x.atalho}</span>}
                      <span className="col-span-2 truncate text-[11.5px] text-muted-foreground">
                        {[
                          x.categoria,
                          x.meusUsos ? `${x.meusUsos} ${x.meusUsos === 1 ? "uso seu" : "usos seus"}` : null,
                          x.anexos.length ? `${x.anexos.length} ${x.anexos.length === 1 ? "anexo" : "anexos"}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ escolhe · Enter usa · Esc fecha</span>
          {m.podeCadastrar && (
            <button
              type="button"
              disabled={m.corpoVazio}
              onClick={m.abrirSalvarComo}
              className="font-medium text-sky-600 underline-offset-2 hover:underline disabled:opacity-40 dark:text-sky-400"
            >
              Salvar este e-mail como macro
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto overscroll-contain p-3.5 text-sm">
        {!selecionada || !previa ? (
          <p className="text-muted-foreground">Escolha uma macro para ver como ela fica para este cliente.</p>
        ) : (
          <>
            {previa.assunto && (
              <div className="text-[12.5px] text-muted-foreground">
                Assunto:{" "}
                <b className={cn("font-medium text-foreground", MARCAS)} dangerouslySetInnerHTML={{ __html: previa.assunto }} />
              </div>
            )}
            <div
              className={cn(
                "rounded-md border border-border bg-background px-3 py-2.5 leading-relaxed",
                CORPO_PREVIA,
                MARCAS,
              )}
              dangerouslySetInnerHTML={{ __html: previa.corpo || "<p></p>" }}
            />
            {previa.faltando.length > 0 && (
              <div className="space-y-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-800 dark:text-amber-200">
                <b>
                  {faltamPreencher.length === 0
                    ? "Tudo preenchido."
                    : faltamPreencher.length === 1
                      ? "Falta 1 campo:"
                      : `Faltam ${faltamPreencher.length} campos:`}
                </b>
                {previa.faltando.map((c) => (
                  <label key={chave(c)} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-[110px]">{c}</span>
                    <Input
                      id={`macro-livre-${chave(c)}`}
                      value={livres[chave(c)] ?? ""}
                      onChange={(e) => setLivres((l) => ({ ...l, [chave(c)]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const proximo = faltamPreencher.find((f) => chave(f) !== chave(c));
                        if (proximo) document.getElementById(`macro-livre-${chave(proximo)}`)?.focus();
                        else confirmar(false);
                      }}
                      className="h-7 min-w-[160px] flex-1 bg-background text-foreground"
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                    />
                  </label>
                ))}
              </div>
            )}
            {selecionada.anexos.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selecionada.anexos.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    {a.nome}
                    <span className="text-muted-foreground">entra junto</span>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-1">
              {!m.corpoVazio && (
                <Button type="button" size="sm" variant="outline" onClick={() => confirmar(true)}>
                  Inserir no fim do texto
                </Button>
              )}
              <Button type="button" size="sm" onClick={() => confirmar(false)}>
                {m.corpoVazio ? "Usar esta macro" : "Usar esta macro no lugar do texto"}
              </Button>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Verde: preenchido com os dados do cliente. Amarelo: complete aqui antes de usar; o que ficar em branco vai
              para o texto como {"{{campo}}"} e o envio avisa.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── faixa depois de usar ─────────────────────────────────────────────────────

export function FaixaMacro({ m, desabilitado }: { m: MacroNoEmail; desabilitado?: boolean }) {
  if (!m.usada) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-0.5 font-semibold text-sky-700 dark:text-sky-300">
        <Zap className="h-3.5 w-3.5" />
        Macro: {m.usada.titulo}
      </span>
      <button
        type="button"
        onClick={m.adaptar}
        disabled={desabilitado || m.adaptando || m.corpoVazio}
        className="inline-flex items-center gap-1 font-medium text-sky-600 underline-offset-2 hover:underline disabled:opacity-40 dark:text-sky-400"
        title="A IA encaixa o caso deste cliente na macro, sem mudar a estrutura. Usa o limite de IA."
      >
        {m.adaptando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {m.adaptando ? "Adaptando..." : "Adaptar com IA"}
      </button>
      <button
        type="button"
        onClick={m.voltar}
        disabled={desabilitado || m.adaptando}
        className="inline-flex items-center gap-1 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-40"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Voltar ao texto anterior
      </button>
    </div>
  );
}
