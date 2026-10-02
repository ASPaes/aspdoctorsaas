import { useState } from "react";
import { format } from "date-fns";
import { Eye, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PreviaMensagemDialog } from "./PreviaMensagemDialog";
import { useCancelarEnvioLote, useItensEnvioLote, type EnvioLote, type ItemEnvioLote } from "./useEnvioLote";
import { useFunil } from "./useEnvioLoteExtras";

const ROTULO: Record<ItemEnvioLote["status"], string> = {
  pending: "Aguardando",
  sending: "Enviando",
  sent: "Enviada",
  failed: "Falhou",
  canceled: "Cancelada",
};

const COR: Record<ItemEnvioLote["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  sending: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300",
  canceled: "bg-muted text-muted-foreground line-through",
};

export function situacaoDoEnvio(e: EnvioLote): { rotulo: string; classe: string } {
  if (e.pendentes + e.enviando > 0) {
    const comecou = e.enviadas + e.falharam > 0 || e.enviando > 0;
    return comecou
      ? { rotulo: "Enviando", classe: COR.sending }
      : { rotulo: `Agendado ${format(new Date(e.inicio_em), "dd/MM HH:mm")}`, classe: COR.pending };
  }
  if (e.canceled_at && e.enviadas === 0) return { rotulo: "Cancelado", classe: COR.canceled.replace(" line-through", "") };
  if (e.falharam > 0) return { rotulo: `${e.enviadas} enviadas · ${e.falharam} falharam`, classe: COR.failed };
  return { rotulo: `${e.enviadas} enviadas`, classe: COR.sent };
}

function Contagem({ cor, n, rotulo }: { cor: string; n: number; rotulo: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums">
      <span className={`h-2 w-2 rounded-full ${cor}`} />
      {n} {rotulo}
    </span>
  );
}

export function DetalheEnvioLote({ envio }: { envio: EnvioLote }) {
  const { data: itens = [], isLoading } = useItensEnvioLote(envio.id);
  const cancelar = useCancelarEnvioLote();
  const [confirmar, setConfirmar] = useState(false);
  const [previa, setPrevia] = useState<ItemEnvioLote | null>(null);
  const [soResponderam, setSoResponderam] = useState(false);

  const c = (s: ItemEnvioLote["status"]) => itens.filter((i) => i.status === s).length;
  const total = itens.length || envio.total;
  const finalizadas = c("sent") + c("failed") + c("canceled");
  const pendentes = c("pending");
  const abertas = pendentes + c("sending");
  const sit = situacaoDoEnvio(envio);
  const { data: funil } = useFunil(envio.id, abertas > 0);
  const responderam = new Set(funil?.responderam_ids ?? []);
  const lista = soResponderam ? itens.filter((i) => responderam.has(i.conversation_id)) : itens;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{envio.titulo}</h2>
          <p className="text-xs text-muted-foreground">
            {total} destinatários · criado em {format(new Date(envio.created_at), "dd/MM/yyyy HH:mm")} · intervalo de {envio.intervalo_min_s} a {envio.intervalo_max_s} s
            {envio.media_file_name ? ` · PDF: ${envio.media_file_name}` : ""}
            {envio.message_type === "template" ? " · template da Meta" : ""}
          </p>
        </div>
        <Badge className={`shrink-0 border-0 ${sit.classe}`}>{sit.rotulo}</Badge>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <Contagem cor="bg-emerald-500" n={c("sent")} rotulo="enviadas" />
          <Contagem cor="bg-sky-500" n={c("sending")} rotulo="enviando" />
          <Contagem cor="bg-muted-foreground" n={pendentes} rotulo="aguardando" />
          <Contagem cor="bg-red-500" n={c("failed")} rotulo="falharam" />
          {c("canceled") > 0 && <Contagem cor="bg-muted-foreground/50" n={c("canceled")} rotulo="canceladas" />}
        </div>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${total ? (finalizadas / total) * 100 : 0}%` }} />
        </div>

        {funil && funil.enviadas > 0 && (
          <div className="mb-4 rounded-lg border border-border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Resultado</span>
              <span className="text-xs text-muted-foreground">Entregue e lida vêm do WhatsApp; resposta conta até 7 dias depois.</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["Enviadas", funil.enviadas],
                ["Entregues", funil.entregues],
                ["Lidas", funil.lidas],
                ["Responderam", funil.responderam],
              ] as [string, number][]).map(([rot, v]) => (
                <div key={rot} className="rounded-md bg-muted/60 px-3 py-2">
                  <div className="text-xs text-muted-foreground">{rot}</div>
                  <div className="text-lg font-bold tabular-nums">
                    {v}
                    <span className="ml-1 text-xs font-medium text-muted-foreground">{Math.round((v / funil.enviadas) * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
            {funil.responderam > 0 && (
              <Button variant="outline" size="sm" className="mt-2 h-8" onClick={() => setSoResponderam((v) => !v)}>
                {soResponderam ? "Mostrar todos" : `Ver só quem respondeu (${funil.responderam})`}
              </Button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando destinatários...</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Destinatário</th>
                  <th className="px-3 py-2 font-semibold">Horário</th>
                  <th className="px-3 py-2 font-semibold">Situação</th>
                  <th className="w-10 px-3 py-2"><span className="sr-only">Ver mensagem</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="px-3 py-2">{i.nome}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {format(new Date(i.sent_at || i.scheduled_at), "dd/MM HH:mm:ss")}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COR[i.status]}`}>{ROTULO[i.status]}</span>
                      {i.status === "failed" && i.last_error && (
                        <span className="ml-2 text-xs text-muted-foreground">{i.last_error}</span>
                      )}
                      {i.status === "pending" && i.attempts > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">nova tentativa ({i.attempts}/5)</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPrevia(i)} aria-label={`Ver mensagem enviada para ${i.nome}`} title="Ver mensagem">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          O envio acontece no servidor. Pode sair desta tela: ele continua e o resultado fica aqui.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <span className="text-sm text-muted-foreground">
          {abertas > 0 ? "Enviando em segundo plano." : "Envio concluído."}
        </span>
        {pendentes > 0 && (
          <Button variant="outline" className="border-red-500/40 text-red-600 hover:text-red-600" onClick={() => setConfirmar(true)} disabled={cancelar.isPending}>
            <XCircle className="mr-1.5 h-4 w-4" /> Cancelar os que faltam
          </Button>
        )}
      </div>

      <PreviaMensagemDialog
        aberto={!!previa}
        onFechar={() => setPrevia(null)}
        titulo={previa?.nome ?? ""}
        subtitulo={previa ? (previa.status === "sent" ? `Enviada em ${format(new Date(previa.sent_at || previa.scheduled_at), "dd/MM/yyyy HH:mm:ss")}` : `${ROTULO[previa.status]} · ${format(new Date(previa.scheduled_at), "dd/MM/yyyy HH:mm:ss")}`) : undefined}
        conteudo={previa?.content ?? ""}
        arquivo={previa?.media_file_name}
        mensagemId={previa?.sent_message_id}
        envioId={envio.id}
        horario={previa?.sent_at || previa?.scheduled_at}
      />

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar {pendentes} mensagens que ainda não saíram?</AlertDialogTitle>
            <AlertDialogDescription>
              As que já foram enviadas continuam nas conversas. Isso não tem como desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                try {
                  const n = await cancelar.mutateAsync(envio.id);
                  toast.success(`${n} mensagens canceladas.`);
                } catch (e: any) {
                  toast.error(e?.message || "Não foi possível cancelar.");
                }
              }}
            >
              Cancelar envio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
