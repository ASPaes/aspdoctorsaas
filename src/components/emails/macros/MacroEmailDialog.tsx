import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { Eye, FileText, Loader2, Paperclip, Plus, Search, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { EditorEmail } from "@/components/whatsapp/chat/email/EditorEmail";
import { SetoresMultiSelect } from "@/components/configuracoes/email/SetoresMultiSelect";
import {
  ANEXO_ACCEPT,
  ANEXO_MAX_ARQUIVOS,
  ANEXO_MAX_TOTAL_BYTES,
  anexoPermitido,
  formatarTamanho,
} from "@/components/whatsapp/chat/email/travaEnvioEmail";
import { DESCRICAO_CAMPO, GRUPOS_CAMPOS, escaparHtml, preencher } from "./camposMacro";
import { CORPO_PREVIA, MARCAS_PREVIA, htmlSeguro } from "./htmlSeguro";
import { useContextoMacro } from "./useContextoMacro";
import {
  baixarAnexoDaMacro,
  mensagemDaMacro,
  normalizarAtalho,
  useEmailMacros,
  useSalvarMacro,
  type AnexoMacro,
  type ArquivoNovo,
  type EmailMacro,
} from "./useEmailMacros";

/**
 * Nova macro, editar macro e "Salvar este e-mail como macro" (mockup "Macros
 * de E-mail", 17/09/2026). O texto é escrito no mesmo editor do e-mail, e os
 * campos automáticos entram com um clique no lugar do cursor, no assunto ou no
 * texto (o último que teve foco).
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  /** null = nova */
  macro: EmailMacro | null;
  /** texto de partida da macro nova (salvar e-mail como macro, duplicar) */
  inicial?: { titulo?: string; assunto: string; corpo_html: string };
  titulo?: string;
  aviso?: string;
}

type Alvo = "assunto" | "corpo";

