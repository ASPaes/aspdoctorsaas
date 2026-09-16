import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Archive, ArchiveRestore, FolderInput, Forward, Loader2, Mail, Paperclip, Reply, ReplyAll } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListaDeAnexos } from "./AnexosDoEmail";
import { useArquivarEmails } from "./useArquivarEmails";
import { MoverParaPasta } from "./MenuPastas";
import { useMoverParaPasta } from "./usePastasEmail";
import { EscreverEmailDialog, type PedidoEscrita } from "./EscreverEmailDialog";
import type { ModoEscrita } from "./respostaEmail";

/**
 * Abre o e-mail inteiro a partir da lista (pedido do Alexandre, 15/09/2026:
 * "hoje fica só em uma linha e não dá para visualizar").
 *
 * Recebidos: o texto já era guardado pelo robô de leitura.
 * Enviados: o corpo passou a ser guardado em 15/09; envio anterior a essa data
 * abre sem texto, e a tela diz isso em vez de aparecer vazia.
 *
 * O HTML do enviado vai num iframe com sandbox vazio: sem script, sem
 * navegação, sem acesso à página. É conteúdo que já saiu daqui, mas continua
 * sendo texto livre.
 */
interface Props {
  tipo: "enviado" | "recebido";
  id: string | null;
  onOpenChange: (aberto: boolean) => void;
}

const COLUNAS_ENVIADO =
  "id, created_at, assunto, remetente, para, cc, origem, status, erro, corpo_texto, corpo_html, arquivado_em, deleted_at, " +
  "cliente_id, department_id, referencia_id, " +
  "pasta_id, email_pastas(nome, cor), email_accounts(email, rotulo), clientes(razao_social, nome_fantasia), support_departments(name)";

