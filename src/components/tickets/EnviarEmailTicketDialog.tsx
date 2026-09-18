import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useBusinessHoursConfig } from "@/components/whatsapp/hooks/useBusinessHoursConfig";
import {
  adaptarEmailChat,
  corrigirEmailChat,
  enviarEmailChat,
  gerarEmailChat,
  reescreverEmailChat,
  useContasDeEnvio,
  useConversaCompleta,
} from "@/components/whatsapp/chat/email/useEmailChatDados";
import { EditorEmail } from "@/components/whatsapp/chat/email/EditorEmail";
import { CampoEmails } from "@/components/whatsapp/chat/email/EnviarEmailChatDialog";
import { BotaoAnexar, ListaAnexos, type AnexoNaTela } from "@/components/whatsapp/chat/email/AnexosEmail";
import { BotaoAjustar, BotaoSotaque, FaixaAjustes } from "@/components/whatsapp/chat/email/SotaqueEmail";
import { comSotaque, SEM_AJUSTES, semAjustes, type AjustesTexto } from "@/components/whatsapp/chat/email/estadosSotaque";
import { montarConversaCompleta } from "@/components/whatsapp/chat/email/conversaCompleta";
import { ConversaCompletaPrevia } from "@/components/whatsapp/chat/email/ConversaCompletaPrevia";
import { BotaoEnviarComAgenda } from "@/components/whatsapp/chat/email/AgendarEnvio";
import { descreverHorario } from "@/components/whatsapp/chat/email/EscolherHorario";
import { uploadAnexoEmail } from "@/components/whatsapp/chat/email/uploadAnexoEmail";
import { agendarEmail } from "@/components/emails/useEmailsAgendados";
import { BotaoMacros, FaixaMacro, useMacroNoEmail } from "@/components/emails/macros/MacrosNoEmail";
import { baixarAnexoDaMacro } from "@/components/emails/macros/useEmailMacros";
import {
  ANEXO_MAX_ARQUIVOS,
  ANEXO_MAX_TOTAL_BYTES,
  anexoPermitido,
  assuntoComReferencia,
  formatarTamanho,
  htmlParaEmail,
  referenciaDoAssunto,
  textoParaParagrafos,
  TONS,
  type TomEmail,
} from "@/components/whatsapp/chat/email/travaEnvioEmail";
import { useEmailDoTicket } from "./useEmailDoTicket";

interface OpcoesTicket {
  /** histórico do chamado, com ou sem os chats de WhatsApp ligados a ele */
  base: "ticket" | "ticket_chats";
  /** deixa a IA LER as notas internas como contexto; elas nunca vão no e-mail */
  comNotas: boolean;
  tom: TomEmail;
}

const PADRAO: OpcoesTicket = { base: "ticket", comNotas: false, tom: "formal" };

/** mesma trava do chat: mudou a base do texto, precisa gerar de novo antes de enviar */
function conferirTravaTicket(atual: OpcoesTicket, gerado: OpcoesTicket): { travado: boolean; aviso: string | null } {
  const mudou: string[] = [];
  if (atual.base !== gerado.base) mudou.push("o que entra no texto");
  if (atual.comNotas !== gerado.comNotas) mudou.push("o uso das notas internas");
  if (atual.tom !== gerado.tom) mudou.push("o tom do e-mail");
  if (mudou.length === 0) return { travado: false, aviso: null };
  return { travado: true, aviso: `Você trocou ${mudou.join(" e ")}. Clique em Gerar novo antes de enviar.` };
}

/**
 * Tela "Enviar e-mail" aberta pelo TICKET (etapa 2, item 3 do mockup aprovado
 * em 16/09/2026). Mesmo editor, anexos, Sotaque, Ajustar e agendamento do chat;
 * o que muda é de onde o texto sai e para onde a resposta volta.
 *
 * O envio vai com origem 'ticket' e referência ao chamado: a resposta do cliente
 * cai no histórico deste ticket, pelo mesmo caminho da resposta de e-mail.
 */
