import { useMemo, useState } from "react";
import { Loader2, Sparkles, AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import { useGroupSummaries } from "./useGroupSummaries";
import { GroupSummaryDialog, PendingPills, summaryLabel, useGroupAttendances, type GroupSummaryStart } from "./GroupSummaryDialog";

interface Props {
  conversationId: string;
  groupName: string;
  onGoToMessage?: (target: { id: string; at: string }) => void;
}

/** DEM-0277: seção "Resumo do grupo (IA)" do painel Detalhes, só em grupos. */
export function GroupSummarySection({ conversationId, groupName, onGoToMessage }: Props) {
  const { timezone } = useAppTimezone();
  const { summaries, names, isLoading } = useGroupSummaries(conversationId);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<GroupSummaryStart>({ view: "new" });
  const hasAttendanceSummary = summaries.some((s) => s.attendance_id);
  const attendances = useGroupAttendances(conversationId, hasAttendanceSummary);
  const codeById = useMemo(() => new Map((attendances.data ?? []).map((a) => [a.id, a.attendance_code])), [attendances.data]);

  const openWith = (s: GroupSummaryStart) => { setStart(s); setOpen(true); };
  const monthCount = useMemo(() => {
    const ym = (iso: string) => new Intl.DateTimeFormat("pt-BR", { month: "2-digit", year: "numeric", timeZone: timezone }).format(new Date(iso));
    const now = ym(new Date().toISOString());
    return summaries.filter((s) => ym(s.created_at) === now).length;
  }, [summaries, timezone]);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: timezone })
      .format(new Date(iso)).replace(",", "");

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-green-500/50 bg-gradient-to-b from-green-50 to-transparent p-2.5 dark:from-green-950/40">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Sparkles className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        Resumo do grupo (IA)
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Junta pendências, decisões e próximos passos das mensagens do grupo, no período que você escolher.
      </p>
      <Button size="sm" className="h-8 w-full gap-1.5 bg-green-600 text-xs text-white hover:bg-green-700" onClick={() => openWith({ view: "new" })}>
        <Sparkles className="h-3.5 w-3.5" />
        Resumir conversa
      </Button>

      {isLoading ? null : summaries.length === 0 ? (
        <p className="py-1 text-center text-[11px] italic text-muted-foreground">Nenhum resumo gerado neste grupo.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="mt-0.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Resumos salvos</span>
            {monthCount > 0 && <span>{monthCount} este mês</span>}
          </div>
          {summaries.slice(0, 3).map((s) => (
            <button
              key={s.id}
              onClick={() => openWith({ view: "summary", id: s.id })}
              className="flex min-w-0 flex-col gap-1 rounded-md border bg-background px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
            >
              <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
                <span className="shrink-0 font-semibold tabular-nums">{when(s.created_at)}</span>
                <span className="ml-auto truncate text-[10px] text-muted-foreground">
                  {summaryLabel(s, timezone, s.attendance_id ? codeById.get(s.attendance_id) : null)} · {names[s.created_by] ?? "equipe"}
                </span>
              </div>
              {s.status === "generating" ? (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Gerando…</span>
              ) : s.status === "failed" ? (
                <span className="flex items-center gap-1 text-[10px] text-destructive"><AlertTriangle className="h-3 w-3" />Não foi gerado</span>
              ) : (
                <PendingPills s={s.sections} />
              )}
            </button>
          ))}
          {summaries.length > 0 && (
            <button onClick={() => openWith({ view: "history" })} className="flex items-center gap-0.5 self-start text-[11px] font-semibold text-sky-600 hover:underline dark:text-sky-400">
              Ver todos ({summaries.length}) <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {open && (
        <GroupSummaryDialog
          open={open}
          onOpenChange={setOpen}
          conversationId={conversationId}
          groupName={groupName}
          start={start}
          onGoToMessage={onGoToMessage}
        />
      )}
    </div>
  );
}
