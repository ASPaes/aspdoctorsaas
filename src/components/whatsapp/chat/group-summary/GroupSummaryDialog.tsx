import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { endOfDay, startOfDay, subDays } from "date-fns";
import {
  AlertTriangle, ArrowLeft, Check, Copy, History, Info, Loader2, RotateCcw, Save, Sparkles, Trash2, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import { cn } from "@/lib/utils";
import {
  SECTIONS, countPending, useGroupSummaries, useGroupSummaryActions, useSummaryPreview,
  type FilterType, type GroupSummary, type Sections, type SummaryFilter,
} from "./useGroupSummaries";

export type GroupSummaryStart = { view: "new" } | { view: "history" } | { view: "summary"; id: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  groupName: string;
  start: GroupSummaryStart;
  onGoToMessage?: (target: { id: string; at: string }) => void;
}

type View = "filter" | "progress" | "result" | "history";

const TYPE_TAG: Record<FilterType, string> = { last_24h: "24h", period: "Período", attendance: "Atend." };

function fmt(iso: string, tz: string, withYear = false) {
  const p = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit", minute: "2-digit", timeZone: tz,
  }).format(new Date(iso));
  return p.replace(",", "");
}
function fmtDay(iso: string, tz: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: tz }).format(new Date(iso));
}
function monthKey(iso: string, tz: string) {
  const [m, y] = new Intl.DateTimeFormat("pt-BR", { month: "2-digit", year: "numeric", timeZone: tz }).format(new Date(iso)).split("/");
  return `${y}-${m}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  const s = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function summaryLabel(s: Pick<GroupSummary, "filter_type" | "period_start" | "period_end">, tz: string, attendanceCode?: string | null) {
  if (s.filter_type === "last_24h") return "Últimas 24h";
  if (s.filter_type === "attendance") return attendanceCode?.trim() ? `#${attendanceCode}` : "Atendimento";
  return `${fmtDay(s.period_start, tz)} a ${fmtDay(s.period_end, tz)}`;
}

function PendingPills({ s }: { s: Sections | null }) {
  const c = countPending(s);
  if (!c.cliente && !c.interna && !c.decisoes) {
    return <span className="text-[10px] text-muted-foreground">sem pendências</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {c.cliente > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{c.cliente} pend. cliente</span>}
      {c.interna > 0 && <span className="rounded-full bg-sky-100 px-1.5 py-px text-[10px] font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300">{c.interna} pend. interna</span>}
      {c.decisoes > 0 && <span className="rounded-full bg-green-100 px-1.5 py-px text-[10px] font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">{c.decisoes} {c.decisoes > 1 ? "decisões" : "decisão"}</span>}
    </div>
  );
}
export { PendingPills };

/** Atendimentos do grupo, para o filtro "Atendimento". */
export function useGroupAttendances(conversationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["group-summary-attendances", conversationId],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select("id, attendance_code, opened_at, closed_at, status")
        .eq("conversation_id", conversationId)
        .not("opened_at", "is", null)
        .order("opened_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as { id: string; attendance_code: string | null; opened_at: string; closed_at: string | null; status: string }[];
    },
  });
}

