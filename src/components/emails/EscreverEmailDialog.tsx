import { useEffect, useRef, useState } from "react";
import { Loader2, Reply, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { EditorEmail } from "@/components/whatsapp/chat/email/EditorEmail";
import { CampoEmails } from "@/components/whatsapp/chat/email/EnviarEmailChatDialog";
import { BotaoAnexar, ListaAnexos, type AnexoNaTela } from "@/components/whatsapp/chat/email/AnexosEmail";
import { useContasDeEnvio } from "@/components/whatsapp/chat/email/useEmailChatDados";
import {
  ANEXO_MAX_ARQUIVOS,
  ANEXO_MAX_TOTAL_BYTES,
  anexoPermitido,
  formatarTamanho,
  htmlParaEmail,
} from "@/components/whatsapp/chat/email/travaEnvioEmail";
import { buscarAnexo } from "./AnexosDoEmail";
import { useOpcoesFiltro } from "./useEmailsEnviados";
import { uploadAnexoEmail } from "@/components/whatsapp/chat/email/uploadAnexoEmail";
import {
  ORIGEM_DO_MODO,
  ROTULO_MODO,
  assuntoDaEscrita,
  corpoInicial,
  destinatariosDaResposta,
  type ModoEscrita,
} from "./respostaEmail";

/** o e-mail que originou a resposta; vem da lista ou do e-mail aberto */
export interface EmailOriginal {
  id: string;
  tipo: "enviado" | "recebido";
  de: string | null;
  para: string[];
  cc?: string[];
  assunto: string | null;
  quando: string | null;
  corpoHtml?: string | null;
  corpoTexto?: string | null;
  clienteId?: string | null;
  departmentId?: string | null;
  /** atendimento ou ticket a que o e-mail já estava ligado */
  referenciaId?: string | null;
  /** anexos guardados do e-mail recebido; no encaminhar eles já entram prontos */
  anexos?: { nome: string; mime: string; tamanho: number; caminho: string }[];
}

export interface PedidoEscrita {
  modo: ModoEscrita;
  original: EmailOriginal;
}

/**
 * Anexos do original já prontos para o encaminhamento: nada sobe de novo, o
 * caminho no Storage é que vai no envio. Os mesmos limites do anexo comum valem
 * aqui, e o que passar do teto fica de fora com aviso, em vez de derrubar o envio.
 */
function anexosDoOriginal(lista: NonNullable<EmailOriginal["anexos"]>): {
  anexos: AnexoNaTela[];
  deixados: string[];
} {
  const anexos: AnexoNaTela[] = [];
  const deixados: string[] = [];
  let total = 0;

  for (const a of lista) {
    if (!anexoPermitido(a.mime, a.nome)) {
      deixados.push(`${a.nome} (tipo de arquivo não aceito)`);
    } else if (anexos.length >= ANEXO_MAX_ARQUIVOS) {
      deixados.push(`${a.nome} (passou de ${ANEXO_MAX_ARQUIVOS} arquivos)`);
    } else if (total + a.tamanho > ANEXO_MAX_TOTAL_BYTES) {
      deixados.push(`${a.nome} (passou de ${formatarTamanho(ANEXO_MAX_TOTAL_BYTES)} somados)`);
    } else {
      total += a.tamanho;
      anexos.push({
        id: crypto.randomUUID(),
        nome: a.nome,
        tamanho: a.tamanho,
        mime: a.mime,
        status: "pronto",
        path: a.caminho,
        bucket: "ticket-attachments",
      });
    }
  }
  return { anexos, deixados };
}

/**
 * Responder, responder a todos e encaminhar pela tela E-mails (entrega 3,
 * 15/09/2026). É a tela de escrever e-mail FORA do chat: o editor, o anexo e o
 * campo de destinatários são os mesmos do chat, e quem envia continua sendo a
 * send-email (porta única de saída, com assinatura e registro em email_envios).
 *
 * Encaminhar leva os anexos do original junto (16/09/2026): eles já estão no
 * bucket `ticket-attachments` e vão pela send-email pelo caminho, sem passar
 * pelo navegador. O cartão deixa tirar o que não deve ir, e ver ou baixar antes.
 */
export function EscreverEmailDialog({
  pedido,
  onOpenChange,
  onEnviou,
}: {
  pedido: PedidoEscrita | null;
  onOpenChange: (aberto: boolean) => void;
  onEnviou?: () => void;
}) {
  const { user, profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const aberto = !!pedido;

  const contasQuery = useContasDeEnvio(tid, user?.id ?? null, profile?.is_super_admin === true, aberto);
  const { contas: contasDoTenant } = useOpcoesFiltro();
  const contas = contasQuery.data?.contas ?? [];

  const [contaId, setContaId] = useState("");
  const [para, setPara] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [mostrarCc, setMostrarCc] = useState(false);
  const [mostrarCco, setMostrarCco] = useState(false);
  const [assunto, setAssunto] = useState("");
  const [corpoHtml, setCorpoHtml] = useState("");
  const [corpoTexto, setCorpoTexto] = useState("");
  const [versaoCorpo, setVersaoCorpo] = useState(0);
  const [anexos, setAnexos] = useState<AnexoNaTela[]>([]);
  const [enviando, setEnviando] = useState(false);
  const chave = useRef<string | null>(null);

  const original = pedido?.original;
  const modo = pedido?.modo ?? "responder";
  const anexando = anexos.some((a) => a.status === "enviando");

  // cada abertura monta destinatários, assunto e citação a partir do original
  useEffect(() => {
    if (!pedido || !original) return;
    const atual = `${pedido.modo}:${original.id}`;
    if (chave.current === atual) return;
    chave.current = atual;

    const destinos = destinatariosDaResposta({
      modo: pedido.modo,
      de: original.tipo === "recebido" ? original.de : (original.para?.[0] ?? null),
      para: original.para ?? [],
      cc: original.cc ?? [],
      contasDaCasa: (contasDoTenant ?? []).map((c: any) => c.email),
    });

    setPara(destinos.para);
    setCc(destinos.cc);
    setMostrarCc(destinos.cc.length > 0);
    setCco([]);
    setMostrarCco(false);
    setAssunto(assuntoDaEscrita(pedido.modo, original.assunto));
    setCorpoHtml(
      corpoInicial(pedido.modo, {
        de: original.de,
        quando: original.quando,
        assunto: original.assunto,
        corpoHtml: original.corpoHtml,
        corpoTexto: original.corpoTexto,
      }),
    );
    setVersaoCorpo((v) => v + 1);
    const doOriginal = pedido.modo === "encaminhar" ? anexosDoOriginal(original.anexos ?? []) : { anexos: [], deixados: [] };
    setAnexos(doOriginal.anexos);
    if (doOriginal.deixados.length) {
      toast.warning(`Não coube no encaminhamento: ${doOriginal.deixados.join("; ")}.`, { duration: 10000 });
    }
    setEnviando(false);
    setContaId(contas.length === 1 ? contas[0].id : "");
  }, [pedido, original, contas, contasDoTenant]);

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
    if (aceitos.length === 0 || !tid) return;
    setAnexos((lista) => [...lista, ...aceitos.map((a) => a.anexo)]);

    for (const { anexo, arquivo } of aceitos) {
      uploadAnexoEmail(tid, arquivo)
        .then((r) =>
          setAnexos((lista) => lista.map((x) => (x.id === anexo.id ? { ...x, status: "pronto", path: r.storagePath } : x))),
        )
        .catch((err: any) =>
          setAnexos((lista) =>
            lista.map((x) => (x.id === anexo.id ? { ...x, status: "erro", erro: err?.message || "Falha no upload" } : x)),
          ),
        );
    }
  };

  const enviar = async () => {
    if (enviando || !original || !tid) return;
    if (anexando) {
      toast.error("Espere os arquivos terminarem de anexar antes de enviar.");
      return;
    }
    if (anexos.some((a) => a.status === "erro")) {
      toast.error("Tire os anexos que falharam antes de enviar.");
      return;
    }
    const faltando: string[] = [];
    if (!contaId) faltando.push("o remetente");
    if (para.length === 0) faltando.push("pelo menos um destinatário");
    if (!assunto.trim()) faltando.push("o assunto");
    if (!corpoTexto.trim()) faltando.push("o texto do e-mail");
    if (faltando.length) {
      toast.error(`Falta preencher ${faltando.join(", ")}.`);
      return;
    }

    setEnviando(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          tenant_id: tid,
          account_id: contaId,
          to: para,
          cc,
          bcc: cco,
          subject: assunto.trim(),
          text: corpoTexto.trim(),
          html: htmlParaEmail(corpoHtml),
          origem: ORIGEM_DO_MODO[modo],
          referencia_id: original.referenciaId ?? null,
          cliente_id: original.clienteId ?? null,
          department_id: original.departmentId ?? null,
          anexos: anexos
            .filter((a) => a.status === "pronto" && a.path)
            .map((a) => ({ path: a.path!, nome: a.nome, mime: a.mime, bucket: a.bucket ?? "whatsapp-media" })),
        },
      });

      if (error) {
        let mensagem = error.message || "Falha ao falar com o servidor.";
        try {
          const corpo = await (error as any)?.context?.json?.();
          if (corpo?.error || corpo?.mensagem) mensagem = String(corpo.error || corpo.mensagem);
        } catch {
          // corpo não era JSON
        }
        toast.error(mensagem, { duration: 12000 });
        return;
      }

      const r = data as any;
      if (r?.ok !== true) {
        toast.error(r?.mensagem || r?.error || "O e-mail não foi enviado.", { duration: 12000 });
        return;
      }
      toast.success(r.mensagem || "E-mail enviado.");
      onEnviou?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível enviar o e-mail.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="static m-0 space-y-1 border-b border-border px-6 pb-4 pr-12 pt-5 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Reply className="h-4 w-4" />
            {ROTULO_MODO[modo]}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {original?.assunto ? `Sobre: ${original.assunto}` : "E-mail sem assunto"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto px-6 py-4">
          <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-3">
            <Label htmlFor="escrever-remetente" className="font-normal text-muted-foreground">Remetente</Label>
            <Select value={contaId} onValueChange={setContaId} disabled={contas.length === 0}>
              <SelectTrigger id="escrever-remetente" className="h-9">
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
          </div>

          <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-3">
            <Label htmlFor="escrever-para" className="font-normal text-muted-foreground">Destinatário</Label>
            <CampoEmails
              id="escrever-para"
              valores={para}
              onChange={setPara}
              sugestoes={[]}
              placeholder="Adicionar destinatário"
              extra={
                <span className="ml-auto flex shrink-0 gap-0.5">
                  {!mostrarCc && (
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setMostrarCc(true)}
                    >
                      Cc
                    </button>
                  )}
                  {!mostrarCco && (
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setMostrarCco(true)}
                    >
                      Cco
                    </button>
                  )}
                </span>
              }
            />
          </div>

          {mostrarCc && (
            <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-3">
              <Label htmlFor="escrever-cc" className="font-normal text-muted-foreground">Cc</Label>
              <CampoEmails id="escrever-cc" valores={cc} onChange={setCc} sugestoes={[]} placeholder="Com cópia" />
            </div>
          )}
          {mostrarCco && (
            <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-3">
              <Label htmlFor="escrever-cco" className="font-normal text-muted-foreground">Cco</Label>
              <CampoEmails id="escrever-cco" valores={cco} onChange={setCco} sugestoes={[]} placeholder="Com cópia oculta" />
            </div>
          )}

          <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-3">
            <Label htmlFor="escrever-assunto" className="font-normal text-muted-foreground">Assunto</Label>
            <Input
              id="escrever-assunto"
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
              className="h-9"
              maxLength={300}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="escrever-corpo" className="font-normal text-muted-foreground">Mensagem</Label>
            <EditorEmail
              id="escrever-corpo"
              valor={corpoHtml}
              versao={versaoCorpo}
              onChange={(c) => {
                setCorpoHtml(c.html);
                setCorpoTexto(c.vazio ? "" : c.texto);
              }}
              desabilitado={enviando}
              placeholder="Escreva a resposta"
              acaoAnexar={<BotaoAnexar desabilitado={enviando} onEscolher={adicionarAnexos} />}
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
                a.bucket === "ticket-attachments" && a.path
                  ? buscarAnexo(a.path)
                  : Promise.reject(new Error("Este arquivo ainda está sendo anexado."))
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={enviando || anexando} className="gap-2">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {enviando ? "Enviando..." : "Enviar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
