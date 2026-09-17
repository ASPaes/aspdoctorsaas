import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, CalendarClock, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useBusinessHoursConfig } from "@/components/whatsapp/hooks/useBusinessHoursConfig";
import { EscolherHorario, descreverHorario, lerHorario, problemaDoHorario } from "@/components/whatsapp/chat/email/EscolherHorario";
import { paraInputLocal } from "@/components/whatsapp/chat/input/ScheduleBar";
import { useAcaoAgendado, useEmailsAgendados, type EmailAgendado } from "./useEmailsAgendados";
import { ROTULO_ORIGEM } from "./useEmailsEnviados";

/**
 * Agendados no topo de Enviados (mockup "E-mail etapa 2", 16/09/2026): o que
 * ainda vai sair, com Mudar horário, Enviar agora e Cancelar, e o que falhou nos
 * últimos 7 dias, com o motivo. Enviado sai daqui e aparece na lista normal.
 */
export function EmailsAgendadosBloco() {
  const { data: agendados = [], isLoading } = useEmailsAgendados();
  if (isLoading || agendados.length === 0) return null;

  const pendentes = agendados.filter((a) => a.status !== "erro").length;

  return (
    <section className="overflow-hidden rounded-lg border border-sky-500/30" aria-label="E-mails agendados">
      <header className="flex items-center gap-2 border-b border-sky-500/20 bg-sky-500/5 px-3 py-2 text-sm">
        <CalendarClock className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        <span className="font-semibold">Agendados</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {pendentes} para sair{agendados.length > pendentes ? ` · ${agendados.length - pendentes} com erro` : ""}
        </span>
      </header>
      <ul className="divide-y">
        {agendados.map((a) => (
          <LinhaAgendado key={a.id} agendado={a} />
        ))}
      </ul>
    </section>
  );
}

function LinhaAgendado({ agendado: a }: { agendado: EmailAgendado }) {
  const { user, profile } = useAuth();
  const acao = useAcaoAgendado();
  const horario = useBusinessHoursConfig();
  const [mudando, setMudando] = useState(false);
  const [novoHorario, setNovoHorario] = useState("");
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  const podeMexer =
    a.status === "agendado" &&
    (profile?.is_super_admin === true || ["admin", "head"].includes(profile?.role ?? "") || a.agendado_por === user?.id);
  const quando = new Date(a.agendar_para);
  const novo = lerHorario(novoHorario);

  const executar = (v: Parameters<typeof acao.mutate>[0], sucesso: string) =>
    acao.mutate(v, {
      onSuccess: () => toast.success(sucesso),
      onError: (err: any) => toast.error(err?.message || "Não foi possível concluir."),
    });

  return (
    <li className="grid gap-2 px-3 py-2.5 text-sm md:grid-cols-[110px_minmax(0,1fr)_150px_auto] md:items-center">
      <span
        className={cn(
          "inline-flex w-max items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
          a.status === "erro"
            ? "bg-destructive/10 text-destructive"
            : a.status === "enviando"
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "bg-sky-500/15 text-sky-700 dark:text-sky-400",
        )}
      >
        {a.status === "enviando" && <Loader2 className="h-3 w-3 animate-spin" />}
        {a.status === "erro" && <AlertTriangle className="h-3 w-3" />}
        {a.status === "agendado" ? "Agendado" : a.status === "enviando" ? "Saindo" : "Erro"}
      </span>

      <div className="min-w-0">
        <p className="truncate font-medium" title={a.assunto}>
          {a.assunto}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          Para {a.para.join(", ")} · {ROTULO_ORIGEM[a.origem] ?? a.origem}
        </p>
        {a.status === "erro" && a.erro && <p className="mt-0.5 text-xs text-destructive">{a.erro}</p>}
      </div>

      <span className="text-xs tabular-nums text-muted-foreground md:text-sm">
        {format(quando, "EEE, dd/MM 'às' HH:mm", { locale: ptBR })}
      </span>

      <div className="flex flex-wrap justify-start gap-1.5 md:justify-end">
        {podeMexer && (
          <>
            <Popover
              open={mudando}
              onOpenChange={(v) => {
                if (v) setNovoHorario(paraInputLocal(quando));
                setMudando(v);
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={acao.isPending}>
                  <CalendarClock className="h-3.5 w-3.5" />
                  Mudar horário
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[21rem] space-y-3">
                <p className="text-sm font-semibold">Mudar horário</p>
                <EscolherHorario id={`reagendar-${a.id}`} valor={novoHorario} onChange={setNovoHorario} horario={horario} />
                {novoHorario && problemaDoHorario(novo) && (
                  <p className="text-xs font-medium text-destructive">{problemaDoHorario(novo)}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setMudando(false)}>
                    Voltar
                  </Button>
                  <Button
                    size="sm"
                    disabled={!novo || !!problemaDoHorario(novo) || acao.isPending}
                    onClick={() => {
                      if (!novo) return;
                      setMudando(false);
                      executar(
                        { id: a.id, acao: "reagendar", quando: novo },
                        `Agendado para ${descreverHorario(novo)}.`,
                      );
                    }}
                  >
                    Salvar
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={acao.isPending}
              onClick={() => executar({ id: a.id, acao: "enviar_agora" }, "O e-mail sai em até 1 minuto.")}
            >
              <Send className="h-3.5 w-3.5" />
              Enviar agora
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
              disabled={acao.isPending}
              onClick={() => setConfirmarCancelar(true)}
            >
              <X className="h-3.5 w-3.5" />
              Cancelar
            </Button>
          </>
        )}
      </div>

      <AlertDialog open={confirmarCancelar} onOpenChange={setConfirmarCancelar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar o e-mail agendado?</AlertDialogTitle>
            <AlertDialogDescription>
              "{a.assunto}" não vai sair. Para mudar o texto, cancele e agende de novo pelo chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => executar({ id: a.id, acao: "cancelar" }, "Envio cancelado.")}>
              Cancelar envio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