export default function MacroEmailDialog({ open, onOpenChange, tenantId, macro, inicial, titulo, aviso }: Props) {
  const { salvar } = useSalvarMacro();
  const macros = useEmailMacros(tenantId, open);
  const setores = useQuery({
    queryKey: ["email-macro-setores", tenantId],
    enabled: open && !!tenantId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const [nome, setNome] = useState("");
  const [atalho, setAtalho] = useState("");
  const [categoria, setCategoria] = useState("");
  const [assunto, setAssunto] = useState("");
  const [corpoHtml, setCorpoHtml] = useState("");
  const [corpoVazio, setCorpoVazio] = useState(true);
  const [versao, setVersao] = useState(0);
  const [setoresIds, setSetoresIds] = useState<string[]>([]);
  const [ativo, setAtivo] = useState(true);
  const [mantidos, setMantidos] = useState<AnexoMacro[]>([]);
  const [novos, setNovos] = useState<ArquivoNovo[]>([]);
  const [livre, setLivre] = useState("");
  const [clientePrevia, setClientePrevia] = useState<{ id: string; nome: string } | null>(null);
  /**
   * Qual abertura já teve o texto preparado. O editor só monta depois disso,
   * já com o texto: montado antes, o aviso de "mudou" do editor vazio chegava
   * atrasado e apagava o texto da macro (a mesma corrida do Encaminhar, 16/09).
   */
  const [preparado, setPreparado] = useState(0);

  const editorRef = useRef<Editor | null>(null);
  const assuntoRef = useRef<HTMLInputElement>(null);
  const alvoRef = useRef<Alvo>("corpo");
  const entradaArquivo = useRef<HTMLInputElement>(null);

  // cada abertura começa do que está salvo (ou do texto de partida)
  useEffect(() => {
    if (!open) return;
    setNome(macro?.titulo ?? inicial?.titulo ?? "");
    setAtalho(macro?.atalho ?? "");
    setCategoria(macro?.categoria ?? "");
    setAssunto(macro?.assunto ?? inicial?.assunto ?? "");
    setCorpoHtml(macro?.corpo_html ?? inicial?.corpo_html ?? "");
    setVersao((v) => v + 1);
    setSetoresIds(macro?.department_ids ?? []);
    setAtivo(macro?.ativo ?? true);
    setMantidos(macro?.anexos ?? []);
    setNovos([]);
    setLivre("");
    setClientePrevia(null);
    alvoRef.current = "corpo";
    setPreparado((p) => p + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, macro?.id]);

  const categorias = useMemo(
    () => [...new Set((macros.data ?? []).map((m) => m.categoria?.trim()).filter(Boolean) as string[])].sort(),
    [macros.data],
  );

  const inserirCampo = (campo: string) => {
    const texto = `{{${campo}}}`;
    if (alvoRef.current === "assunto" && assuntoRef.current) {
      const el = assuntoRef.current;
      const de = el.selectionStart ?? assunto.length;
      const ate = el.selectionEnd ?? de;
      const novo = `${assunto.slice(0, de)}${texto}${assunto.slice(ate)}`;
      setAssunto(novo.slice(0, 300));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(de + texto.length, de + texto.length);
      });
      return;
    }
    editorRef.current?.chain().focus().insertContent(texto).run();
  };

  const inserirLivre = () => {
    const n = livre.replace(/[{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!n) return;
    inserirCampo(n);
    setLivre("");
  };

  const totalAnexos = mantidos.reduce((s, a) => s + a.tamanho, 0) + novos.reduce((s, a) => s + a.arquivo.size, 0);
  const qtdAnexos = mantidos.length + novos.length;

  const adicionarArquivos = (arquivos: File[]) => {
    const recusados: string[] = [];
    let total = totalAnexos;
    let qtd = qtdAnexos;
    const aceitos: ArquivoNovo[] = [];
    for (const arquivo of arquivos) {
      if (!anexoPermitido(arquivo.type, arquivo.name)) recusados.push(`${arquivo.name} (tipo não aceito)`);
      else if (qtd >= ANEXO_MAX_ARQUIVOS) recusados.push(`${arquivo.name} (passou de ${ANEXO_MAX_ARQUIVOS} arquivos)`);
      else if (total + arquivo.size > ANEXO_MAX_TOTAL_BYTES) {
        recusados.push(`${arquivo.name} (passou de ${formatarTamanho(ANEXO_MAX_TOTAL_BYTES)} somados)`);
      } else {
        total += arquivo.size;
        qtd += 1;
        aceitos.push({ chave: crypto.randomUUID(), arquivo });
      }
    }
    if (recusados.length) toast.error(`Não foi anexado: ${recusados.join("; ")}.`, { duration: 10000 });
    if (aceitos.length) setNovos((l) => [...l, ...aceitos]);
  };

  const abrirAnexo = async (a: AnexoMacro) => {
    try {
      const blob = await baixarAnexoDaMacro(a.path);
      const url = URL.createObjectURL(new File([blob], a.nome, { type: a.mime || blob.type }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível abrir o anexo.");
    }
  };

  const gravar = async () => {
    const faltando: string[] = [];
    if (!nome.trim()) faltando.push("o nome");
    if (corpoVazio) faltando.push("o texto");
    if (faltando.length) {
      toast.error(`Falta preencher ${faltando.join(" e ")}.`);
      return;
    }
    try {
      await salvar.mutateAsync({
        id: macro?.id,
        tenant_id: tenantId,
        titulo: nome,
        atalho: normalizarAtalho(atalho) || null,
        categoria,
        assunto,
        corpo_html: corpoHtml,
        department_ids: setoresIds,
        ativo,
        anexosMantidos: mantidos,
        arquivosNovos: novos,
      });
      toast.success(macro ? "Macro salva." : "Macro criada. Ela já aparece no botão Macros do Enviar e-mail.");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(mensagemDaMacro(err), { duration: 10000 });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !salvar.isPending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="static m-0 px-6 pt-5 pb-4 pr-12 border-b border-border space-y-1 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            {titulo ?? (macro ? "Editar macro" : "Nova macro")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {aviso ?? "Os campos automáticos entram com um clique e são trocados pelos dados do cliente na hora de usar."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div className="space-y-3 min-w-0">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="macro-nome" className="text-xs font-normal text-muted-foreground">Nome</Label>
                  <Input id="macro-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} className="h-9" autoComplete="off" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="macro-atalho" className="text-xs font-normal text-muted-foreground">Atalho (opcional)</Label>
                  <div className="flex h-9 items-center rounded-md border border-input bg-background pl-2.5 text-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                    <span className="font-mono text-muted-foreground">/</span>
                    <input
                      id="macro-atalho"
                      value={atalho}
                      onChange={(e) => setAtalho(normalizarAtalho(e.target.value))}
                      className="h-full w-full bg-transparent px-1 font-mono outline-none"
                      placeholder="boasvindas"
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="macro-categoria" className="text-xs font-normal text-muted-foreground">Categoria (opcional)</Label>
                  <Input
                    id="macro-categoria"
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                    maxLength={60}
                    list="macro-categorias"
                    className="h-9"
                    placeholder="Financeiro, Implantação..."
                    autoComplete="off"
                  />
                  <datalist id="macro-categorias">
                    {categorias.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="macro-assunto" className="text-xs font-normal text-muted-foreground">
                  Assunto (opcional: sem ele, fica o assunto que já estiver na tela)
                </Label>
                <Input
                  id="macro-assunto"
                  ref={assuntoRef}
                  value={assunto}
                  onChange={(e) => setAssunto(e.target.value)}
                  onFocus={() => (alvoRef.current = "assunto")}
                  maxLength={300}
                  className="h-9"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
              </div>

              <div className="space-y-1" onFocusCapture={() => (alvoRef.current = "corpo")}>
                <Label htmlFor="macro-corpo" className="text-xs font-normal text-muted-foreground">Texto</Label>
                {preparado > 0 && (
                <EditorEmail
                  key={preparado}
                  id="macro-corpo"
                  valor={corpoHtml}
                  versao={versao}
                  onChange={(c) => {
                    setCorpoHtml(c.html);
                    setCorpoVazio(c.vazio);
                  }}
                  desabilitado={salvar.isPending}
                  placeholder="Escreva a macro. Os campos automáticos, ao lado, entram onde estiver o cursor."
                  destacarCampos
                  onEditor={(e) => (editorRef.current = e)}
                  acaoAnexar={
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => entradaArquivo.current?.click()}
                      disabled={salvar.isPending}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium hover:bg-background disabled:opacity-40"
                    >
                      <Paperclip className="h-4 w-4" />
                      Anexar
                    </button>
                  }
                />
                )}
                <input
                  ref={entradaArquivo}
                  type="file"
                  multiple
                  accept={ANEXO_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const arquivos = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (arquivos.length) adicionarArquivos(arquivos);
                  }}
                />
                {qtdAnexos > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1.5">
                    {mantidos.map((a) => (
                      <CartaoAnexo
                        key={a.id}
                        nome={a.nome}
                        tamanho={a.tamanho}
                        onVer={() => abrirAnexo(a)}
                        onTirar={() => setMantidos((l) => l.filter((x) => x.id !== a.id))}
                      />
                    ))}
                    {novos.map((n) => (
                      <CartaoAnexo
                        key={n.chave}
                        nome={n.arquivo.name}
                        tamanho={n.arquivo.size}
                        novo
                        onTirar={() => setNovos((l) => l.filter((x) => x.chave !== n.chave))}
                      />
                    ))}
                    <span className="text-xs text-muted-foreground">
                      {qtdAnexos} de {ANEXO_MAX_ARQUIVOS} · {formatarTamanho(totalAnexos)} de {formatarTamanho(ANEXO_MAX_TOTAL_BYTES)}
                    </span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Os anexos da macro entram junto no e-mail toda vez que ela for usada.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="space-y-1">
                  <Label className="text-xs font-normal text-muted-foreground">Setores que usam (vazio = todos)</Label>
                  <SetoresMultiSelect setores={setores.data ?? []} value={setoresIds} onChange={setSetoresIds} />
                </div>
                <label className="flex h-10 items-center gap-2 text-sm">
                  <Switch checked={ativo} onCheckedChange={setAtivo} />
                  Ativa
                </label>
              </div>
            </div>

            <div className="space-y-3 min-w-0">
              <div className="rounded-lg border border-border bg-card p-3 space-y-2.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Campos automáticos</h4>
                {GRUPOS_CAMPOS.map((g) => (
                  <div key={g.grupo} className="space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">{g.grupo}</span>
                    <div className="flex flex-wrap gap-1">
                      {g.campos.map((c) => (
                        <button
                          key={c}
                          type="button"
                          title={DESCRICAO_CAMPO[c]}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => inserirCampo(c)}
                          className="rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Campo para preencher na hora</span>
                  <div className="flex gap-1.5">
                    <Input
                      value={livre}
                      onChange={(e) => setLivre(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          inserirLivre();
                        }
                      }}
                      placeholder="Ex.: Data da visita"
                      className="h-8 text-xs"
                      maxLength={60}
                      autoComplete="off"
                    />
                    <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onMouseDown={(e) => e.preventDefault()} onClick={inserirLivre} disabled={!livre.trim()}>
                      <Plus className="h-3.5 w-3.5" />
                      Inserir
                    </Button>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Quem usar a macro completa esse campo na prévia, antes de inserir.
                  </p>
                </div>
              </div>

              <PreviaComCliente
                tenantId={tenantId}
                cliente={clientePrevia}
                onCliente={setClientePrevia}
                assunto={assunto}
                corpoHtml={corpoHtml}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={gravar} disabled={salvar.isPending} className="gap-2">
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {macro ? "Salvar" : "Criar macro"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CartaoAnexo({
  nome,
  tamanho,
  novo,
  onVer,
  onTirar,
}: {
  nome: string;
  tamanho: number;
  novo?: boolean;
  onVer?: () => void;
  onTirar: () => void;
}) {
  return (
    <span className="flex max-w-full items-center gap-2 rounded-md border border-border bg-card py-1 pl-2 pr-1 text-xs" title={nome}>
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate max-w-[180px]">{nome}</span>
      <span className="text-muted-foreground">{novo ? "novo · " : ""}{formatarTamanho(tamanho)}</span>
      {onVer && (
        <button type="button" onClick={onVer} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Ver ${nome}`}>
          <Eye className="h-3.5 w-3.5" />
        </button>
      )}
      <button type="button" onClick={onTirar} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Tirar ${nome}`}>
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/** a macro preenchida com um cliente de verdade, escolhido pela busca */
function PreviaComCliente({
  tenantId,
  cliente,
  onCliente,
  assunto,
  corpoHtml,
}: {
  tenantId: string;
  cliente: { id: string; nome: string } | null;
  onCliente: (c: { id: string; nome: string } | null) => void;
  assunto: string;
  corpoHtml: string;
}) {
  const [busca, setBusca] = useState("");
  const termo = busca.replace(/[%,()*]/g, " ").trim();
  const resultados = useQuery({
    queryKey: ["email-macro-previa-clientes", tenantId, termo],
    enabled: termo.length >= 2 && !cliente,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("clientes" as any) as any)
        .select("id, codigo_sequencial, nome_fantasia, razao_social")
        .eq("tenant_id", tenantId)
        .or(`nome_fantasia.ilike.%${termo}%,razao_social.ilike.%${termo}%`)
        .order("nome_fantasia")
        .limit(8);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const ctx = useContextoMacro(
    {
      tenantId,
      clienteId: cliente?.id ?? null,
      departmentId: null,
      contatoNome: null,
      numeroAtendimento: null,
      numeroChamado: null,
      assuntoChamado: null,
    },
    !!cliente,
  );

  const previa = useMemo(() => {
    if (!cliente) return null;
    return {
      assunto: assunto ? preencher(escaparHtml(assunto), ctx.valores, {}, { html: true, marcar: true }).texto : "",
      corpo: preencher(htmlSeguro(corpoHtml), ctx.valores, {}, { html: true, marcar: true }).texto,
    };
  }, [cliente, assunto, corpoHtml, ctx.valores]);

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prévia com um cliente</h4>
      {cliente ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate font-medium">{cliente.nome}</span>
          <button type="button" onClick={() => onCliente(null)} className="text-xs text-sky-600 hover:underline dark:text-sky-400">
            Trocar
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente pelo nome"
            className="h-8 pl-8 text-xs"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
          />
          {termo.length >= 2 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover">
              {resultados.isLoading ? (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">Buscando...</p>
              ) : (resultados.data ?? []).length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
              ) : (
                (resultados.data ?? []).map((c) => {
                  const n = `#${c.codigo_sequencial} ${c.nome_fantasia || c.razao_social || ""}`.trim();
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onCliente({ id: c.id, nome: n });
                        setBusca("");
                      }}
                      className="block w-full truncate px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      {n}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
      {previa && (
        <div className="space-y-1.5 text-[13px]">
          {previa.assunto && (
            <div className={cn("text-xs text-muted-foreground", MARCAS_PREVIA)}>
              Assunto: <b className="font-medium text-foreground" dangerouslySetInnerHTML={{ __html: previa.assunto }} />
            </div>
          )}
          <div
            className={cn(
              "rounded-md border border-border bg-background px-3 py-2 leading-relaxed",
              CORPO_PREVIA,
              MARCAS_PREVIA,
            )}
            dangerouslySetInnerHTML={{ __html: previa.corpo || "<p></p>" }}
          />
          <p className="text-[11px] text-muted-foreground">
            Verde: preenchido com o cadastro. Amarelo: vem do atendimento, do chamado ou é preenchido na hora.
          </p>
        </div>
      )}
    </div>
  );
}