const COLUNAS_RECEBIDO =
  "id, recebido_em, assunto, de_email, de_nome, para, corpo_texto, anexos, anexos_ignorados, arquivado_em, deleted_at, acao, ticket_id, " +
  "cliente_id, department_id, referencia_id, " +
  "pasta_id, email_pastas(nome, cor), email_accounts(email, rotulo), clientes(razao_social, nome_fantasia), support_departments(name), " +
  "support_tickets!email_recebidos_ticket_id_fkey(ticket_code)";

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export function LerEmailDialog({ tipo, id, onOpenChange }: Props) {
  const arquivar = useArquivarEmails(tipo === "enviado" ? "enviados" : "recebidos");
  const mover = useMoverParaPasta(tipo === "enviado" ? "enviados" : "recebidos");
  const [escrevendo, setEscrevendo] = useState<PedidoEscrita | null>(null);

  /** monta o original que a tela de escrever usa para o assunto, o Para e a citação */
  const abrirEscrita = (modo: ModoEscrita) => {
    if (!email) return;
    setEscrevendo({
      modo,
      original: {
        id: email.id,
        tipo,
        de: tipo === "enviado" ? email.remetente : email.de_email,
        para: email.para ?? [],
        cc: email.cc ?? [],
        assunto: email.assunto,
        quando: tipo === "enviado" ? email.created_at : email.recebido_em,
        corpoHtml: email.corpo_html ?? null,
        corpoTexto: email.corpo_texto ?? null,
        clienteId: email.cliente_id ?? null,
        departmentId: email.department_id ?? null,
        referenciaId: email.referencia_id ?? email.ticket_id ?? null,
        temAnexos: (email.anexos ?? []).length > 0,
      },
    });
  };

  const { data: email, isLoading } = useQuery({
    queryKey: ["email_leitura", tipo, id],
    enabled: !!id,
    staleTime: 30_000,
    queryFn: async () => {
      const tabela = tipo === "enviado" ? "email_envios" : "email_recebidos";
      const { data, error } = await (supabase.from(tabela as any) as any)
        .select(tipo === "enviado" ? COLUNAS_ENVIADO : COLUNAS_RECEBIDO)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const cliente = email?.clientes?.nome_fantasia || email?.clientes?.razao_social || null;
  const quando = email ? dataHora(tipo === "enviado" ? email.created_at : email.recebido_em) : "";
  const estaArquivado = !!email?.arquivado_em;
  const anexos = tipo === "recebido" ? (email?.anexos ?? []) : [];

  const alternarArquivo = () => {
    if (!id) return;
    arquivar.mutate(
      { ids: [id], arquivar: !estaArquivado },
      {
        onSuccess: ({ afetados, bloqueados }) => {
          if (afetados > 0) {
            toast.success(estaArquivado ? "E-mail devolvido para a lista." : "E-mail arquivado.");
            onOpenChange(false);
          } else {
            toast.error(
              bloqueados
                ? "Não deu para mudar: o e-mail é de outra pessoa ou já está nesse estado."
                : "Nada mudou.",
            );
          }
        },
        onError: (err: any) => toast.error(err?.message || "Não foi possível arquivar."),
      },
    );
  };

  return (
    <Dialog open={!!id} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-6 text-base">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">{email?.assunto || (isLoading ? "Abrindo..." : "E-mail sem assunto")}</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando o e-mail...
          </div>
        )}

        {email && (
          <>
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-muted-foreground">De</dt>
              <dd className="min-w-0 break-words">
                {tipo === "enviado"
                  ? email.remetente
                  : `${email.de_nome ? `${email.de_nome} ` : ""}<${email.de_email}>`}
              </dd>
              <dt className="text-muted-foreground">Para</dt>
              <dd className="min-w-0 break-words">{(email.para ?? []).join(", ") || "-"}</dd>
              {tipo === "enviado" && (email.cc ?? []).length > 0 && (
                <>
                  <dt className="text-muted-foreground">Cc</dt>
                  <dd className="min-w-0 break-words">{email.cc.join(", ")}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{tipo === "enviado" ? "Enviado" : "Recebido"}</dt>
              <dd>{quando}</dd>
              {cliente && (
                <>
                  <dt className="text-muted-foreground">Cliente</dt>
                  <dd className="min-w-0 break-words">{cliente}</dd>
                </>
              )}
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              {email.support_departments?.name && <Badge variant="outline">{email.support_departments.name}</Badge>}
              {email.email_accounts?.rotulo && <Badge variant="outline">{email.email_accounts.rotulo}</Badge>}
              {email.support_tickets?.ticket_code && <Badge variant="outline">{email.support_tickets.ticket_code}</Badge>}
              {tipo === "enviado" && email.status === "erro" && <Badge variant="destructive">Não saiu</Badge>}
              {email.email_pastas && (
                <Badge variant="outline" className="gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: email.email_pastas.cor }} aria-hidden />
                  {email.email_pastas.nome}
                </Badge>
              )}
              {estaArquivado && <Badge variant="secondary">Arquivado</Badge>}
            </div>

            {tipo === "enviado" && email.erro && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                {email.erro}
              </p>
            )}

            <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
              {email.corpo_html ? (
                <iframe
                  title="Corpo do e-mail"
                  sandbox=""
                  srcDoc={email.corpo_html}
                  className="h-[46vh] w-full bg-white"
                />
              ) : email.corpo_texto ? (
                <p className="whitespace-pre-wrap px-4 py-3 text-[13.5px] leading-relaxed">{email.corpo_texto}</p>
              ) : (
                <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                  {tipo === "enviado"
                    ? "Este e-mail foi enviado antes de o sistema passar a guardar o texto, então só o cabeçalho ficou registrado."
                    : "Este e-mail chegou sem texto."}
                </p>
              )}
            </div>

            {anexos.length > 0 && (
              <div className="rounded-md border border-border p-2">
                <p className="flex items-center gap-1.5 px-1 pb-1 text-xs font-medium text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5" />
                  {anexos.length} anexo{anexos.length === 1 ? "" : "s"}
                </p>
                <ListaDeAnexos anexos={anexos} ignorados={email.anexos_ignorados ?? []} semTicket={!email.ticket_id} />
              </div>
            )}
          </>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:justify-start sm:gap-2">
          {email && !email.deleted_at && (
            <>
              <Button variant="outline" onClick={() => abrirEscrita("responder")}>
                <Reply className="mr-2 h-4 w-4" />
                Responder
              </Button>
              <Button variant="outline" onClick={() => abrirEscrita("responder_todos")}>
                <ReplyAll className="mr-2 h-4 w-4" />
                Responder a todos
              </Button>
              <Button variant="outline" onClick={() => abrirEscrita("encaminhar")}>
                <Forward className="mr-2 h-4 w-4" />
                Encaminhar
              </Button>
            </>
          )}
          {email && !email.deleted_at && (
            <MoverParaPasta
              pastaAtual={email.pasta_id ?? null}
              desabilitado={mover.isPending}
              onMover={(pastaId) =>
                mover.mutate(
                  { ids: [email.id], pastaId },
                  {
                    onSuccess: ({ afetados }) =>
                      afetados > 0
                        ? toast.success(pastaId ? "E-mail movido para a pasta." : "E-mail tirado da pasta.")
                        : toast.error("Não deu para mover: o e-mail é de outra pessoa ou já estava assim."),
                    onError: (err: any) => toast.error(err?.message || "Não foi possível mover."),
                  },
                )
              }
            >
              <Button variant="outline" disabled={mover.isPending}>
                {mover.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderInput className="mr-2 h-4 w-4" />}
                Mover para
              </Button>
            </MoverParaPasta>
          )}
          {email && !email.deleted_at && (
            <Button variant="outline" onClick={alternarArquivo} disabled={arquivar.isPending}>
              {arquivar.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : estaArquivado ? (
                <ArchiveRestore className="mr-2 h-4 w-4" />
              ) : (
                <Archive className="mr-2 h-4 w-4" />
              )}
              {estaArquivado ? "Tirar do arquivo" : "Arquivar"}
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)} className="sm:ml-auto">
            Fechar
          </Button>
        </DialogFooter>

        <EscreverEmailDialog
          pedido={escrevendo}
          onOpenChange={(aberto) => !aberto && setEscrevendo(null)}
          // enviou: fecha o e-mail aberto e a lista recarrega com o envio novo
          onEnviou={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
