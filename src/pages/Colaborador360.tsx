import { Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { lazyWithReload } from "@/lib/staleChunkReload";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAgentes360 } from "@/components/clientes/visao360/useVisao360";
import { TicketsColaborador } from "@/components/colaborador360/TicketsColaborador";
import { useSearchParams } from "react-router-dom";
import { endOfDay, format, formatDistanceStrict, parseISO, startOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, Clock, Lock, MessageCircle, Orbit, Star, Ticket, Zap, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker, type PeriodoRange } from "@/components/ui/DateRangePicker";
import { cn } from "@/lib/utils";
import { EASE } from "@/components/clientes/visao360/Visao360Ui";
import { NotaDoColaborador } from "@/components/colaborador360/NotaDoColaborador";
import { AtendimentosLista, AvaliacoesLista } from "@/components/clientes/visao360/Visao360Listas";
import { AttendanceDetailModal } from "@/components/tickets/AttendanceDetailModal";
import {
  useAtendimentosColaborador, useColaborador360, useInsatisfacaoColaborador, useJornadaColaborador, useTicketsColaborador,
  type Alvo360, type MembroEquipe360,
} from "@/components/colaborador360/useColaborador360";
import {
  calcularNota, fmtNum, fmtTempo, iniciais, posicao, statusAoVivo, vsTime,
  type Metricas360, type Time360,
} from "@/components/colaborador360/colaborador360Calc";
import { destaques, linhaDoTempo } from "@/components/colaborador360/colaborador360Analise";
import { Destaques, VisaoGeralColaborador } from "@/components/colaborador360/VisaoGeralColaborador";
import { JornadaColaborador } from "@/components/colaborador360/JornadaColaborador";
import { LinhaDoTempoColaborador } from "@/components/colaborador360/LinhaDoTempoColaborador";
import { TheoPauta } from "@/components/colaborador360/TheoPauta";
import { InsatisfacaoColaborador } from "@/components/colaborador360/InsatisfacaoColaborador";
import { WhatsappOficialColaborador } from "@/components/colaborador360/WhatsappOficialColaborador";
import { useTemWhatsappOficial } from "@/components/whatsappCusto/useWhatsappCusto";

const SupportTicketDetailDialog = lazyWithReload(() => import("@/components/tickets/SupportTicketDetailDialog"));

const periodoPadrao = (): PeriodoRange => ({ from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) });

const ROLE: Record<string, string> = { admin: "Administrador", head: "Head", user: "Operador" };