export function GroupSummaryDialog({ open, onOpenChange, conversationId, groupName, start, onGoToMessage }: Props) {
  const { timezone } = useAppTimezone();
  const { profile } = useAuth();
  const { summaries, names } = useGroupSummaries(conversationId);
  const { generate, saveEdit, remove } = useGroupSummaryActions(conversationId);
  const attendances = useGroupAttendances(conversationId, open);
  const codeById = useMemo(
    () => new Map((attendances.data ?? []).map((a) => [a.id, a.attendance_code])),
    [attendances.data],
  );

  const [view, setView] = useState<View>("filter");
  const [from, setFrom] = useState<"new" | "history">("new");
  const [currentId, setCurrentId] = useState<string | null>(null);

  // ----- filtro -----
  const [mode, setMode] = useState<FilterType>("last_24h");
  const [range, setRange] = useState(() => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }));
  const [attendanceId, setAttendanceId] = useState<string | null>(null);
  const [ignoreDuplicate, setIgnoreDuplicate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIgnoreDuplicate(false);
    if (start.view === "summary") { setCurrentId(start.id); setFrom("history"); setView("result"); }
    else if (start.view === "history") { setFrom("history"); setView("history"); }
    else { setFrom("new"); setView("filter"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, start.view, start.view === "summary" ? start.id : null]);

  useEffect(() => {
    if (mode === "attendance" && !attendanceId && attendances.data?.length) setAttendanceId(attendances.data[0].id);
  }, [mode, attendanceId, attendances.data]);

  const filter: SummaryFilter | null = useMemo(() => {
    if (mode === "last_24h") return { filterType: mode };
    if (mode === "period") return { filterType: mode, periodStart: startOfDay(range.from).toISOString(), periodEnd: endOfDay(range.to).toISOString() };
    return attendanceId ? { filterType: mode, attendanceId } : null;
  }, [mode, range, attendanceId]);

  const preview = useSummaryPreview(open && view === "filter" ? conversationId : null, filter);
  useEffect(() => setIgnoreDuplicate(false), [filter]);

  const current = summaries.find((s) => s.id === currentId) ?? null;

  // O resumo que acompanhamos terminou: mostra o resultado (ou a falha).
  useEffect(() => {
    if (view === "progress" && current && current.status !== "generating") {
      setView("result");
      if (current.status === "ready") toast.success("Resumo gerado e salvo no histórico");
    }
  }, [view, current]);

  const handleGenerate = async () => {
    if (!filter) return;
    try {
      const r = await generate.mutateAsync(filter);
      setCurrentId(r.id);
      setFrom("new");
      setView("progress");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const openSummary = (id: string, origin: "new" | "history") => {
    const s = summaries.find((x) => x.id === id);
    setCurrentId(id);
    setFrom(origin);
    setView(s?.status === "generating" ? "progress" : "result");
  };

  const goTo = (item: { message_id: string | null; msg_at: string | null }) => {
    if (!item.message_id || !item.msg_at || !onGoToMessage) return;
    onOpenChange(false);
    onGoToMessage({ id: item.message_id, at: item.msg_at });
  };

  const tab = view === "history" || (view === "result" && from === "history") ? "history" : "new";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(680px,calc(100vh-2rem))] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b px-5 pr-12 pt-4">
          <div className="flex items-start gap-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[15px]">Resumo do grupo com IA</DialogTitle>
              <DialogDescription className="truncate text-xs">{groupName}</DialogDescription>
            </div>
          </div>
          <div className="flex gap-5" role="tablist">
            {([["new", "Novo resumo", Sparkles], ["history", "Histórico", History]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => { setFrom(k); setView(k === "new" ? "filter" : "history"); }}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 pb-2 pt-1 text-[13px] font-medium transition-colors",
                  tab === k ? "border-green-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {k === "history" && (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold">{summaries.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {view === "filter" && (
          <FilterView
            mode={mode} setMode={setMode} range={range} setRange={setRange}
            attendanceId={attendanceId} setAttendanceId={setAttendanceId}
            attendances={attendances.data ?? []} attendancesLoading={attendances.isLoading}
            summaries={summaries} preview={preview} timezone={timezone}
            ignoreDuplicate={ignoreDuplicate} setIgnoreDuplicate={setIgnoreDuplicate}
            onOpenDuplicate={(id) => openSummary(id, "new")}
            onCancel={() => onOpenChange(false)} onGenerate={handleGenerate} generating={generate.isPending}
          />
        )}

        {view === "progress" && <ProgressView summary={current} />}

        {view === "result" && current && (
          <ResultView
            key={current.id + (current.edited_at ?? "")}
            summary={current} timezone={timezone} names={names}
            label={summaryLabel(current, timezone, current.attendance_id ? codeById.get(current.attendance_id) : null)}
            fresh={from === "new"}
            canDelete={!!profile && (profile.user_id === current.created_by || profile.role === "admin" || profile.role === "head" || profile.is_super_admin === true)}
            backLabel={from === "history" ? "Voltar ao histórico" : "Mudar período"}
            onBack={() => setView(from === "history" ? "history" : "filter")}
            onRetry={() => { setFrom("new"); setView("filter"); }}
            onGoTo={goTo}
            onSave={async (sections) => {
              try { await saveEdit.mutateAsync({ id: current.id, sections }); toast.success("Correções salvas"); }
              catch (e: any) { toast.error(e.message); }
            }}
            saving={saveEdit.isPending}
            onDelete={async () => {
              try { await remove.mutateAsync(current.id); toast.success("Resumo apagado"); setCurrentId(null); setFrom("history"); setView("history"); }
              catch (e: any) { toast.error(e.message); }
            }}
          />
        )}

        {view === "history" && (
          <HistoryView
            summaries={summaries} names={names} timezone={timezone} codeById={codeById}
            onOpen={(id) => openSummary(id, "history")}
            onNew={() => { setFrom("new"); setView("filter"); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── filtro ───────────────────────── */

function FilterView(p: {
  mode: FilterType; setMode: (m: FilterType) => void;
  range: { from: Date; to: Date }; setRange: (r: { from: Date; to: Date }) => void;
  attendanceId: string | null; setAttendanceId: (id: string) => void;
  attendances: { id: string; attendance_code: string | null; opened_at: string; closed_at: string | null }[];
  attendancesLoading: boolean;
  summaries: GroupSummary[];
  preview: ReturnType<typeof useSummaryPreview>;
  timezone: string;
  ignoreDuplicate: boolean; setIgnoreDuplicate: (v: boolean) => void;
  onOpenDuplicate: (id: string) => void;
  onCancel: () => void; onGenerate: () => void; generating: boolean;
}) {
  const { data: pv, isLoading, error } = p.preview;
  const summarizedAttendances = new Set(p.summaries.filter((s) => s.status === "ready" && s.attendance_id).map((s) => s.attendance_id));
  const duplicate = pv?.duplicate && !p.ignoreDuplicate ? pv.duplicate : null;
  const empty = pv && pv.message_count === 0;
  const canGenerate = !!pv && !empty && !duplicate && !p.generating && !(p.mode === "attendance" && !p.attendanceId);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">O que resumir</p>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {([["last_24h", "Últimas 24h"], ["period", "Período"], ["attendance", "Atendimento"]] as const).map(([k, label]) => (
            <button
              key={k}
              aria-pressed={p.mode === k}
              onClick={() => p.setMode(k)}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                p.mode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {p.mode === "last_24h" && (
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] tabular-nums">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            {pv ? `${fmt(pv.period_start, p.timezone)} até agora` : "Das últimas 24 horas até agora"}
          </div>
        )}

        {p.mode === "period" && (
          <div className="flex flex-col gap-1.5">
            <DateRangePicker dateRange={p.range} onDateRangeChange={p.setRange} className="w-full" />
            <p className="text-[11px] text-muted-foreground">Até 93 dias.</p>
          </div>
        )}

        {p.mode === "attendance" && (
          <div className="flex flex-col gap-1.5">
            {p.attendancesLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Carregando atendimentos…</div>
            ) : p.attendances.length === 0 ? (
              <p className="text-xs text-muted-foreground">Este grupo ainda não teve atendimento.</p>
            ) : (
              <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                {p.attendances.map((a) => (
                  <label key={a.id} className={cn(
                    "flex cursor-pointer flex-wrap items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors hover:bg-muted/60",
                    p.attendanceId === a.id && "border-green-500/60 bg-green-50/50 dark:bg-green-950/20",
                  )}>
                    <input type="radio" name="gs-attendance" checked={p.attendanceId === a.id} onChange={() => p.setAttendanceId(a.id)} className="accent-green-600" />
                    <span className="font-mono text-[11px]">{a.attendance_code ? `#${a.attendance_code}` : "Atendimento"}</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {fmt(a.opened_at, p.timezone)} até {a.closed_at ? fmt(a.closed_at, p.timezone) : "agora"}
                    </span>
                    <span className={cn(
                      "ml-auto rounded-full px-2 py-px text-[10px]",
                      summarizedAttendances.has(a.id) ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                        : !a.closed_at ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" : "bg-muted text-muted-foreground",
                    )}>
                      {summarizedAttendances.has(a.id) ? "Já resumido" : !a.closed_at ? "Em andamento" : "Encerrado"}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {duplicate && (
          <div className="flex gap-2 rounded-lg border border-sky-500/60 bg-sky-50 px-3 py-2.5 text-xs leading-relaxed dark:bg-sky-950/30">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
            <div>
              {p.mode === "attendance" ? "Este atendimento" : "Este período"} já foi resumido em <b>{fmt(duplicate.created_at, p.timezone)}</b>
              {duplicate.created_by_name ? <> por {duplicate.created_by_name}</> : null}, e não chegou mensagem nova depois disso.
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => p.onOpenDuplicate(duplicate.id)}>Abrir o resumo salvo</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => p.setIgnoreDuplicate(true)}>Gerar outro mesmo assim</Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            {isLoading ? (
              <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Contando as mensagens do período…</span>
            ) : error ? (
              <span className="text-destructive">{(error as Error).message}</span>
            ) : !pv ? (
              "Escolha um atendimento."
            ) : empty ? (
              "Nenhuma mensagem com conteúdo neste período."
            ) : (
              <>
                <b className="text-foreground">{pv.message_count} {pv.message_count === 1 ? "mensagem" : "mensagens"}</b> de {pv.participants} {pv.participants === 1 ? "participante" : "participantes"} no período.
                {pv.audio_transcribed > 0 && <> {pv.audio_transcribed} {pv.audio_transcribed === 1 ? "áudio entra" : "áudios entram"} pela transcrição.</>}
                {pv.audio_untranscribed > 0 && <> {pv.audio_untranscribed} sem transcrição {pv.audio_untranscribed === 1 ? "fica" : "ficam"} de fora.</>}
                {" "}Imagem e documento entram só pela legenda.
                {pv.parts > 1 && <> Grupo grande: a IA lê em {pv.parts} partes e pode levar até um minuto.</>}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
        <span className="mr-auto text-[11px] text-muted-foreground">O resumo fica salvo no histórico deste grupo.</span>
        <Button variant="outline" size="sm" onClick={p.onCancel}>Cancelar</Button>
        <Button size="sm" className="gap-1.5 bg-green-600 text-white hover:bg-green-700" disabled={!canGenerate} onClick={p.onGenerate}>
          {p.generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Gerar resumo
        </Button>
      </div>
    </>
  );
}

/* ───────────────────────── andamento ───────────────────────── */

function ProgressView({ summary }: { summary: GroupSummary | null }) {
  const steps = [
    { label: "Conferindo o orçamento de IA do mês", done: true },
    { label: `Buscando as mensagens do período${summary ? ` (${summary.message_count})` : ""}`, done: true },
    { label: summary && summary.parts > 1 ? `IA lendo em ${summary.parts} partes e organizando` : "IA lendo e organizando nas 7 seções", done: false, running: true },
    { label: "Salvando no histórico do grupo", done: false },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Gerando resumo</p>
      <div className="flex flex-col gap-3">
        {steps.map((s) => (
          <div key={s.label} className={cn("flex items-center gap-2.5 text-[13px]", s.done || s.running ? "text-foreground" : "text-muted-foreground")}>
            <span className={cn(
              "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2",
              s.done ? "border-green-500 bg-green-500 text-white" : s.running ? "animate-spin border-green-500 border-t-transparent" : "border-border",
            )}>
              {s.done && <Check className="h-3 w-3" />}
            </span>
            {s.label}
          </div>
        ))}
      </div>
      <div className="flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Pode fechar esta janela. O resumo continua sendo gerado e aparece no painel quando ficar pronto.
      </div>
    </div>
  );
}

/* ───────────────────────── resultado ───────────────────────── */

function ResultView(p: {
  summary: GroupSummary; timezone: string; names: Record<string, string>; label: string; fresh: boolean;
  canDelete: boolean; backLabel: string; onBack: () => void; onRetry: () => void;
  onGoTo: (item: { message_id: string | null; msg_at: string | null }) => void;
  onSave: (s: Sections) => void; saving: boolean; onDelete: () => void;
}) {
  const s = p.summary;
  const [draft, setDraft] = useState<Sections>(() => structuredClone(s.sections ?? {}));
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const author = p.names[s.created_by] ?? "alguém da equipe";

  const setItem = (k: string, i: number, texto: string | null) => {
    setDraft((d) => {
      const arr = [...((d as any)[k] ?? [])];
      if (texto === null) arr.splice(i, 1); else arr[i] = { ...arr[i], texto };
      return { ...d, [k]: arr };
    });
    setDirty(true);
  };

  const copy = async () => {
    const lines = [`Resumo do grupo: ${p.label} (${fmt(s.period_start, p.timezone, true)} a ${fmt(s.period_end, p.timezone, true)})`];
    for (const sec of SECTIONS) {
      const items = (draft[sec.key] ?? []).filter((it) => it.texto.trim());
      if (!items.length) continue;
      lines.push("", `• ${sec.label}:`, ...items.map((it) => `   - ${it.texto.trim()}`));
    }
    try { await navigator.clipboard.writeText(lines.join("\n")); toast.success("Resumo copiado"); }
    catch { toast.error("O navegador não deixou copiar. Selecione o texto e copie manualmente."); }
  };

  if (s.status === "failed") {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium">O resumo não foi gerado</p>
          <p className="max-w-sm text-xs text-muted-foreground">{s.error_message ?? "Tente de novo."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <Button variant="outline" size="sm" className="mr-auto gap-1.5" onClick={p.onBack}><ArrowLeft className="h-3.5 w-3.5" />{p.backLabel}</Button>
          <Button size="sm" className="gap-1.5 bg-green-600 text-white hover:bg-green-700" onClick={p.onRetry}><RotateCcw className="h-3.5 w-3.5" />Tentar de novo</Button>
        </div>
      </>
    );
  }

  const filled = SECTIONS.filter((sec) => (draft[sec.key] ?? []).length > 0);
  const emptySecs = SECTIONS.filter((sec) => (draft[sec.key] ?? []).length === 0);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        <div className="flex flex-wrap gap-1.5 text-[11px] tabular-nums">
          {p.fresh && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 font-semibold text-green-800 dark:bg-green-950 dark:text-green-300"><Check className="h-3 w-3" />Salvo no histórico</span>}
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">{p.label} · {fmt(s.period_start, p.timezone)} a {fmt(s.period_end, p.timezone)}</span>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">{s.message_count} mensagens</span>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">Gerado por {author} em {fmt(s.created_at, p.timezone)}</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Gerado por IA. Revise antes de copiar: clique em qualquer texto para corrigir.
        </div>
        {s.edited_at && (
          <p className="text-[11px] text-muted-foreground">
            Editado por {p.names[s.edited_by ?? ""] ?? "alguém da equipe"} em {fmt(s.edited_at, p.timezone)}. A versão original da IA fica guardada.
          </p>
        )}

        {filled.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">A IA não encontrou nada relevante neste período.</p>
        )}

        {filled.map((sec) => (
          <div key={sec.key}>
            <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
              {sec.label}
              <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{draft[sec.key]!.length}</span>
            </h4>
            <ul className="flex flex-col gap-0.5">
              {draft[sec.key]!.map((it, i) => (
                <li key={i} className="group flex items-start gap-1.5">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  <Textarea
                    id={`gs-${sec.key}-${i}`}
                    value={it.texto}
                    onChange={(e) => setItem(sec.key, i, e.target.value)}
                    rows={1}
                    className="min-h-0 flex-1 resize-none border-transparent bg-transparent px-1.5 py-0.5 text-[13px] leading-relaxed shadow-none [field-sizing:content] hover:bg-muted/60 focus-visible:bg-background"
                  />
                  {it.message_id && it.msg_at && (
                    <button
                      type="button"
                      onClick={() => p.onGoTo(it)}
                      title="Ver a mensagem no chat"
                      className="mt-0.5 shrink-0 whitespace-nowrap rounded border px-1 text-[10px] tabular-nums text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/40"
                    >
                      {fmt(it.msg_at, p.timezone)}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setItem(sec.key, i, null)}
                    title="Tirar este item"
                    aria-label="Tirar este item"
                    className="mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {filled.length > 0 && emptySecs.length > 0 && (
          <p className="text-[11px] text-muted-foreground">Sem registro no período: {emptySecs.map((x) => x.label.toLowerCase()).join(", ")}.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={p.onBack}><ArrowLeft className="h-3.5 w-3.5" />{p.backLabel}</Button>
        {p.canDelete && (
          <Button variant="outline" size="icon" className="h-8 w-8 text-destructive" title="Apagar este resumo" aria-label="Apagar este resumo" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <span className="mr-auto" />
        {dirty && (
          <Button variant="outline" size="sm" className="gap-1.5" disabled={p.saving} onClick={() => { p.onSave(draft); setDirty(false); }}>
            {p.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Salvar correções
          </Button>
        )}
        <Button size="sm" className="gap-1.5 bg-green-600 text-white hover:bg-green-700" onClick={copy}><Copy className="h-3.5 w-3.5" />Copiar resumo</Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar este resumo?</AlertDialogTitle>
            <AlertDialogDescription>Ele sai do histórico do grupo para todos. Não dá para desfazer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={p.onDelete}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ───────────────────────── histórico ───────────────────────── */

function HistoryView(p: {
  summaries: GroupSummary[]; names: Record<string, string>; timezone: string;
  codeById: Map<string, string | null>; onOpen: (id: string) => void; onNew: () => void;
}) {
  const months = useMemo(() => [...new Set(p.summaries.map((s) => monthKey(s.created_at, p.timezone)))], [p.summaries, p.timezone]);
  const [month, setMonth] = useState<string>(months[0] ?? "");
  const [type, setType] = useState<"all" | FilterType>("all");
  useEffect(() => { if (!months.includes(month)) setMonth(months[0] ?? ""); }, [months, month]);

  const rows = p.summaries.filter((s) => monthKey(s.created_at, p.timezone) === month && (type === "all" || s.filter_type === type));

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {p.summaries.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhum resumo gerado neste grupo ainda.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger id="gs-month" className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{months.map((m) => <SelectItem key={m} value={m} className="text-xs">{monthLabel(m)}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={type} onValueChange={(v) => setType(v as any)}>
                <SelectTrigger id="gs-type" className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todos os tipos</SelectItem>
                  <SelectItem value="last_24h" className="text-xs">Últimas 24h</SelectItem>
                  <SelectItem value="period" className="text-xs">Período</SelectItem>
                  <SelectItem value="attendance" className="text-xs">Atendimento</SelectItem>
                </SelectContent>
              </Select>
              <span className="ml-auto text-[11px] text-muted-foreground">{rows.length} {rows.length === 1 ? "resumo" : "resumos"}</span>
            </div>
            {rows.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">Nenhum resumo deste tipo no mês.</p>}
            <div className="flex flex-col gap-1.5">
              {rows.map((s) => (
                <button
                  key={s.id}
                  onClick={() => p.onOpen(s.id)}
                  className="grid w-full grid-cols-[72px_1fr] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/60 sm:grid-cols-[72px_1fr_auto]"
                >
                  <div className="text-xs font-semibold leading-tight tabular-nums">
                    {fmtDay(s.created_at, p.timezone)}
                    <span className="block text-[11px] font-normal text-muted-foreground">{fmt(s.created_at, p.timezone).split(" ")[1]}</span>
                  </div>
                  <div className="min-w-0 text-xs leading-snug">
                    <div className="truncate">
                      <span className="mr-1 rounded bg-muted px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">{TYPE_TAG[s.filter_type]}</span>
                      <span className="font-semibold">{summaryLabel(s, p.timezone, s.attendance_id ? p.codeById.get(s.attendance_id) : null)}</span>
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {s.message_count} mensagens · gerado por {p.names[s.created_by] ?? "alguém da equipe"}{s.edited_at ? " · editado" : ""}
                    </div>
                  </div>
                  <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
                    {s.status === "generating" ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Gerando…</span>
                    ) : s.status === "failed" ? (
                      <span className="text-[11px] text-destructive">Falhou</span>
                    ) : (
                      <PendingPills s={s.sections} />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
        <span className="mr-auto text-[11px] text-muted-foreground">Clique num resumo para abrir, copiar ou corrigir.</span>
        <Button size="sm" className="gap-1.5 bg-green-600 text-white hover:bg-green-700" onClick={p.onNew}><Sparkles className="h-3.5 w-3.5" />Novo resumo</Button>
      </div>
    </>
  );
}