export function EnviarEmailTicketDialog({
  open,
  onOpenChange,
  ticketId,
  jornada = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticketId: string;
  /**
   * Aberto pela jornada de implantação/onboarding (17/09/2026). Diferenças
   * pedidas pelo Alexandre: NÃO gera texto ao abrir (a IA só roda se a pessoa
   * clicar), e o envio sai como origem 'onboarding'.
   */
  jornada?: boolean;
}) {
  const { user, profile } = useAuth();
  const dadosQuery = useEmailDoTicket(ticketId, open);
  const dados = dadosQuery.data;
  const tenantId = dados?.ticket?.tenant_id ?? null;
  const contasQuery = useContasDeEnvio(tenantId, user?.id ?? null, profile?.is_super_admin === true, open && !!tenantId);
  const horarioComercial = useBusinessHoursConfig();

  const [opcoes, setOpcoes] = useState<OpcoesTicket>(PADRAO);
  const [gerado, setGerado] = useState<OpcoesTicket>(PADRAO);
  const [contaId, setContaId] = useState("");
  const [para, setPara] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [mostrarCc, setMostrarCc] = useState(false);
  const [mostrarCco, setMostrarCco] = useState(false);
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [corpoHtml, setCorpoHtml] = useState("");
  const [versaoCorpo, setVersaoCorpo] = useState(0);
  const [incluirConversa, setIncluirConversa] = useState(false);
  const [ajustes, setAjustes] = useState<
    (AjustesTexto & { htmlOriginal: string; assuntoOriginal: string; assuntoAplicado: string }) | null
  >(null);
  const [anexos, setAnexos] = useState<AnexoNaTela[]>([]);
  const [gerando, setGerando] = useState(false);
  const [corrigindo, setCorrigindo] = useState(false);
  const [reescrevendo, setReescrevendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  /** a trava do Enviar só vale depois da primeira geração: sem IA, a pessoa escreve livre */
  const [jaGerou, setJaGerou] = useState(false);
  const assuntoDaIa = useRef("");
  const pedidoAtual = useRef(0);
  const geracaoInicial = useRef(false);
  const paraPreenchido = useRef(false);

  const alvo = useMemo(() => ({ ticket_id: ticketId }), [ticketId]);

  useEffect(() => {
    if (!open) return;
    setOpcoes(PADRAO);
    setGerado(PADRAO);
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
    setIncluirConversa(false);
    setAjustes(null);
    setAnexos([]);
    setGerando(false);
    setCorrigindo(false);
    setReescrevendo(false);
    setEnviando(false);
    setJaGerou(false);
    assuntoDaIa.current = "";
    pedidoAtual.current++;
    geracaoInicial.current = false;
    paraPreenchido.current = false;
  }, [open, ticketId]);

  const contas = contasQuery.data?.contas ?? [];
  useEffect(() => {
    if (open && !contaId && contas.length === 1) setContaId(contas[0].id);
  }, [open, contaId, contas]);

  const sugestoes = dados?.sugestoes ?? [];
  useEffect(() => {
    if (!open || paraPreenchido.current || !dadosQuery.isSuccess) return;
    paraPreenchido.current = true;
    if (sugestoes.length > 0) setPara([sugestoes[0].email]);
  }, [open, dadosQuery.isSuccess, sugestoes]);

  const trava = useMemo(
    () => (jaGerou ? conferirTravaTicket(opcoes, gerado) : { travado: false, aviso: null }),
    [jaGerou, opcoes, gerado],
  );
  const temChats = (dados?.chats ?? 0) > 0;
  const anexando = anexos.some((a) => a.status === "enviando");
  const referencia = referenciaDoAssunto(dados?.ticket?.ticket_code ?? null, null);
  const clienteNome = dados?.cliente
    ? `#${dados.cliente.codigo_sequencial} ${dados.cliente.nome_fantasia || dados.cliente.razao_social || ""}`.trim()
    : null;

  const conversaQuery = useConversaCompleta(alvo, "ticket_chats", 1, open && incluirConversa && temChats);
  const conversaDados = conversaQuery.data?.ok ? conversaQuery.data : null;
  const conversaErro = conversaQuery.data && conversaQuery.data.ok === false ? conversaQuery.data.mensagem : null;
  const conversaMontada = useMemo(
    () => (conversaDados ? montarConversaCompleta(conversaDados.blocos, conversaDados.contato_nome) : null),
    [conversaDados],
  );

  // Macros (18/09/2026): os campos saem do cliente e do chamado (ou da jornada)
  const macro = useMacroNoEmail({
    open: open && !!tenantId,
    contexto: {
      tenantId: tenantId ?? "",
      clienteId: dados?.cliente?.id ?? null,
      departmentId: dados?.ticket?.department_id ?? null,
      contatoNome: dados?.contatoNome ?? null,
      numeroAtendimento: null,
      numeroChamado: dados?.ticket?.ticket_code ?? null,
      assuntoChamado: dados?.ticket?.assunto ?? null,
    },
    corpoHtml,
    corpoVazio: !corpo.trim(),
    assunto,
    anexos,
    aplicar: ({ html, assunto: novoAssunto }) => {
      // geração em curso perde a vez: a resposta dela seria ignorada de qualquer jeito
      pedidoAtual.current++;
      setGerando(false);
      setCorpoHtml(html);
      setVersaoCorpo((v) => v + 1);
      setAjustes(null);
      setAssunto(novoAssunto);
    },
    setAnexos,
    adaptarComIa: (html) =>
      adaptarEmailChat({ alvo, html, base: opcoes.base, tom: opcoes.tom, com_notas: opcoes.comNotas }),
  });

  const gerar = async (alvoOpcoes: OpcoesTicket) => {
    const pedido = ++pedidoAtual.current;
    setGerando(true);
    try {
      const r = await gerarEmailChat({
        alvo,
        base: alvoOpcoes.base,
        tom: alvoOpcoes.tom,
        com_notas: alvoOpcoes.comNotas,
      });
      if (pedido !== pedidoAtual.current) return;
      if (r.ok === false) {
        toast.error(r.mensagem, { duration: 10000 });
        return;
      }
      setCorpoHtml(textoParaParagrafos(r.corpo));
      setVersaoCorpo((v) => v + 1);
      setAjustes(null);
      setAssunto((atual) => (!atual.trim() || atual === assuntoDaIa.current ? r.assunto : atual));
      assuntoDaIa.current = r.assunto;
      setGerado(alvoOpcoes);
      setJaGerou(true);
      macro.esquecer();
    } catch (err: any) {
      if (pedido === pedidoAtual.current) toast.error(err?.message || "Não foi possível gerar o texto.");
    } finally {
      if (pedido === pedidoAtual.current) setGerando(false);
    }
  };

  // no chamado, a tela abre com o texto já gerado; na jornada, só se a pessoa pedir
  useEffect(() => {
    if (jornada || !open || geracaoInicial.current || !dadosQuery.isSuccess || !dados?.ticket) return;
    geracaoInicial.current = true;
    gerar(PADRAO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dadosQuery.isSuccess, dados?.ticket?.id]);

  const adicionarAnexos = (arquivos: File[]) => {
    if (!tenantId) return;
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

    for (const { anexo, arquivo } of aceitos) {
      uploadAnexoEmail(tenantId, arquivo)
        .then((r) => setAnexos((l) => l.map((x) => (x.id === anexo.id ? { ...x, status: "pronto", path: r.storagePath } : x))))
        .catch((err: any) =>
          setAnexos((l) => l.map((x) => (x.id === anexo.id ? { ...x, status: "erro", erro: err?.message || "Falha no upload" } : x))),
        );
    }
  };

  const corrigir = async () => {
    if (corrigindo || gerando || enviando || reescrevendo || !corpo.trim()) return;
    setCorrigindo(true);
    try {
      const r = await corrigirEmailChat({ alvo, html: corpoHtml });
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

  const ajustesAtuais: AjustesTexto = ajustes
    ? { sotaque: ajustes.sotaque, idioma: ajustes.idioma, tamanho: ajustes.tamanho }
    : SEM_AJUSTES;

  const voltarAoOriginal = () => {
    if (!ajustes) return;
    setCorpoHtml(ajustes.htmlOriginal);
    setVersaoCorpo((v) => v + 1);
    setAssunto((atual) => (atual === ajustes.assuntoAplicado ? ajustes.assuntoOriginal : atual));
    if (assuntoDaIa.current === ajustes.assuntoAplicado) assuntoDaIa.current = ajustes.assuntoOriginal;
    setAjustes(null);
  };

  const aplicarAjustes = async (proximo: AjustesTexto) => {
    if (reescrevendo || corrigindo || gerando || enviando || !corpo.trim()) return;
    const htmlOriginal = ajustes?.htmlOriginal ?? corpoHtml;
    const assuntoOriginal = ajustes?.assuntoOriginal ?? assunto;
    if (semAjustes(proximo)) {
      voltarAoOriginal();
      return;
    }
    setReescrevendo(true);
    try {
      const r = await reescreverEmailChat({
        alvo,
        html: htmlOriginal,
        assunto: proximo.idioma && assuntoOriginal.trim() ? assuntoOriginal : null,
        ajustes: proximo,
      });
      if (r.ok === false) {
        toast.error(r.mensagem, { duration: 10000 });
        return;
      }
      setCorpoHtml(r.html);
      setVersaoCorpo((v) => v + 1);
      const assuntoNovo = proximo.idioma ? (r.assunto ?? assuntoOriginal) : assuntoOriginal;
      setAssunto((atual) => (atual === (ajustes?.assuntoAplicado ?? assuntoOriginal) ? assuntoNovo : atual));
      if (assuntoDaIa.current === (ajustes?.assuntoAplicado ?? assuntoOriginal)) assuntoDaIa.current = assuntoNovo;
      setAjustes({ ...proximo, htmlOriginal, assuntoOriginal, assuntoAplicado: assuntoNovo });
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível ajustar o texto.");
    } finally {
      setReescrevendo(false);
    }
  };

  const prontoParaSair = (): boolean => {
    if (enviando || gerando || corrigindo || reescrevendo || macro.adaptando || trava.travado) return false;
    const pendentes = macro.pendentes();
    if (pendentes.length) {
      toast.error(`Complete no texto: ${pendentes.map((p) => `{{${p}}}`).join(", ")}.`, { duration: 10000 });
      return false;
    }
    if (incluirConversa) {
      if (conversaQuery.isFetching || !conversaQuery.data) {
        toast.error("Espere a conversa completa terminar de carregar antes de enviar.");
        return false;
      }
      if (conversaErro) {
        toast.error(`${conversaErro} Desmarque "Incluir a conversa completa" para enviar sem ela.`, { duration: 10000 });
        return false;
      }
    }
    if (anexando) {
      toast.error("Espere os arquivos terminarem de anexar antes de enviar.");
      return false;
    }
    if (anexos.some((a) => a.status === "erro")) {
      toast.error("Tire os anexos que falharam antes de enviar.");
      return false;
    }
    const faltando: string[] = [];
    if (!contaId) faltando.push("o remetente");
    if (para.length === 0) faltando.push("pelo menos um destinatário");
    if (!assunto.trim()) faltando.push("o assunto");
    if (!corpo.trim()) faltando.push("o corpo do e-mail");
    if (faltando.length > 0) {
      toast.error(`Falta preencher ${faltando.join(", ")}.`);
      return false;
    }
    return true;
  };

  const anexosProntos = () =>
    anexos
      .filter((a) => a.status === "pronto" && a.path)
      .map((a) => ({ path: a.path!, nome: a.nome, mime: a.mime, ...(a.bucket ? { bucket: a.bucket } : {}) }));
  const conversaParaEnviar = () =>
    incluirConversa && conversaMontada && conversaMontada.mensagens > 0
      ? { html: conversaMontada.html, texto: conversaMontada.texto }
      : null;

  const enviar = async () => {
    if (!prontoParaSair() || !tenantId || !dados?.ticket) return;
    setEnviando(true);
    try {
      const r = await enviarEmailChat({
        tenant_id: tenantId,
        account_id: contaId,
        para,
        cc,
        cco,
        assunto: assuntoComReferencia(assunto, referencia),
        texto: corpo.trim(),
        html: htmlParaEmail(corpoHtml),
        origem: jornada ? "onboarding" : "ticket",
        atendimento_id: dados.ticket.id,
        cliente_id: dados.ticket.cliente_id,
        department_id: dados.ticket.department_id,
        anexos: anexosProntos(),
        historico: conversaParaEnviar(),
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

  const agendar = async (quando: Date): Promise<boolean> => {
    if (!prontoParaSair() || !tenantId || !dados?.ticket) return false;
    setEnviando(true);
    try {
      const historico = conversaParaEnviar();
      await agendarEmail(tenantId, quando, {
        account_id: contaId,
        para,
        cc,
        cco,
        assunto: assuntoComReferencia(assunto, referencia),
        texto: corpo.trim(),
        html: htmlParaEmail(corpoHtml),
        historico_html: historico?.html ?? null,
        historico_texto: historico?.texto ?? null,
        origem: jornada ? "onboarding" : "ticket",
        referencia_id: dados.ticket.id,
        cliente_id: dados.ticket.cliente_id,
        department_id: dados.ticket.department_id,
        anexos: anexosProntos(),
      });
      toast.success(`E-mail agendado para ${descreverHorario(quando)}. Ele aparece em E-mails › Enviados até sair.`);
      onOpenChange(false);
      return true;
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível agendar o e-mail.", { duration: 10000 });
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const ocupado = gerando || corrigindo || reescrevendo || enviando || macro.adaptando;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="static m-0 space-y-1 border-b border-border px-6 pb-4 pr-12 pt-5 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            Enviar e-mail
          </DialogTitle>
          <DialogDescription className="text-xs">
            {dadosQuery.isLoading
              ? jornada
                ? "Carregando a jornada..."
                : "Carregando o chamado..."
              : [dados?.ticket?.ticket_code, clienteNome ?? (jornada ? "Jornada sem cliente vinculado" : "Chamado sem cliente vinculado")]
                  .filter(Boolean)
                  .join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <Grupo titulo="Base do texto">
            <RadioGroup
              value={opcoes.base}
              onValueChange={(v) => setOpcoes((o) => ({ ...o, base: v as OpcoesTicket["base"] }))}
              className="flex flex-wrap items-center gap-x-5 gap-y-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id="ticket-base-historico" value="ticket" />
                <Label htmlFor="ticket-base-historico" className="cursor-pointer font-normal">{jornada ? "Histórico da jornada" : "Histórico do chamado"}</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="ticket-base-chats" value="ticket_chats" disabled={!temChats} />
                <Label
                  htmlFor="ticket-base-chats"
                  className={cn("cursor-pointer font-normal", !temChats && "cursor-default text-muted-foreground")}
                >
                  Histórico + chats ligados
                  {!temChats && <span className="ml-1 text-xs">(nenhum chat ligado)</span>}
                </Label>
              </div>
            </RadioGroup>

            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 border-t border-dashed border-border pt-2.5">
              <Checkbox
                id="ticket-com-notas"
                checked={opcoes.comNotas}
                onCheckedChange={(v) => setOpcoes((o) => ({ ...o, comNotas: v === true }))}
                className="mt-0.5"
              />
              <Label htmlFor="ticket-com-notas" className="cursor-pointer text-sm font-medium">
                Deixar a IA ler as notas internas
              </Label>
              <p className="col-start-2 text-xs text-muted-foreground">
                Desligado, a IA vê só o que o cliente já poderia ver. Ligado, ela usa as notas da equipe para entender o
                caso, e mesmo assim nunca copia nota interna no e-mail.
              </p>
            </div>

            {temChats && (
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 pt-1">
                <Checkbox
                  id="ticket-conversa-completa"
                  checked={incluirConversa}
                  onCheckedChange={(v) => setIncluirConversa(v === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="ticket-conversa-completa" className="cursor-pointer text-sm font-medium">
                  Incluir a conversa completa
                </Label>
                <p className="col-start-2 text-xs text-muted-foreground">
                  As mensagens dos chats ligados a este chamado vão depois da assinatura, do jeito que foram trocadas.
                </p>
              </div>
            )}
          </Grupo>

          <Grupo titulo="Tom do e-mail">
            <ToggleGroup
              type="single"
              value={opcoes.tom}
              onValueChange={(v) => v && setOpcoes((o) => ({ ...o, tom: v as TomEmail }))}
              className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 sm:grid-cols-4"
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
            <Linha htmlFor="ticket-remetente" rotulo="Remetente">
              <Select value={contaId} onValueChange={setContaId} disabled={contas.length === 0}>
                <SelectTrigger id="ticket-remetente" className="h-9">
                  <SelectValue
                    placeholder={
                      contasQuery.isLoading
                        ? "Carregando contas..."
                        : contas.length === 0
                          ? "Nenhuma conta de e-mail liberada para você"
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

            <Linha htmlFor="ticket-para" rotulo="Destinatário">
              <CampoEmails
                id="ticket-para"
                valores={para}
                onChange={setPara}
                sugestoes={sugestoes}
                placeholder="Adicionar destinatário"
                extra={
                  <span className="ml-auto flex shrink-0 gap-0.5">
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
              <Linha htmlFor="ticket-cc" rotulo="Cc">
                <CampoEmails id="ticket-cc" valores={cc} onChange={setCc} sugestoes={sugestoes} placeholder="Com cópia" />
              </Linha>
            )}
            {mostrarCco && (
              <Linha htmlFor="ticket-cco" rotulo="Cco">
                <CampoEmails id="ticket-cco" valores={cco} onChange={setCco} sugestoes={sugestoes} placeholder="Com cópia oculta" />
              </Linha>
            )}

            <Linha htmlFor="ticket-assunto" rotulo="Assunto">
              <Input
                id="ticket-assunto"
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
                className="h-9"
                maxLength={300}
                autoComplete="off"
                data-lpignore="true"
              />
            </Linha>
            {referencia && (
              <p className="text-xs text-muted-foreground sm:pl-[108px]">
                No envio, o assunto termina com <span className="font-medium text-foreground">· {referencia}</span>, e a
                resposta do cliente entra no histórico {jornada ? "desta jornada" : "deste chamado"}.
              </p>
            )}
          </Grupo>

          <div className="flex justify-center pt-1">
            <Button
              type="button"
              variant={trava.travado && !gerando ? "default" : "outline"}
              onClick={() => gerar(opcoes)}
              disabled={ocupado}
              className={cn(
                "gap-2",
                !(trava.travado && !gerando) && "border-primary text-primary hover:text-primary",
                trava.travado && !gerando && "ring-2 ring-primary/40 ring-offset-2 ring-offset-background motion-safe:animate-pulse",
              )}
            >
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {gerando ? "Gerando..." : jaGerou || !jornada ? "Gerar novo" : "Gerar texto com IA"}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ticket-corpo" className="font-normal text-muted-foreground">Corpo do e-mail</Label>
            <FaixaMacro m={macro} desabilitado={gerando || corrigindo || reescrevendo || enviando} />
            {ajustes && (
              <FaixaAjustes ajustes={ajustesAtuais} onVoltar={voltarAoOriginal} desabilitado={ocupado} />
            )}
            <EditorEmail
              id="ticket-corpo"
              valor={corpoHtml}
              versao={versaoCorpo}
              onChange={(c) => {
                setCorpoHtml(c.html);
                setCorpo(c.vazio ? "" : c.texto);
              }}
              desabilitado={ocupado}
              onBarra={() => macro.setPaletaAberta(true)}
              placeholder={
                macro.adaptando
                  ? "Adaptando a macro ao caso..."
                  : gerando
                  ? jornada
                    ? "Gerando o texto a partir da jornada..."
                    : "Gerando o texto a partir do chamado..."
                  : corrigindo
                    ? "Corrigindo a gramática..."
                    : reescrevendo
                      ? "Ajustando o texto..."
                      : jornada && !jaGerou
                        ? "Escreva o e-mail, digite / para usar uma macro, ou clique em Gerar texto com IA"
                        : "Escreva o e-mail, ou digite / para usar uma macro"
              }
              acaoAnexar={
                <>
                  <BotaoMacros m={macro} desabilitado={corrigindo || reescrevendo || enviando || macro.adaptando} />
                  <BotaoAnexar desabilitado={ocupado} onEscolher={adicionarAnexos} />
                  <BotaoSotaque
                    ufCliente={dados?.ufCliente ?? null}
                    aplicando={reescrevendo}
                    desabilitado={ocupado || !corpo.trim()}
                    onAplicar={(uf, intensidade) => aplicarAjustes(comSotaque(ajustesAtuais, uf, intensidade))}
                  />
                  <BotaoAjustar
                    ajustes={ajustesAtuais}
                    aplicando={reescrevendo}
                    desabilitado={ocupado || !corpo.trim()}
                    onAjustar={aplicarAjustes}
                  />
                </>
              }
              onCorrigirGramatica={corrigir}
              corrigindo={corrigindo}
              rodape={
                <p className="mb-1 mt-3 text-xs text-muted-foreground">
                  A assinatura da conta remetente entra automaticamente no envio.
                </p>
              }
            />
            <ListaAnexos
              anexos={anexos}
              onRemover={(id) => setAnexos((l) => l.filter((a) => a.id !== id))}
              buscarRemoto={(a) =>
                a.bucket === "email-macro-anexos" && a.path
                  ? baixarAnexoDaMacro(a.path)
                  : Promise.reject(new Error("Este arquivo ainda está sendo anexado."))
              }
            />
            {incluirConversa && temChats && (
              <div className="pt-1.5">
                <ConversaCompletaPrevia
                  carregando={conversaQuery.isFetching && !conversaQuery.data}
                  erro={conversaErro}
                  blocos={conversaDados?.blocos ?? []}
                  montada={conversaMontada}
                  cortada={conversaDados?.cortada ?? false}
                  contatoNome={conversaDados?.contato_nome ?? null}
                  bytesResumo={new TextEncoder().encode(corpoHtml).length}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">
          {trava.aviso && !gerando && (
            <div
              role="status"
              className="flex basis-full items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300"
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              {trava.aviso}
            </div>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <BotaoEnviarComAgenda
            enviando={enviando}
            desabilitado={trava.travado || ocupado || anexando}
            horario={horarioComercial}
            onEnviar={enviar}
            onAgendar={agendar}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

const linkCc =
  "rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2.5 rounded-lg border border-border px-4 pb-3 pt-1">
      <legend className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function Linha({ htmlFor, rotulo, children }: { htmlFor: string; rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-3">
      <Label htmlFor={htmlFor} className="font-normal text-muted-foreground">{rotulo}</Label>
      {children}
    </div>
  );
}