export default function Colaborador360() {
  const [params, setParams] = useSearchParams();
  const userId = params.get("u");
  const [periodo, setPeriodo] = useState<PeriodoRange>(periodoPadrao);
  const q = useColaborador360(userId, periodo.from, periodo.to);
  const d = q.data;
  const alvo = d?.alvo;
  const m = alvo?.metricas ?? null;
  const nota = useMemo(() => calcularNota(m), [m]);
  const ats = useAtendimentosColaborador(alvo?.user_id ?? null, periodo.from, periodo.to, q.isSuccess);
  const tks = useTicketsColaborador(alvo?.user_id ?? null, periodo.from, periodo.to, q.isSuccess);
  const { effectiveTenantId: tid } = useTenantFilter();
  const agentes = useAgentes360(tid);
  const qc = useQueryClient();
  const jor = useJornadaColaborador(alvo?.user_id ?? null, periodo.from, periodo.to, q.isSuccess);
  const insat = useInsatisfacaoColaborador(alvo?.user_id ?? null, periodo.from, periodo.to, q.isSuccess);
  // Aba de custo só para empresa com número da API Oficial. Quem vê quem é a
  // regra da própria 360°, conferida de novo no servidor.
  const temWaOficial = useTemWhatsappOficial(tid).data === true;
  const [subAba, setSubAba] = useState("geral");
  const [atendimentoAberto, setAtendimentoAberto] = useState<string | null>(null);
  const [ticketAberto, setTicketAberto] = useState<string | null>(null);
  const nomeAgente = useCallback(
    (uid: string | null) => (uid ? agentes.data?.get(uid) ?? (uid === alvo?.user_id ? alvo?.nome ?? null : null) : null),
    [agentes.data, alvo],
  );
  const ticketsAbertos = (tks.data ?? []).filter((t) => t.responsavel_user_id === alvo?.user_id && !t.status_final).length;
  const listaAts = useMemo(() => ats.data ?? [], [ats.data]);
  const pontos = useMemo(() => {
    const parados = (tks.data ?? []).filter((t) => t.responsavel_user_id === alvo?.user_id && !t.status_final
      && Date.now() - new Date(t.aberto_em).getTime() > 7 * 86_400_000).length;
    const lista = destaques(m, listaAts, periodo.from, periodo.to, jor.data, parados);
    // Mesma régua do aviso ao gestor sobre o cliente: 3 ou mais.
    const n = insat.data?.length ?? 0;
    if (n < 3) return lista;
    // Entra como o primeiro ponto de atenção (a função devolve 2 fortes + 2 de atenção).
    const fortes = lista.filter((x) => x.tom === "ok" || x.tom === "info");
    const atencao = lista.filter((x) => x.tom === "alerta" || x.tom === "ruim");
    return [...fortes, { tom: "ruim" as const, titulo: `Cliente insatisfeito em ${n} atendimentos`, sub: "com o atendimento, no período · veja a aba Clientes insatisfeitos" }, ...atencao.slice(0, 1)];
  }, [m, listaAts, periodo, jor.data, tks.data, alvo?.user_id, insat.data]);
  const dias = useMemo(
    () => (alvo ? linhaDoTempo(listaAts, tks.data ?? [], jor.data, alvo.user_id, periodo.from, periodo.to) : []),
    [alvo, listaAts, tks.data, jor.data, periodo],
  );
  const avaliacoes = listaAts.filter((a) => a.csat_score != null).length;

  const escolher = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("u", id);
    setParams(p, { replace: true });
  };

  const semPermissao = (q.error as any)?.code === "42501";

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Orbit className="h-6 w-6 text-emerald-500" />Visão 360° do colaborador
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Desempenho, qualidade e rotina de cada pessoa do time, num lugar só.</p>
        </div>
        <DateRangePicker dateRange={periodo} onDateRangeChange={(r) => setPeriodo(r)} align="end" />
      </div>

      {d && d.equipe.length > 0 && (
        <FaixaDoTime equipe={d.equipe} atual={alvo?.user_id ?? null} onEscolher={escolher} escopo={d.escopo} />
      )}

      {semPermissao ? (
        <div className="rounded-2xl border bg-card px-6 py-10 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-bold">Você não tem acesso à Visão 360° desta pessoa</h2>
          <p className="mt-1 text-sm text-muted-foreground">Operador vê só a própria. Head vê a equipe do setor dele. Administrador vê todos.</p>
        </div>
      ) : q.isError ? (
        <div className="rounded-2xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Não foi possível carregar os números agora. Tente de novo em instantes.
        </div>
      ) : (
        <>
          <Topo alvo={alvo} nota={nota} carregando={q.isLoading} time={d?.time ?? null} />
          <Numeros m={m} t={d?.time ?? null} alvo={alvo} carregando={q.isLoading} />
          {alvo && <Destaques itens={pontos} />}
          {alvo && (
            <Tabs value={subAba} onValueChange={setSubAba} className="min-w-0">
              <TabsList className="h-auto w-full justify-start gap-0.5 overflow-x-auto rounded-none border-b bg-transparent p-0">
                <SubAba valor="geral">Visão geral</SubAba>
                <SubAba valor="atendimentos" qtd={ats.data?.length}>Atendimentos</SubAba>
                <SubAba valor="avaliacoes" qtd={ats.data ? avaliacoes : undefined}>Avaliações</SubAba>
                <SubAba valor="tickets" qtd={tks.data ? ticketsAbertos : undefined}>Tickets</SubAba>
                <SubAba valor="insatisfacao" qtd={insat.data?.length}>Clientes insatisfeitos</SubAba>
                <SubAba valor="jornada">Jornada e pausas</SubAba>
                <SubAba valor="linha">Linha do tempo</SubAba>
                {temWaOficial && <SubAba valor="whatsapp">WhatsApp Oficial</SubAba>}
              </TabsList>
              <TabsContent value="geral" className="mt-4">
                {ats.isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : (
                  <VisaoGeralColaborador
                    nota={nota} ats={listaAts} de={periodo.from} ate={periodo.to} onAbrirAtendimento={setAtendimentoAberto}
                    pauta={d?.escopo !== "proprio" ? (
                      <TheoPauta userId={alvo.user_id} nome={alvo.nome} de={periodo.from} ate={periodo.to} tenantId={tid} nomeAgente={nomeAgente} />
                    ) : undefined}
                  />
                )}
              </TabsContent>
              <TabsContent value="avaliacoes" className="mt-4">
                {ats.isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : (
                  <AvaliacoesLista atendimentos={listaAts} periodo={periodo} nomeAgente={nomeAgente} onAbrir={setAtendimentoAberto} comMeses={false} />
                )}
              </TabsContent>
              <TabsContent value="insatisfacao" className="mt-4">
                {insat.isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : insat.isError ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Não foi possível carregar agora.</p>
                ) : (
                  <InsatisfacaoColaborador itens={insat.data ?? []} encerrados={m?.encerrados ?? null} onAbrir={setAtendimentoAberto} />
                )}
              </TabsContent>
              <TabsContent value="jornada" className="mt-4">
                {jor.isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : jor.isError ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Não foi possível carregar a jornada agora.</p>
                ) : jor.data ? <JornadaColaborador jornada={jor.data} /> : null}
              </TabsContent>
              <TabsContent value="linha" className="mt-4">
                {ats.isLoading || tks.isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : (
                  <LinhaDoTempoColaborador dias={dias} onAbrirAtendimento={setAtendimentoAberto} onAbrirTicket={setTicketAberto} />
                )}
              </TabsContent>
              {temWaOficial && (
                <TabsContent value="whatsapp" className="mt-4">
                  <WhatsappOficialColaborador tenantId={tid} userId={alvo.user_id} de={periodo.from} ate={periodo.to} />
                </TabsContent>
              )}
              <TabsContent value="atendimentos" className="mt-4">
                {ats.isLoading ? (
                  <Skeleton className="h-64 w-full rounded-xl" />
                ) : ats.isError ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Não foi possível carregar os atendimentos agora.</p>
                ) : (
                  <AtendimentosLista
                    atendimentos={ats.data ?? []}
                    periodo={periodo}
                    nomeAgente={nomeAgente}
                    onAbrir={setAtendimentoAberto}
                    rotuloPessoa="Cliente"
                    comResumo={false}
                  />
                )}
              </TabsContent>
              <TabsContent value="tickets" className="mt-4">
                {tks.isLoading ? (
                  <Skeleton className="h-64 w-full rounded-xl" />
                ) : tks.isError ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Não foi possível carregar os tickets agora.</p>
                ) : (
                  <TicketsColaborador
                    tickets={tks.data ?? []}
                    userId={alvo.user_id}
                    periodo={periodo}
                    nomeAgente={nomeAgente}
                    onAbrir={setTicketAberto}
                  />
                )}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}

      <AttendanceDetailModal
        attendanceId={atendimentoAberto}
        open={!!atendimentoAberto}
        onOpenChange={(o) => !o && setAtendimentoAberto(null)}
      />
      <Suspense fallback={null}>
        {ticketAberto && (
          <SupportTicketDetailDialog
            ticketId={ticketAberto}
            open={!!ticketAberto}
            onOpenChange={(o) => {
              if (!o) {
                setTicketAberto(null);
                qc.invalidateQueries({ queryKey: ["colaborador-360-tickets"] });
                qc.invalidateQueries({ queryKey: ["colaborador-360"] });
              }
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

function SubAba({ valor, qtd, children }: { valor: string; qtd?: number; children: ReactNode }) {
  return (
    <TabsTrigger
      value={valor}
      className="gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2.5 text-[13px] font-bold text-muted-foreground shadow-none data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {children}
      {qtd != null && <span className="rounded-full bg-muted px-1.5 text-[10.5px] tabular-nums">{qtd}</span>}
    </TabsTrigger>
  );
}

/* ------------------------------------------------------------ faixa do time */

function FaixaDoTime({ equipe, atual, onEscolher, escopo }: {
  equipe: MembroEquipe360[]; atual: string | null; onEscolher: (id: string) => void; escopo: string;
}) {
  const setores = useMemo(() => [...new Set(equipe.map((e) => e.setor ?? "Sem setor"))], [equipe]);
  const [setor, setSetor] = useState<string | null>(null);
  const lista = setor ? equipe.filter((e) => (e.setor ?? "Sem setor") === setor) : equipe;

  return (
    <div className="grid gap-2">
      {escopo === "todos" && setores.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {[null, ...setores].map((s) => (
            <button
              key={s ?? "todos"}
              type="button"
              onClick={() => setSetor(s)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                setor === s ? "border-transparent bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {s ?? "Todos os setores"}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-2 pt-1" role="list" aria-label="Escolher colaborador">
        {lista.map((e) => {
          const n = calcularNota(e.metricas).nota;
          const st = statusAoVivo(e.presenca, e.ultimo_sinal);
          const on = e.user_id === atual;
          return (
            <button
              key={e.user_id}
              type="button"
              role="listitem"
              onClick={() => onEscolher(e.user_id)}
              className={cn(
                "flex flex-none items-center gap-2 rounded-xl border bg-card py-1.5 pl-1.5 pr-2.5 text-left transition duration-300 hover:-translate-y-px",
                EASE,
                on && "border-emerald-500 ring-[3px] ring-emerald-500/20",
              )}
            >
              <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-sky-500 text-[11px] font-extrabold text-white">
                {iniciais(e.nome)}
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card" style={{ background: st.cor }} />
              </span>
              <span>
                <b className="block text-[12.5px] leading-tight">{e.nome}</b>
                <small className="text-[11px] text-muted-foreground">{e.setor ?? "Sem setor"}</small>
              </span>
              <span className={cn(
                "ml-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-extrabold tabular-nums",
                n == null ? "bg-muted text-muted-foreground"
                  : n >= 80 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : n >= 60 ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
                  : n >= 40 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-red-500/15 text-red-700 dark:text-red-400",
              )}>
                {n ?? "s/n"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ topo */

function Topo({ alvo, nota, carregando, time }: {
  alvo: Alvo360 | undefined;
  nota: ReturnType<typeof calcularNota>; carregando: boolean; time: Time360 | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const moverLuz = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - b.left}px`);
    el.style.setProperty("--my", `${e.clientY - b.top}px`);
  };

  const st = statusAoVivo(alvo?.presenca, alvo?.ultimo_sinal);
  const m = alvo?.metricas;
  const comparacao = !m?.elegivel || !time
    ? null
    : m.grupo === "setor"
      ? `Comparado com as ${time.n} pessoas com nota no setor ${alvo?.setor ?? ""}.`
      : `Comparado com as ${time.n} pessoas com nota na empresa. O setor tem menos de 3.`;

  return (
    <section
      ref={ref}
      onPointerMove={moverLuz}
      className="relative grid items-center gap-5 overflow-hidden rounded-2xl bg-slate-900 p-5 text-slate-200 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,auto)]"
      style={{
        backgroundImage:
          "radial-gradient(420px 220px at var(--mx,70%) var(--my,0%), rgba(255,255,255,.07), transparent 70%)," +
          "radial-gradient(900px 300px at 0% 0%, rgba(34,197,94,.28), transparent 60%)," +
          "radial-gradient(700px 300px at 100% 0%, rgba(14,165,233,.25), transparent 60%)," +
          "linear-gradient(135deg, #1E293B, #0F172A)",
      }}
    >
      {carregando || !alvo ? (
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-2xl bg-white/10" />
          <div className="grid gap-2"><Skeleton className="h-6 w-64 bg-white/10" /><Skeleton className="h-4 w-80 bg-white/10" /></div>
        </div>
      ) : (
        <>
          <div className="grid min-w-0 gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="relative grid h-16 w-16 flex-none place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-sky-500 text-2xl font-extrabold text-white shadow-[0_10px_30px_-10px_rgba(34,197,94,.6)]">
                {iniciais(alvo.nome)}
                <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-[3px] border-slate-800" style={{ background: st.cor }} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-extrabold tracking-tight text-white">{alvo.nome ?? "Sem nome"}</h2>
                <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-slate-400">
                  {alvo.cargo && <span>{alvo.cargo}</span>}
                  <span>{alvo.setor ? `Setor ${alvo.setor}` : "Sem setor"}</span>
                  {alvo.role && <span>{ROLE[alvo.role] ?? alvo.role}</span>}
                  {alvo.usuario_desde && (
                    <span>No DoctorSaaS há {formatDistanceStrict(parseISO(alvo.usuario_desde), new Date(), { locale: ptBR })}</span>
                  )}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold" style={{ background: `${st.cor}33`, color: st.cor === "#94A3B8" ? "#CBD5E1" : st.cor }}>
                    <span className="relative flex h-2 w-2">
                      {st.pulsa && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: st.cor }} />}
                      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: st.cor }} />
                    </span>
                    {st.rotulo}
                    {st.rotulo === "Online" && alvo.expediente_desde && ` desde ${format(parseISO(alvo.expediente_desde), "HH:mm")}`}
                    {alvo.presenca === "paused" && alvo.pausa_motivo && ` · ${alvo.pausa_motivo}`}
                    {alvo.presenca === "paused" && alvo.pausa_desde && ` desde ${format(parseISO(alvo.pausa_desde), "HH:mm")}`}
                  </span>
                  <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-[11.5px] font-bold text-sky-300">
                    Atendendo {alvo.agora.em_atendimento}{alvo.capacidade ? ` de ${alvo.capacidade}` : ""} chat{alvo.agora.em_atendimento === 1 ? "" : "s"}
                  </span>
                  {m?.pos?.encerrados === 1 && m.n && m.n > 1 && (
                    <span className="rounded-full bg-violet-500/25 px-2.5 py-0.5 text-[11.5px] font-bold text-violet-200">Quem mais atendeu no grupo</span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid max-w-[640px] grid-cols-2 gap-2 sm:grid-cols-4">
              <AoVivo rotulo="Encerrados hoje" valor={alvo.agora.encerrados_hoje} />
              <AoVivo rotulo="Em atendimento" valor={alvo.agora.em_atendimento} />
              <AoVivo rotulo="Na fila" valor={alvo.agora.na_fila} />
              <AoVivo rotulo="Tickets abertos" valor={alvo.agora.tickets_abertos}
                sub={alvo.agora.ticket_mais_antigo ? `mais antigo: ${formatDistanceStrict(parseISO(alvo.agora.ticket_mais_antigo), new Date(), { locale: ptBR })}` : undefined} />
            </div>
          </div>
          <div className="relative z-[1]"><NotaDoColaborador nota={nota} comparacao={comparacao} /></div>
        </>
      )}
    </section>
  );
}

function AoVivo({ rotulo, valor, sub }: { rotulo: string; valor: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.05] px-2.5 py-2">
      <span className="block text-[11px] text-slate-400">{rotulo}</span>
      <b className="text-base font-extrabold tabular-nums text-white">{valor}</b>
      {sub && <span className="block truncate text-[10.5px] text-slate-400">{sub}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ números */

function Numeros({ m, t, alvo, carregando }: {
  m: Metricas360 | null; t: Time360 | null; carregando: boolean;
  alvo: { agora: { tickets_abertos: number } } | undefined;
}) {
  if (carregando) {
    return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>;
  }
  const n = m?.n ?? null;
  const satisf = m && m.csat_n ? Math.round((m.csat_satisfeitos / m.csat_n) * 100) : null;
  const taxaResp = m && m.csat_enviados >= m.csat_n && m.csat_enviados ? Math.round((m.csat_n / m.csat_enviados) * 100) : null;

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      <Numero Icon={MessageCircle} rotulo="Atendimentos encerrados"
        valor={fmtNum(m?.encerrados ?? 0)} valorNum={m?.encerrados ?? 0} time={t?.encerrados ?? null}
        rotuloTime={`time: ${fmtNum(t?.encerrados, 0)}`} pos={posicao(m?.pos?.encerrados, n)}
        extra={t?.encerrados_max != null ? `maior do grupo: ${t.encerrados_max}` : undefined} />
      <Numero Icon={Star} rotulo="CSAT"
        valor={m?.csat != null ? <>{fmtNum(m.csat, 1)} <span className="text-sm font-bold text-muted-foreground">/ 5</span></> : "sem nota"}
        valorNum={m?.csat ?? null} time={t?.csat ?? null} escalaMax={5}
        rotuloTime={`time: ${fmtNum(t?.csat, 1)}`} pos={posicao(m?.pos?.csat, n)}
        detalhe={m?.csat_n ? `${satisf}% satisfeitos · ${m.csat_n} nota${m.csat_n === 1 ? "" : "s"}` : "nenhuma avaliação no período"}
        extra={taxaResp != null ? `responderam: ${taxaResp}%` : undefined} />
      <Numero Icon={Zap} rotulo="1ª resposta" menorMelhor
        valor={fmtTempo(m?.frt_p50)} valorNum={m?.frt_p50 ?? null} time={t?.frt_p50 ?? null}
        rotuloTime={`time: ${fmtTempo(t?.frt_p50)}`} pos={posicao(m?.pos?.frt, n)} extra="mediana" />
      <Numero Icon={Clock} rotulo="Tempo médio (TMA)" menorMelhor
        valor={fmtTempo(m?.tma_p50)} valorNum={m?.tma_p50 ?? null} time={t?.tma_p50 ?? null}
        rotuloTime={`time: ${fmtTempo(t?.tma_p50)}`} pos={posicao(m?.pos?.tma, n)} extra="mediana" />
      <Numero Icon={CheckCircle2} rotulo="Resolvido no 1º contato"
        valor={m?.fcr_pct != null ? `${fmtNum(m.fcr_pct)}%` : "sem dado"} valorNum={m?.fcr_pct ?? null} time={t?.fcr_pct ?? null} escalaMax={100}
        rotuloTime={`time: ${t?.fcr_pct != null ? `${fmtNum(t.fcr_pct)}%` : "sem dado"}`} pos={posicao(m?.pos?.fcr, n)}
        detalhe={m && m.fcr_pct == null && m.encerrados > 0
          ? "a IA analisou poucos atendimentos no período"
          : m?.reabertura_pct != null ? `reabertos ${fmtNum(m.reabertura_pct, 1)}%` : undefined}
        extra={m?.fcr_base ? `${m.fcr_n} de ${m.fcr_base}` : undefined} />
      <Numero Icon={Ticket} rotulo="Tickets resolvidos"
        valor={fmtNum(m?.tk_resolvidos ?? 0)} valorNum={m?.tk_resolvidos ?? 0} time={t?.tk_resolvidos ?? null}
        rotuloTime={`time: ${fmtNum(t?.tk_resolvidos, 0)}`} pos={posicao(m?.pos?.tickets, n)}
        detalhe={`${alvo?.agora.tickets_abertos ?? 0} aberto${alvo?.agora.tickets_abertos === 1 ? "" : "s"}${m?.tk_dias_medio != null ? ` · média ${fmtNum(m.tk_dias_medio, 1)} dia${m.tk_dias_medio === 1 ? "" : "s"}` : ""}`} />
    </section>
  );
}

function Numero({ Icon, rotulo, valor, valorNum, time, rotuloTime, pos, detalhe, extra, menorMelhor = false, escalaMax }: {
  Icon: LucideIcon; rotulo: string; valor: ReactNode; valorNum: number | null; time: number | null;
  rotuloTime: string; pos: string | null; detalhe?: string; extra?: string; menorMelhor?: boolean; escalaMax?: number;
}) {
  const cmp = valorNum ? vsTime(valorNum, time, menorMelhor) : null;
  const max = escalaMax ?? Math.max(valorNum ?? 0, time ?? 0) * 1.15;
  const w = (v: number | null) => (v == null || !max ? 0 : Math.min(100, (v / max) * 100));
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const b = ref.current?.getBoundingClientRect();
        if (b) { ref.current!.style.setProperty("--sx", `${e.clientX - b.left}px`); ref.current!.style.setProperty("--sy", `${e.clientY - b.top}px`); }
      }}
      className={cn("group relative min-w-0 overflow-hidden rounded-xl border bg-card p-3.5 shadow-sm transition-transform duration-500 hover:-translate-y-0.5", EASE)}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: "radial-gradient(260px 120px at var(--sx,50%) var(--sy,-40%), rgba(34,197,94,.10), transparent 70%)" }} />
      <div className="flex items-center justify-between gap-1.5 text-xs font-semibold text-muted-foreground">
        {rotulo}<Icon className="h-4 w-4 flex-none opacity-60" />
      </div>
      <div className="mt-1.5 text-[23px] font-extrabold tabular-nums tracking-tight">{valor}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {cmp && !cmp.igual && (
          <b className={cmp.melhor ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
            {cmp.pct}% {menorMelhor ? (cmp.melhor ? "mais rápido" : "mais lento") : (cmp.melhor ? "acima" : "abaixo")}
          </b>
        )}
        {cmp?.igual && <span>igual ao time</span>}
        {pos && <span className="rounded-md bg-muted px-1.5 py-px text-[11px] font-extrabold text-foreground/70">{pos}</span>}
        {detalhe && <span className="w-full">{detalhe}</span>}
      </div>
      <div className="mt-2.5">
        <div className="relative h-1.5 rounded-full bg-muted">
          <span
            className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000", EASE, cmp && !cmp.melhor && !cmp.igual ? "bg-amber-500" : "bg-emerald-500")}
            style={{ width: `${w(valorNum)}%` }}
          />
          {time != null && <span className="absolute -top-[3px] h-3 w-0.5 rounded bg-muted-foreground/70" style={{ left: `${w(time)}%` }} title={rotuloTime} />}
        </div>
        <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{rotuloTime}</span>{extra && <span>{extra}</span>}
        </div>
      </div>
    </div>
  );
}
