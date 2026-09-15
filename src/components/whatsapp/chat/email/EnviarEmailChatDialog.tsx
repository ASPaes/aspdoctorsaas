import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Mail, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import type { ConversationWithContact } from "../../hooks/useWhatsAppConversations";
import {
  corrigirEmailChat,
  enviarEmailChat,
  gerarEmailChat,
  useClienteDoEmail,
  useContasDeEnvio,
  type SugestaoEmail,
} from "./useEmailChatDados";
import { EditorEmail } from "./EditorEmail";
import { BotaoAnexar, ListaAnexos, type AnexoNaTela } from "./AnexosEmail";
import { uploadChatMedia } from "../../hooks/uploadChatMedia";
import {
  assuntoComReferencia,
  referenciaDoAssunto,
  ANEXO_MAX_ARQUIVOS,
  ANEXO_MAX_TOTAL_BYTES,
  anexoPermitido,
  formatarTamanho,
  conferirTrava,
  emailValido,
  normalizarQuantidade,
  OPCOES_PADRAO,
  QUANTIDADE_MAXIMA,
  htmlParaEmail,
  textoParaParagrafos,
  TONS,
  type OpcoesGeracao,
  type TomEmail,
} from "./travaEnvioEmail";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationWithContact;
}

/**
 * Tela "Enviar e-mail" aberta pelo cabeçalho do chat e pelo painel Detalhes.
 * Desenho aprovado pelo Alexandre em 14/09/2026 (mockup "E-mail pelo Chat").
 *
 * Gerar novo chama a `gerar-email-chat`, e a tela abre já gerada em Último
 * atendimento e Formal. Enviar vai pela `send-email` com origem 'chat'.
 */
