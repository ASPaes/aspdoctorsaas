// Janela "Histórico de agendamentos", aberta pelo link no rodapé da aba Agendar.
// Uma linha por agendamento da conversa: quando foi feito, para quando, quem
// agendou, o tipo (novo atendimento × mensagem nesta conversa), a mensagem, a
// situação e o atendimento que ele abriu.
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Headset, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useUserNames } from "@/hooks/useUserNames";
import { useScheduledHistory, type ScheduledHistoryRow } from "../../hooks/useScheduledHistory";

type Filtro = "todos" | "pendentes" | "enviados" | "cancelados" | "falharam";

const FILTROS: Array<{ id: Filtro; label: string; status: string[] | null }> = [
  { id: "todos", label: "Todos", status: null },
  { id: "pendentes", label: "Pendentes", status: ["pending", "sending"] },
  { id: "enviados", label: "Enviados", status: ["sent"] },
  { id: "cancelados", label: "Cancelados", status: ["canceled"] },
  { id: "falharam", label: "Falharam", status: ["failed"] },
];

const dataHora = (iso: string | null) =>
  iso ? format(new Date(iso), "dd/MM/yy HH:mm", { locale: ptBR }) : "";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactName?: string | null;
}

export function ScheduledHistoryDialog({ open, onOpenChange, conversationId, contactName }: Props) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const { data, isLoading, isError } = useScheduledHistory(conversationId, open);
  const rows = data?.rows ?? [];
  const codigos = data?.codigos ?? {};

  const pessoas = useMemo(
    () => rows.flatMap((r) => [r.created_by, r.canceled_by]).filter(Boolean) as string[],
    [rows],
  );
  const { data: nomes = {} } = useUserNames(pessoas);
  const nome = (id: string | null) => (id ? nomes[id] || "Usuário removido" : "");

  const contagem = (f: (typeof FILTROS)[number]) =>
    f.status ? rows.filter((r) => f.status!.includes(r.status)).length : rows.length;

  const visiveis = useMemo(() => {
    const f = FILTROS.find((x) => x.id === filtro)!;
    return f.status ? rows.filter((r) => f.status!.includes(r.status)) : rows;
  }, [rows, filtro]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[1180px] p-0 gap-0">
        {/* static z-0 m-0: o DialogHeader do projeto tem margem negativa e z-20 para o p-6
            padrão; com p-0 ele corta o título e cobre o X. pr-12 = espaço do X. */}
        <DialogHeader className="static z-0 m-0 px-5 pt-4 pb-3 pr-12 border-b text-left">
          <DialogTitle className="text-base">Histórico de agendamentos</DialogTitle>
          <DialogDescription className="text-xs">
            {contactName ? `${contactName} · ` : ""}tudo o que foi agendado nesta conversa, do mais recente ao mais antigo
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5 px-5 py-2.5 border-b" role="group" aria-label="Filtrar por situação">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60",
                filtro === f.id
                  ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label} ({contagem(f)})
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-auto">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : isError ? (
            <p className="px-5 py-8 text-sm text-destructive">Não foi possível carregar o histórico. Feche e abra de novo.</p>
          ) : visiveis.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">
              {rows.length === 0 ? "Nenhum agendamento nesta conversa." : "Nenhum agendamento nesta situação."}
            </p>
          ) : (
            <table className="w-full min-w-[960px] text-[12.5px]">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Agendado em</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Para</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Quem agendou</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Tipo</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Mensagem</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Situação</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Atendimento</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{dataHora(r.created_at)}</td>
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{dataHora(r.scheduled_at)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{nome(r.created_by)}</td>
                    <td className="px-3 py-2.5">
                      {r.opens_attendance ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                          <Headset className="h-3 w-3" /> Novo atendimento
                        </span>
                      ) : (
                        <span className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          Mensagem nesta conversa
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Mensagem r={r} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Situacao r={r} nome={nome} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.opens_attendance ? (
                        r.attendance_id ? (
                          <span className="font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                            {codigos[r.attendance_id] || "aberto"}
                          </span>
                        ) : (
                          <span className="text-[11.5px] text-muted-foreground">abre na hora</span>
                        )
                      ) : (
                        <span className="text-[11.5px] text-muted-foreground">não abre</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="border-t px-5 py-2.5 text-[11.5px] text-muted-foreground">
          Se o agendamento foi reagendado ou teve o texto alterado, a linha mostra o horário e o texto finais.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Mensagem({ r }: { r: ScheduledHistoryRow }) {
  const texto = r.content?.trim()
    || (r.media_file_name ? `Anexo: ${r.media_file_name}` : r.message_type !== "text" ? "Só o anexo" : "");
  return (
    <div className="max-w-[26ch]">
      <p className="truncate" title={texto}>{texto}</p>
      {r.message_type === "template" && <span className="text-[11px] text-muted-foreground">template Meta</span>}
      {r.content?.trim() && r.media_file_name && (
        <span className="block truncate text-[11px] text-muted-foreground" title={r.media_file_name}>anexo: {r.media_file_name}</span>
      )}
    </div>
  );
}

function Situacao({ r, nome }: { r: ScheduledHistoryRow; nome: (id: string | null) => string }) {
  const falhouAntes = r.status === "canceled" && r.last_error && r.attempts > 0;

  let rotulo: string;
  let quando: string | null = null;
  let cor: string;

  switch (r.status) {
    case "sent":
      rotulo = "Enviada";
      quando = r.sent_at;
      cor = "text-green-600 dark:text-green-400";
      break;
    case "canceled":
      rotulo = r.cancel_reason === "client_replied"
        ? "Cancelada: o cliente respondeu antes"
        : r.cancel_reason === "sent_now"
        ? `Enviada na hora por ${nome(r.canceled_by) || "operador"}`
        : `Cancelada por ${nome(r.canceled_by) || "operador"}`;
      quando = r.canceled_at;
      cor = "text-muted-foreground";
      break;
    case "failed":
      rotulo = "Não foi enviada";
      cor = "text-destructive";
      break;
    default:
      rotulo = r.status === "sending" ? "Saindo agora" : "Pendente";
      cor = "text-sky-600 dark:text-sky-400";
  }

  return (
    <div className="min-w-[16ch]">
      <span className={cn("inline-flex items-center gap-1.5 text-[11.5px] font-semibold", cor)}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
        {rotulo}
      </span>
      {quando && <span className="block text-[11px] tabular-nums text-muted-foreground">{dataHora(quando)}</span>}
      {r.status === "failed" && r.last_error && (
        <span className="block max-w-[30ch] truncate text-[11px] text-destructive/80" title={r.last_error}>
          {r.last_error}
        </span>
      )}
      {falhouAntes && (
        <span className="block max-w-[30ch] truncate text-[11px] text-destructive/80" title={r.last_error || ""}>
          antes: falhou {r.attempts} {r.attempts === 1 ? "vez" : "vezes"}
        </span>
      )}
    </div>
  );
}