export function EnviarEmailChatDialog({ open, onOpenChange, conversation }: Props) {
  const { user, profile } = useAuth();
  const contasQuery = useContasDeEnvio(conversation.tenant_id, user?.id ?? null, profile?.is_super_admin === true, open);
  const clienteQuery = useClienteDoEmail(conversation, open);

  const [opcoes, setOpcoes] = useState<OpcoesGeracao>(OPCOES_PADRAO);
  const [gerado, setGerado] = useState<OpcoesGeracao>(OPCOES_PADRAO);
  const [contaId, setContaId] = useState<string>("");
  const [para, setPara] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [mostrarCc, setMostrarCc] = useState(false);
  const [mostrarCco, setMostrarCco] = useState(false);
  const [assunto, setAssunto] = useState("");
  /** texto puro do editor: validação e parte text/plain do e-mail */
  const [corpo, setCorpo] = useState("");
  /** HTML do editor: o que vai no envio */
  const [corpoHtml, setCorpoHtml] = useState("");
  /** sobe quando o conteúdo vem de fora (IA gerou ou corrigiu), para o editor aplicar */
  const [versaoCorpo, setVersaoCorpo] = useState(0);
  const [corrigindo, setCorrigindo] = useState(false);
  const [anexos, setAnexos] = useState<AnexoNaTela[]>([]);
  const paraPreenchido = useRef(false);
  const [gerando, setGerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  /** último assunto que veio da IA: se a pessoa não mexeu, a próxima geração troca */
  const assuntoDaIa = useRef("");
  /** resposta de pedido antigo (tela fechada e reaberta, clique duplo) é ignorada */
  const pedidoAtual = useRef(0);
  const geracaoInicial = useRef(false);

  // cada abertura começa do zero
  useEffect(() => {
    if (!open) return;
    setOpcoes(OPCOES_PADRAO);
    setGerado(OPCOES_PADRAO);
    setContaId("");
    setPara([]);
    setCc([]);
    setCco([]);
    setMostrarCc(false);
    setMostrarCco(false);
    setAssunto("");
    setCorpo("");
    setCorpoHtml("");
    setVersaoCorpo((v) => v + 1);
    setCorrigindo(false);
    setAnexos([]);
    paraPreenchido.current = false;
    setGerando(false);
    setEnviando(false);
    assuntoDaIa.current = "";
    pedidoAtual.current++;
    geracaoInicial.current = false;
  }, [open, conversation.id]);

  const contas = contasQuery.data?.contas ?? [];
  // uma conta só já vem escolhida; duas ou mais, a pessoa escolhe
  useEffect(() => {
    if (open && !contaId && contas.length === 1) setContaId(contas[0].id);
  }, [open, contaId, contas]);

  const sugestoes = clienteQuery.data?.sugestoes ?? [];
  // o primeiro e-mail do cadastro entra em Destinatário uma vez só por abertura
  useEffect(() => {
    if (!open || paraPreenchido.current || !clienteQuery.isSuccess) return;
    paraPreenchido.current = true;
    if (sugestoes.length > 0) setPara([sugestoes[0].email]);
  }, [open, clienteQuery.isSuccess, sugestoes]);

  const trava = useMemo(() => conferirTrava(opcoes, gerado), [opcoes, gerado]);
  const anexando = anexos.some((a) => a.status === "enviando");

  const cliente = clienteQuery.data?.cliente;
  const clienteNome = cliente
    ? `#${cliente.codigo_sequencial} ${cliente.nome_fantasia || cliente.razao_social || ""}`.trim()
    : null;
  const atendimentoCodigo = clienteQuery.data?.atendimentoCodigo;
  const referencia = referenciaDoAssunto(clienteQuery.data?.ticketCodigo, atendimentoCodigo);
  const subtitulo = [clienteNome ?? "Conversa sem cliente vinculado", atendimentoCodigo ? `atendimento #${atendimentoCodigo}` : null]
    .filter(Boolean)
    .join(" · ");

  const gerar = async (alvo: OpcoesGeracao) => {
    const pedido = ++pedidoAtual.current;
    setGerando(true);
    try {
      const r = await gerarEmailChat({ conversation_id: conversation.id, ...alvo });
      if (pedido !== pedidoAtual.current) return;
      if (r.ok === false) {
        toast.error(r.mensagem, { duration: 10000 });
        return;
      }
      // o editor aplica e devolve o texto puro pelo onChange
      setCorpoHtml(textoParaParagrafos(r.corpo));
      setVersaoCorpo((v) => v + 1);
      // assunto escrito pela pessoa fica; o que veio da IA é trocado pelo novo
      setAssunto((atual) => (!atual.trim() || atual === assuntoDaIa.current ? r.assunto : atual));
      assuntoDaIa.current = r.assunto;
      setGerado(alvo);
    } catch (err: any) {
      if (pedido === pedidoAtual.current) toast.error(err?.message || "Não foi possível gerar o texto.");
    } finally {
      if (pedido === pedidoAtual.current) setGerando(false);
    }
  };

  // a tela abre com o texto já gerado em Último atendimento e Formal
  useEffect(() => {
    if (!open || geracaoInicial.current) return;
    geracaoInicial.current = true;
    gerar(OPCOES_PADRAO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversation.id]);

  /** confere tipo, quantidade e tamanho somado; o que passa sobe na hora */
  const adicionarAnexos = (arquivos: File[]) => {
    const recusados: string[] = [];
    let total = anexos.reduce((soma, a) => soma + a.tamanho, 0);
    let quantidade = anexos.length;
    const aceitos: { anexo: AnexoNaTela; arquivo: File }[] = [];

    for (const arquivo of arquivos) {
      if (!anexoPermitido(arquivo.type, arquivo.name)) {
        recusados.push(`${arquivo.name} (tipo de arquivo não aceito)`);
      } else if (quantidade >= ANEXO_MAX_ARQUIVOS) {
        recusados.push(`${arquivo.name} (passou de ${ANEXO_MAX_ARQUIVOS} arquivos)`);
      } else if (total + arquivo.size > ANEXO_MAX_TOTAL_BYTES) {
        recusados.push(`${arquivo.name} (passou de ${formatarTamanho(ANEXO_MAX_TOTAL_BYTES)} somados)`);
      } else {
        total += arquivo.size;
        quantidade += 1;
        aceitos.push({
          arquivo,
          anexo: { id: crypto.randomUUID(), nome: arquivo.name, tamanho: arquivo.size, mime: arquivo.type, status: "enviando", arquivo },
        });
      }
    }

    if (recusados.length) toast.error(`Não foi anexado: ${recusados.join("; ")}.`, { duration: 10000 });
    if (aceitos.length === 0) return;
    setAnexos((lista) => [...lista, ...aceitos.map((a) => a.anexo)]);

    // resposta de upload de um anexo já removido (ou da tela reaberta) não acha o id e some
    for (const { anexo, arquivo } of aceitos) {
      uploadChatMedia(conversation.id, arquivo)
        .then((r) =>
          setAnexos((lista) =>
            lista.map((x) =>
              x.id === anexo.id
                ? { ...x, status: "pronto", path: r.storagePath, mime: r.mediaMimetype, nome: r.fileName, tamanho: r.mediaSizeBytes }
                : x,
            ),
          ),
        )
        .catch((err: any) =>
          setAnexos((lista) =>
            lista.map((x) => (x.id === anexo.id ? { ...x, status: "erro", erro: err?.message || "Falha no upload" } : x)),
          ),
        );
    }
  };

  const removerAnexo = (id: string) => setAnexos((lista) => lista.filter((a) => a.id !== id));

  const corrigir = async () => {
    if (corrigindo || gerando || enviando || !corpo.trim()) return;
    setCorrigindo(true);
    try {
      const r = await corrigirEmailChat({ conversation_id: conversation.id, html: corpoHtml });
      if (r.ok === false) {
        toast.error(r.mensagem, { duration: 10000 });
        return;
      }
      setCorpoHtml(r.html);
      setVersaoCorpo((v) => v + 1);
      toast.success("Gramática corrigida. Confira o texto antes de enviar.");
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível corrigir o texto.");
    } finally {
      setCorrigindo(false);
    }
  };

  const enviar = async () => {
    if (enviando || gerando || corrigindo || trava.travado) return;
    if (anexando) {
      toast.error("Espere os arquivos terminarem de anexar antes de enviar.");
      return;
    }
    if (anexos.some((a) => a.status === "erro")) {
      toast.error("Tire os anexos que falharam (marcados em vermelho) antes de enviar.");
      return;
    }
    const faltando: string[] = [];
    if (!contaId) faltando.push("o remetente");
    if (para.length === 0) faltando.push("pelo menos um destinatário");
    if (!assunto.trim()) faltando.push("o assunto");
    if (!corpo.trim()) faltando.push("o corpo do e-mail");
    if (faltando.length > 0) {
      toast.error(`Falta preencher ${faltando.join(", ")}.`);
      return;
    }

    setEnviando(true);
    try {
      const dados = clienteQuery.data;
      const r = await enviarEmailChat({
        tenant_id: conversation.tenant_id,
        account_id: contaId,
        para,
        cc,
        cco,
        assunto: assuntoComReferencia(assunto, referencia),
        texto: corpo.trim(),
        html: htmlParaEmail(corpoHtml),
        atendimento_id: dados?.atendimentoId ?? null,
        cliente_id: dados?.cliente?.id ?? null,
        department_id: dados?.departmentId ?? null,
        anexos: anexos.filter((a) => a.status === "pronto" && a.path).map((a) => ({ path: a.path!, nome: a.nome, mime: a.mime })),
      });
      if (r.ok === false) {
        toast.error(r.mensagem, { duration: 12000 });
        return;
      }
      toast.success(r.mensagem);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível enviar o e-mail.");
    } finally {
      setEnviando(false);
    }
  };

  const fecharLinha = (qual: "cc" | "cco") => {
    if (qual === "cc") {
      setCc([]);
      setMostrarCc(false);
    } else {
      setCco([]);
      setMostrarCco(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* O DialogHeader do projeto é sticky com margem negativa para compensar o
            p-6 do DialogContent. Aqui o conteúdo é p-0 e rola por dentro, então a
            margem jogava o cabeçalho 24px para fora e escondia o X de fechar. */}
        <DialogHeader className="static m-0 px-6 pt-5 pb-4 pr-12 border-b border-border space-y-1 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            Enviar e-mail
          </DialogTitle>
          <DialogDescription className="text-xs">
            {clienteQuery.isLoading ? "Carregando cliente..." : subtitulo}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">
          <Grupo titulo="Atendimento">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <RadioGroup
                value={opcoes.base}
                onValueChange={(v) => setOpcoes((o) => ({ ...o, base: v as OpcoesGeracao["base"] }))}
                className="flex flex-wrap items-center gap-x-5 gap-y-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="envio-base-ultimo" value="ultimo" />
                  <Label htmlFor="envio-base-ultimo" className="font-normal cursor-pointer">Último atendimento</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="envio-base-resumo" value="resumo" />
                  <Label htmlFor="envio-base-resumo" className="font-normal cursor-pointer">Resumo geral</Label>
                </div>
              </RadioGroup>
              <div className="flex items-center gap-2 sm:ml-auto">
                <Label
                  htmlFor="envio-quantidade"
                  className={cn("font-normal", opcoes.base !== "resumo" && "text-muted-foreground")}
                >
                  Qtde de atendimentos
                </Label>
                <Input
                  id="envio-quantidade"
                  type="number"
                  min={1}
                  max={QUANTIDADE_MAXIMA}
                  value={opcoes.base === "resumo" ? opcoes.quantidade : 1}
                  disabled={opcoes.base !== "resumo"}
                  onChange={(e) =>
                    setOpcoes((o) => ({ ...o, quantidade: normalizarQuantidade(parseInt(e.target.value, 10)) }))
                  }
                  className="h-8 w-16 px-2 text-center tabular-nums"
                />
              </div>
            </div>
          </Grupo>

          <Grupo titulo="Tom do e-mail">
            <ToggleGroup
              type="single"
              value={opcoes.tom}
              // clicar no tom já marcado não desmarca: sempre existe um tom
              onValueChange={(v) => v && setOpcoes((o) => ({ ...o, tom: v as TomEmail }))}
              className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-md bg-muted p-1"
            >
              {TONS.map((t) => (
                <ToggleGroupItem
                  key={t.valor}
                  value={t.valor}
                  className="h-8 text-sm text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
                >
                  {t.rotulo}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Grupo>

          <Grupo titulo="Envio">
            <Linha rotulo={<Label htmlFor="envio-remetente" className="font-normal text-muted-foreground">Remetente</Label>}>
              <Select value={contaId} onValueChange={setContaId} disabled={contas.length === 0}>
                <SelectTrigger id="envio-remetente" className="h-9">
                  <SelectValue
                    placeholder={
                      contasQuery.isLoading
                        ? "Carregando contas..."
                        : contas.length === 0
                          ? "Nenhuma conta de e-mail ativa"
                          : "Escolha a conta"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {contas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.email} <span className="text-muted-foreground">({c.rotulo})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Linha>
            {!contasQuery.isLoading && contas.length === 0 && (
              <p className="text-xs text-muted-foreground sm:pl-[108px]">
                Cadastre uma conta em Configurações › Atendimento › E-mail.
              </p>
            )}

            <Linha rotulo={<Label htmlFor="envio-para" className="font-normal text-muted-foreground">Destinatário</Label>}>
              <CampoEmails
                id="envio-para"
                valores={para}
                onChange={setPara}
                sugestoes={sugestoes}
                placeholder="Adicionar destinatário"
                extra={
                  <span className="ml-auto flex gap-0.5 shrink-0">
                    {!mostrarCc && (
                      <button type="button" className={linkCc} onClick={() => setMostrarCc(true)}>Cc</button>
                    )}
                    {!mostrarCco && (
                      <button type="button" className={linkCc} onClick={() => setMostrarCco(true)}>Cco</button>
                    )}
                  </span>
                }
              />
            </Linha>

            {mostrarCc && (
              <Linha rotulo={<RotuloComFechar id="envio-cc" texto="Cc" onFechar={() => fecharLinha("cc")} />}>
                <CampoEmails id="envio-cc" valores={cc} onChange={setCc} sugestoes={sugestoes} placeholder="Com cópia" autoFocus />
              </Linha>
            )}
            {mostrarCco && (
              <Linha rotulo={<RotuloComFechar id="envio-cco" texto="Cco" onFechar={() => fecharLinha("cco")} />}>
                <CampoEmails id="envio-cco" valores={cco} onChange={setCco} sugestoes={sugestoes} placeholder="Com cópia oculta" autoFocus />
              </Linha>
            )}

            <Linha rotulo={<Label htmlFor="envio-assunto" className="font-normal text-muted-foreground">Assunto</Label>}>
              <Input id="envio-assunto" value={assunto} onChange={(e) => setAssunto(e.target.value)} className="h-9" maxLength={300} autoComplete="off" data-lpignore="true" data-1p-ignore="true" />
            </Linha>
            {referencia && (
              <p className="text-xs text-muted-foreground sm:pl-[108px]">
                No envio, o assunto termina com <span className="font-medium text-foreground">· {referencia}</span>.
              </p>
            )}
          </Grupo>

          <div className="flex justify-center pt-1">
            <Button
              type="button"
              variant={trava.travado && !gerando ? "default" : "outline"}
              onClick={() => gerar(opcoes)}
              disabled={gerando || corrigindo}
              className={cn(
                "gap-2",
                !(trava.travado && !gerando) && "border-primary text-primary hover:text-primary",
                trava.travado && !gerando && "ring-2 ring-primary/40 ring-offset-2 ring-offset-background motion-safe:animate-pulse",
              )}
            >
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {gerando ? "Gerando..." : "Gerar novo"}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="envio-corpo" className="font-normal text-muted-foreground">Corpo do e-mail</Label>
            <EditorEmail
              id="envio-corpo"
              valor={corpoHtml}
              versao={versaoCorpo}
              onChange={(c) => {
                setCorpoHtml(c.html);
                setCorpo(c.vazio ? "" : c.texto);
              }}
              desabilitado={gerando || corrigindo || enviando}
              placeholder={
                gerando ? "Gerando o texto a partir da conversa..." : corrigindo ? "Corrigindo a gramática..." : "Escreva o e-mail"
              }
              acaoAnexar={<BotaoAnexar desabilitado={gerando || corrigindo || enviando} onEscolher={adicionarAnexos} />}
              onCorrigirGramatica={corrigir}
              corrigindo={corrigindo}
              rodape={
                <p className="mt-3 mb-1 text-xs text-muted-foreground">
                  A assinatura da conta remetente entra automaticamente no envio.
                </p>
              }
            />
            <ListaAnexos anexos={anexos} onRemover={removerAnexo} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">
          {trava.aviso && !gerando && (
            <div
              role="status"
              className="basis-full flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300"
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              {trava.aviso}
            </div>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={trava.travado || gerando || enviando || corrigindo || anexando} className="gap-2">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {enviando ? "Enviando..." : "Enviar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const linkCc =
  "rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 rounded-lg border border-border px-4 pb-3 pt-1 space-y-2.5">
      <legend className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function Linha({ rotulo, children }: { rotulo: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-3">
      {rotulo}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function RotuloComFechar({ id, texto, onFechar }: { id: string; texto: string; onFechar: () => void }) {
  return (
    <span className="flex items-center gap-1.5">
      <Label htmlFor={id} className="font-normal text-muted-foreground">{texto}</Label>
      <button
        type="button"
        onClick={onFechar}
        aria-label={`Remover linha ${texto}`}
        className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * Campo de e-mails em chips, como no Gmail: Enter, vírgula, ponto e vírgula ou
 * sair do campo confirma o endereço; Backspace no campo vazio tira o último.
 * Ao focar, mostra os e-mails do cadastro do cliente que ainda não estão nele.
 */
function CampoEmails({
  id,
  valores,
  onChange,
  sugestoes,
  placeholder,
  extra,
  autoFocus,
}: {
  id: string;
  valores: string[];
  onChange: (v: string[]) => void;
  sugestoes: SugestaoEmail[];
  placeholder: string;
  extra?: ReactNode;
  autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [focado, setFocado] = useState(false);
  const [invalido, setInvalido] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const adicionar = (bruto: string) => {
    const partes = bruto.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (partes.length === 0) return true;
    const ruins = partes.filter((p) => !emailValido(p));
    const bons = partes.filter((p) => emailValido(p) && !valores.includes(p));
    if (bons.length) onChange([...valores, ...bons]);
    setTexto(ruins.join(", "));
    setInvalido(ruins.length > 0);
    return ruins.length === 0;
  };

  const disponiveis = sugestoes.filter(
    (s) => !valores.includes(s.email) && (!texto || s.email.includes(texto.toLowerCase())),
  );

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 text-sm cursor-text",
          focado && "ring-2 ring-ring ring-offset-2 ring-offset-background",
          invalido && "border-destructive",
        )}
      >
        {valores.map((v) => (
          <span key={v} className="flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
            <span className="truncate">{v}</span>
            <button
              type="button"
              aria-label={`Remover ${v}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(valores.filter((x) => x !== v));
              }}
              className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          // Sem type="email", sem "email" no id e no placeholder: é por isso que o
          // Chrome reconhece campo de e-mail, oferece o endereço salvo dele e,
          // ao aceitar, preenche também o Assunto. As sugestões aqui são as nossas.
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          autoFocus={autoFocus}
          value={texto}
          placeholder={valores.length === 0 ? placeholder : ""}
          aria-invalid={invalido || undefined}
          onChange={(e) => {
            setTexto(e.target.value);
            setInvalido(false);
          }}
          onFocus={() => setFocado(true)}
          onBlur={() => {
            setFocado(false);
            adicionar(texto);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              if (texto.trim()) {
                e.preventDefault();
                adicionar(texto);
              } else if (e.key === "Enter") {
                e.preventDefault();
              }
            } else if (e.key === "Backspace" && !texto && valores.length > 0) {
              onChange(valores.slice(0, -1));
            }
          }}
          onPaste={(e) => {
            const colado = e.clipboardData.getData("text");
            if (/[\s,;]/.test(colado.trim())) {
              e.preventDefault();
              adicionar(`${texto} ${colado}`);
            }
          }}
          className="h-6 min-w-[140px] flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
        />
        {extra}
      </div>
      {invalido && <p className="mt-1 text-xs text-destructive">E-mail inválido. Confira o endereço digitado.</p>}
      {focado && disponiveis.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-md border border-border bg-popover p-1 shadow-md">
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            E-mails do cadastro do cliente
          </p>
          {disponiveis.map((s) => (
            <button
              key={s.email}
              type="button"
              // mousedown para não perder o foco antes do clique contar
              onMouseDown={(e) => {
                e.preventDefault();
                onChange([...valores, s.email]);
                setTexto("");
                setInvalido(false);
              }}
              className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="truncate">{s.email}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{s.rotulo}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
