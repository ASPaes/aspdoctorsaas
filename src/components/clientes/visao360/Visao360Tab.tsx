import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfDay, formatDistanceStrict, parseISO, startOfDay, subDays, differenceInCalendarDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Search, MessageCircle, Ticket, FileText, MapPin, TrendingUp, Star, Clock, AlertTriangle,
  ShieldCheck, CalendarClock, Orbit, ChevronDown, Users, Receipt,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useEhAdmin, usePortao } from "@/hooks/usePortao";
import { lazyWithReload } from "@/lib/staleChunkReload";
import { filtroOrBuscaCliente } from "@/lib/buscaCliente";
import { maskCNPJ, maskCPF } from "@/lib/masks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker, type PeriodoRange } from "@/components/ui/DateRangePicker";
import { AttendanceDetailModal } from "@/components/tickets/AttendanceDetailModal";
import {
  useAgentes360, useAtendimentos360, useCliente360, useContatos360, useContrato360, useFinanceiro360, useSaudePesos, useTickets360,
  type ClienteBusca,
} from "./useVisao360";
import {
  brl, calcularSaude, kpisAtendimento, kpisCsat, kpisFinanceiro, kpisTicket, mapaDeContato, minutos, montarLinhaDoTempo, serieMrr12m,
  type Periodo,
} from "./visao360Calc";
import { EASE, MiniBarras, Sparkline } from "./Visao360Ui";
import { LinhaDoTempo, MapaDeContato, OQueUsa, ProximosEventos, QuemFala, type ProximoEvento } from "./Visao360LinhaDoTempo";
import { AtendimentosLista, AvaliacoesLista, TicketsLista } from "./Visao360Listas";
import { FinanceiroSubAba } from "./Visao360Financeiro";
import { SaudeDoCliente } from "./Visao360Saude";

// Os dois pesam: o detalhe do ticket tem 2.600 linhas. Só descem quando alguém clica.
const SupportTicketDetailDialog = lazyWithReload(() => import("@/components/tickets/SupportTicketDetailDialog"));
const CreateSupportTicketModal = lazyWithReload(() =>
  import("@/components/tickets/CreateSupportTicketModal").then((m) => ({ default: m.CreateSupportTicketModal })),
);

const CHAVE_RECENTES = "visao360_recentes";
type Recente = { id: string; nome: string; cancelado: boolean };

function lerRecentes(): Recente[] {
  try { return JSON.parse(localStorage.getItem(CHAVE_RECENTES) || "[]"); } catch { return []; }
}
function gravarRecente(r: Recente) {
  try {
    const lista = [r, ...lerRecentes().filter((x) => x.id !== r.id)].slice(0, 6);
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify(lista));
  } catch { /* navegador sem storage: só não lembra */ }
}

function nomeDoCliente(c: { nome_fantasia: string | null; razao_social: string | null }) {
  return c.nome_fantasia || c.razao_social || "Cliente sem nome";
}

function documento(cnpj: string | null) {
  if (!cnpj) return null;
  const d = cnpj.replace(/\D/g, "");
  return d.length === 11 ? maskCPF(d) : d.length === 14 ? maskCNPJ(d) : cnpj;
}

function iniciais(nome: string) {
  return nome.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}

const periodoPadrao = (): PeriodoRange => ({ from: startOfDay(subDays(new Date(), 89)), to: endOfDay(new Date()) });

/* ------------------------------------------------------------------ busca */

function BuscaCliente({ onEscolher, grande }: { onEscolher: (c: ClienteBusca) => void; grande?: boolean }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(termo), 250); return () => clearTimeout(t); }, [termo]);

  // Ctrl+K abre a busca de qualquer ponto da aba.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setAberto(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const { data = [], isFetching } = useQuery({
    queryKey: ["visao360_busca", tid, debounced],
    enabled: aberto && debounced.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<ClienteBusca[]> => {
      let q = (supabase.from("clientes") as any)
        .select("id, nome_fantasia, razao_social, cnpj, codigo_sequencial, cancelado")
        .or(filtroOrBuscaCliente(debounced))
        .order("cancelado", { ascending: true })
        .order("nome_fantasia", { ascending: true })
        .limit(20);
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border bg-card px-3 text-left text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/50",
            grande ? "h-12 text-base" : "h-10",
          )}
        >
          <Search className="h-4 w-4 flex-none" />
          <span className="flex-1 truncate">Buscar cliente por nome, CNPJ ou código</span>
          <kbd className="hidden rounded border px-1.5 font-mono text-[11px] sm:inline">Ctrl K</kbd>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(560px,calc(100vw-32px))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Digite ao menos 2 letras" value={termo} onValueChange={setTermo} autoFocus />
          <CommandList>
            {debounced.trim().length >= 2 && !isFetching && <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>}
            {data.length > 0 && (
              <CommandGroup>
                {data.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => { onEscolher(c); setAberto(false); setTermo(""); }}
                    className="flex items-center gap-3"
                  >
                    <span className={cn("h-2 w-2 flex-none rounded-full", c.cancelado ? "bg-red-500" : "bg-emerald-500")} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{nomeDoCliente(c)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[`Cód. ${c.codigo_sequencial}`, documento(c.cnpj), c.nome_fantasia && c.razao_social !== c.nome_fantasia ? c.razao_social : null].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {c.cancelado && <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">Cancelado</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Recentes({ onEscolher, atual }: { onEscolher: (id: string) => void; atual: string | null }) {
  const lista = lerRecentes().filter((r) => r.id !== atual);
  if (!lista.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      Vistos recentemente:
      {lista.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onEscolher(r.id)}
          className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 font-semibold text-foreground/80 transition-colors hover:text-foreground"
        >
          <span className={cn("h-1.5 w-1.5 flex-none rounded-full", r.cancelado ? "bg-red-500" : "bg-emerald-500")} />
          <span className="truncate">{r.nome}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ aba */

export default function Visao360Tab() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const [sp, setSp] = useSearchParams();
  const clienteId = sp.get("cliente");
  const podeChat = usePortao("atendimento_chat");
  const podeTicket = usePortao("tickets");
  const ehAdmin = useEhAdmin();

  const escolher = useCallback((id: string) => {
    const p = new URLSearchParams(sp);
    p.set("cliente", id);
    setSp(p, { replace: false });
  }, [sp, setSp]);

  const [periodo, setPeriodo] = useState<PeriodoRange>(periodoPadrao);
  const [subAba, setSubAba] = useState("linha");
  const [atendimentoAberto, setAtendimentoAberto] = useState<string | null>(null);
  const [ticketAberto, setTicketAberto] = useState<string | null>(null);
  const [novoTicket, setNovoTicket] = useState(false);

  const cliente = useCliente360(clienteId);
  const ats = useAtendimentos360(clienteId, tid);
  const tks = useTickets360(clienteId, tid);
  const contrato = useContrato360(clienteId, tid);
  const contatos = useContatos360(clienteId);
  const agentes = useAgentes360(tid);

  const c = cliente.data;
  const fin = useFinanceiro360(clienteId, c?.tenant_id ?? null);
  const finHab = fin.data?.habilitado === true;
  const titulos = useMemo(() => fin.data?.titulos ?? [], [fin.data]);
  const kFin = useMemo(() => kpisFinanceiro(titulos, new Date()), [titulos]);
  useEffect(() => {
    if (c) gravarRecente({ id: c.id, nome: nomeDoCliente(c), cancelado: c.cancelado });
  }, [c]);

  const nomeAgente = useCallback((uid: string | null) => (uid ? agentes.data?.get(uid) ?? null : null), [agentes.data]);
  const per: Periodo = useMemo(() => ({ from: periodo.from, to: periodo.to }), [periodo]);
  const listaAts = ats.data ?? [];
  const listaTks = tks.data ?? [];
  const produtos = contrato.data?.produtos ?? [];
  const movimentos = contrato.data?.movimentos ?? [];

  const serie = useMemo(() => serieMrr12m(produtos, movimentos, new Date()), [produtos, movimentos]);
  const mrrAtual = serie.length ? serie[serie.length - 1].valor : 0;
  const mrr12 = serie.length ? serie[0].valor : 0;
  const kAt = useMemo(() => kpisAtendimento(listaAts, per), [listaAts, per]);
  const kCs = useMemo(() => kpisCsat(listaAts, per), [listaAts, per]);
  const kTk = useMemo(() => kpisTicket(listaTks, per), [listaTks, per]);
  const mapa = useMemo(() => mapaDeContato(listaAts, new Date()), [listaAts]);
  const porMes = useMemo(() => {
    const hoje = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 11 + i, 1).getTime();
      const fim = new Date(hoje.getFullYear(), hoje.getMonth() - 10 + i, 1).getTime();
      return listaAts.filter((a) => { const t = new Date(a.opened_at).getTime(); return t >= ini && t < fim; }).length;
    });
  }, [listaAts]);
  const eventos = useMemo(
    () => montarLinhaDoTempo(listaAts, listaTks, movimentos, nomeAgente, per, titulos),
    [listaAts, listaTks, movimentos, nomeAgente, per, titulos],
  );

  // Nota de saúde: só depois que tudo que entra nela chegou, para o anel não
  // aparecer com um número e mudar para outro um segundo depois.
  const pesosQ = useSaudePesos(c?.tenant_id ?? null);
  const pronto = !!c && ats.isSuccess && tks.isSuccess && contrato.isSuccess && !fin.isLoading && pesosQ.isSuccess;
  const saude = useMemo(
    () => pronto
      ? calcularSaude({
          atendimentos: listaAts, tickets: listaTks, titulos, financeiroLigado: finHab,
          mrrAtual, mrr12m: mrr12, cancelado: !!c?.cancelado, hoje: new Date(),
        }, pesosQ.data!.pesos)
      : null,
    [pronto, listaAts, listaTks, titulos, finHab, mrrAtual, mrr12, c?.cancelado, pesosQ.data],
  );

  const proximos: ProximoEvento[] = useMemo(() => {
    const out: ProximoEvento[] = [];
    const hoje = startOfDay(new Date());
    const reaj = produtos
      .filter((p) => p.ativo && p.data_proximo_reajuste)
      .map((p) => ({ data: p.data_proximo_reajuste as string, produto: p.produto }));
    for (const r of reaj) {
      const f = differenceInCalendarDays(parseISO(r.data), hoje);
      if (f >= -30 && f <= 120) out.push({ data: r.data, titulo: "Reajuste do contrato", sub: r.produto, icone: "reajuste" });
    }
    if (c?.cert_a1_vencimento) {
      const f = differenceInCalendarDays(parseISO(c.cert_a1_vencimento), hoje);
      if (f >= -30 && f <= 120) out.push({ data: c.cert_a1_vencimento, titulo: "Vencimento do certificado A1", sub: "e-CNPJ", icone: "certificado" });
    }
    if (kFin.proximo) {
      out.push({ data: kFin.proximo.vencimento, titulo: "Próximo vencimento", sub: brl(kFin.proximo.valor), icone: "boleto" });
    }
    return out.sort((a, b) => (a.data < b.data ? -1 : 1));
  }, [produtos, c, kFin.proximo]);

  // O que pede atenção agora. Só aparece o que for verdade para este cliente.
  const alertas = useMemo(() => {
    const out: { tom: "ruim" | "alerta" | "info" | "ok"; Icon: typeof AlertTriangle; titulo: string; sub: string }[] = [];
    const esperando = listaAts.filter((a) => a.status === "waiting").length;
    if (esperando) out.push({ tom: "alerta", Icon: Clock, titulo: `${esperando} atendimento${esperando > 1 ? "s" : ""} na fila agora`, sub: "O cliente está esperando alguém assumir." });
    if (kFin.vencidoQtd) out.push({
      tom: "ruim", Icon: Receipt,
      titulo: `${brl(kFin.vencidoValor)} vencido${kFin.vencidoQtd > 1 ? ` em ${kFin.vencidoQtd} títulos` : ""}`,
      sub: `O mais antigo está vencido há ${kFin.maiorAtraso} dia${kFin.maiorAtraso === 1 ? "" : "s"}.`,
    });
    const velhos = listaTks.filter((t) => !t.status_final && differenceInCalendarDays(new Date(), parseISO(t.aberto_em)) > 7);
    if (velhos.length) out.push({ tom: "ruim", Icon: Ticket, titulo: `${velhos.length} ticket${velhos.length > 1 ? "s" : ""} aberto${velhos.length > 1 ? "s" : ""} há mais de 7 dias`, sub: velhos.slice(0, 2).map((t) => t.ticket_code).filter(Boolean).join(", ") });
    const detrator = listaAts.find((a) => a.csat_score != null && a.csat_score <= 2 && differenceInCalendarDays(new Date(), parseISO(a.csat_respondido_em ?? a.closed_at ?? a.opened_at)) <= 30);
    if (detrator) out.push({ tom: "ruim", Icon: Star, titulo: `Avaliação ${detrator.csat_score} ★ nos últimos 30 dias`, sub: detrator.csat_reason ? `"${detrator.csat_reason}"` : `Atendimento ${detrator.attendance_code ?? ""}` });
    for (const p of proximos) {
      if (p.icone === "boleto") continue; // o vencido já tem aviso próprio; a vencer é agenda, não alerta
      const f = differenceInCalendarDays(parseISO(p.data), new Date());
      if (f <= 30) out.push({
        tom: f < 0 ? "ruim" : "info",
        Icon: p.icone === "certificado" ? ShieldCheck : CalendarClock,
        titulo: f < 0 ? `${p.titulo} passou há ${-f} dia${f === -1 ? "" : "s"}` : `${p.titulo} em ${f} dia${f === 1 ? "" : "s"}`,
        sub: `${format(parseISO(p.data), "dd/MM/yyyy")} · ${p.sub}`,
      });
    }
    if (!out.length) {
      const elogio = listaAts.find((a) => a.csat_score === 5 && a.csat_reason && differenceInCalendarDays(new Date(), parseISO(a.csat_respondido_em ?? a.opened_at)) <= 30);
      if (elogio) out.push({ tom: "ok", Icon: Star, titulo: "Elogio recente", sub: `"${elogio.csat_reason}"` });
    }
    return out.slice(0, 4);
  }, [listaAts, listaTks, proximos, kFin]);

  // Conversas do cliente, da mais recente para a mais antiga, sem repetir.
  const conversas = useMemo(() => {
    const vistos = new Set<string>();
    const out: { id: string; nome: string; grupo: boolean; quando: string; aberta: boolean }[] = [];
    for (const a of listaAts) {
      if (!a.conversation_id || vistos.has(a.conversation_id)) continue;
      vistos.add(a.conversation_id);
      out.push({ id: a.conversation_id, nome: a.contact_name || "Contato", grupo: a.is_group, quando: a.opened_at, aberta: a.status !== "closed" });
    }
    return out.slice(0, 8);
  }, [listaAts]);

  const heroRef = useRef<HTMLDivElement>(null);
  const moverLuz = (e: React.PointerEvent) => {
    const el = heroRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - b.left}px`);
    el.style.setProperty("--my", `${e.clientY - b.top}px`);
  };

  /* ---- sem cliente escolhido */
  if (!clienteId) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4 py-10 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-sky-500 text-white shadow-lg shadow-emerald-500/30">
          <Orbit className="h-7 w-7" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Visão 360° do cliente</h2>
          <p className="mt-1 text-sm text-muted-foreground">Atendimentos, tickets, avaliações e contrato de um cliente numa tela só.</p>
        </div>
        <BuscaCliente grande onEscolher={(x) => escolher(x.id)} />
        <div className="flex justify-center"><Recentes onEscolher={escolher} atual={null} /></div>
      </div>
    );
  }

  const carregando = cliente.isLoading;
  const nome = c ? nomeDoCliente(c) : "";
  const desde = c?.data_ativacao || c?.data_cadastro;
  const produtosAtivos = produtos.filter((p) => p.ativo).length;
  const varMrr = mrr12 > 0 ? ((mrrAtual - mrr12) / mrr12) * 100 : null;
  const difCsat = kCs.media != null && kCs.mediaAnterior != null ? kCs.media - kCs.mediaAnterior : null;

  const abrirConversaNova = () => {
    if (!c) return;
    const fone = (c.telefone_whatsapp || "").replace(/\D/g, "");
    navigate(`/whatsapp?phone=${fone}&clienteId=${c.id}&clienteName=${encodeURIComponent(nome)}`);
  };

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[260px] flex-1"><BuscaCliente onEscolher={(x) => escolher(x.id)} /></div>
        <Recentes onEscolher={escolher} atual={clienteId} />
      </div>

      {/* ------------------------------------------------ topo */}
      <section
        ref={heroRef}
        onPointerMove={moverLuz}
        className="relative grid items-center gap-5 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(320px,auto)] rounded-2xl bg-slate-900 p-5 text-slate-200 sm:p-6"
        style={{
          backgroundImage:
            "radial-gradient(420px 220px at var(--mx,70%) var(--my,0%), rgba(255,255,255,.07), transparent 70%)," +
            "radial-gradient(900px 300px at 0% 0%, rgba(34,197,94,.28), transparent 60%)," +
            "radial-gradient(700px 300px at 100% 0%, rgba(14,165,233,.25), transparent 60%)," +
            "linear-gradient(135deg, #1E293B, #0F172A)",
        }}
      >
        {carregando || !c ? (
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-2xl bg-white/10" />
            <div className="grid gap-2"><Skeleton className="h-6 w-64 bg-white/10" /><Skeleton className="h-4 w-80 bg-white/10" /></div>
          </div>
        ) : (
          <>
            <div className="grid min-w-0 gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-16 w-16 flex-none place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-sky-500 text-2xl font-extrabold text-white shadow-[0_10px_30px_-10px_rgba(34,197,94,.6)]">
                {iniciais(nome)}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-extrabold tracking-tight text-white">{nome}</h2>
                <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-slate-400">
                  {documento(c.cnpj) && <span className="font-mono">{documento(c.cnpj)}</span>}
                  {c.cidade && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{c.cidade}{c.uf ? ` · ${c.uf}` : ""}</span>}
                  {c.unidade && <span>{c.unidade}</span>}
                  <span>Cód. {c.codigo_sequencial}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {c.cancelado ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-0.5 text-[11.5px] font-bold text-red-300">Cancelado</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11.5px] font-bold text-emerald-300">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                      </span>
                      Ativo
                    </span>
                  )}
                  {desde && (
                    <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11.5px] font-bold text-slate-300">
                      Cliente há {formatDistanceStrict(parseISO(desde), new Date(), { locale: ptBR })}
                    </span>
                  )}
                  {produtosAtivos > 0 && (
                    <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-[11.5px] font-bold text-sky-300">
                      {produtosAtivos} produto{produtosAtivos > 1 ? "s" : ""} ativo{produtosAtivos > 1 ? "s" : ""}
                    </span>
                  )}
                  {kFin.vencidoQtd > 0 && (
                    <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-[11.5px] font-bold text-red-300">
                      {kFin.vencidoQtd} título{kFin.vencidoQtd > 1 ? "s" : ""} vencido{kFin.vencidoQtd > 1 ? "s" : ""}
                    </span>
                  )}
                  {kTk.abertos > 0 && (
                    <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11.5px] font-bold text-amber-300">
                      {kTk.abertos} ticket{kTk.abertos > 1 ? "s" : ""} aberto{kTk.abertos > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {podeChat && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className={cn("inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-[12.5px] font-bold text-emerald-950 transition-transform duration-300 hover:-translate-y-px", EASE)}>
                      <MessageCircle className="h-4 w-4" />Abrir conversa<ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-1.5">
                    <div className="px-2 pb-1.5 pt-1 text-xs font-semibold text-muted-foreground">Conversas deste cliente</div>
                    {conversas.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">Nenhuma conversa ainda.</div>}
                    {conversas.map((cv) => (
                      <button
                        key={cv.id}
                        type="button"
                        onClick={() => navigate(`/whatsapp?conversation=${cv.id}`)}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                      >
                        <span className="grid h-7 w-7 flex-none place-items-center rounded-md bg-muted">
                          {cv.grupo ? <Users className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{cv.nome}</span>
                          <span className="block text-xs text-muted-foreground">
                            {cv.aberta ? "Atendimento aberto" : `Último atendimento em ${format(parseISO(cv.quando), "dd/MM/yy")}`}
                          </span>
                        </span>
                      </button>
                    ))}
                    {c.telefone_whatsapp && (
                      <button type="button" onClick={abrirConversaNova} className="mt-1 w-full rounded-md border-t px-2 py-2 text-left text-sm font-semibold text-primary hover:bg-muted">
                        Falar no WhatsApp da ficha ({c.telefone_whatsapp})
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
              )}
              {podeTicket && (
                <button type="button" onClick={() => setNovoTicket(true)} className={cn("inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[12.5px] font-bold text-slate-100 transition duration-300 hover:-translate-y-px hover:bg-white/10", EASE)}>
                  <Ticket className="h-4 w-4" />Novo ticket
                </button>
              )}
              <button type="button" onClick={() => navigate(`/clientes/${c.id}`)} className={cn("inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[12.5px] font-bold text-slate-100 transition duration-300 hover:-translate-y-px hover:bg-white/10", EASE)}>
                <FileText className="h-4 w-4" />Abrir ficha
              </button>
            </div>
            </div>
            {saude && <div className="relative z-[1] lg:row-span-2"><SaudeDoCliente saude={saude} podeAjustar={ehAdmin} personalizado={pesosQ.data?.personalizado ?? false} /></div>}
          </>
        )}
      </section>

      {/* ------------------------------------------------ números */}
      <section className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", finHab ? "lg:grid-cols-3 xl:grid-cols-5" : "xl:grid-cols-4")}>
        <Numero rotulo="MRR atual" Icon={TrendingUp} carregando={contrato.isLoading}
          valor={brl(mrrAtual)}
          sub={varMrr != null ? <><b className={varMrr >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{varMrr >= 0 ? "▲" : "▼"} {Math.abs(varMrr).toFixed(1).replace(".", ",")}%</b> em 12 meses</> : "sem histórico de 12 meses"}
          grafico={<Sparkline valores={serie.map((s) => s.valor)} />}
        />
        <Numero rotulo="Avaliação no período" Icon={Star} carregando={ats.isLoading}
          valor={kCs.media != null ? <>{kCs.media.toFixed(1).replace(".", ",")} <span className="text-sm text-muted-foreground">/ 5</span></> : "—"}
          sub={<>{kCs.qtd} avaliaç{kCs.qtd === 1 ? "ão" : "ões"}{difCsat != null && Math.abs(difCsat) >= 0.05 && <> · <b className={difCsat >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{difCsat >= 0 ? "▲" : "▼"} {Math.abs(difCsat).toFixed(1).replace(".", ",")}</b></>}</>}
          grafico={<div className="mt-2 flex h-7 items-center text-lg">{kCs.media != null ? <span className="tracking-[2px] text-amber-500">{"★".repeat(Math.round(kCs.media))}<span className="text-muted-foreground/30">{"★".repeat(5 - Math.round(kCs.media))}</span></span> : null}</div>}
        />
        <Numero rotulo="Atendimentos no período" Icon={MessageCircle} carregando={ats.isLoading}
          valor={kAt.total}
          sub={`1ª resposta ${minutos(kAt.primeiraRespostaSeg)} · TMA ${minutos(kAt.tmaSeg)}`}
          grafico={<MiniBarras valores={porMes} className="mt-2" />}
        />
        <Numero rotulo="Tickets abertos" Icon={Ticket} carregando={tks.isLoading}
          valor={kTk.abertos}
          sub={kTk.maisAntigoDias != null ? `o mais antigo tem ${kTk.maisAntigoDias} dia${kTk.maisAntigoDias === 1 ? "" : "s"}` : "nenhum pendente"}
          grafico={
            <div className="mt-2 flex flex-wrap gap-1.5">
              {listaTks.filter((t) => !t.status_final).slice(0, 3).map((t) => (
                <button key={t.id} type="button" onClick={() => setTicketAberto(t.id)} className="rounded-md bg-sky-500/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-400">
                  {t.ticket_code ?? "Ticket"}
                </button>
              ))}
            </div>
          }
        />
        {finHab && (
          <Numero rotulo="Financeiro em aberto" Icon={Receipt} carregando={fin.isLoading}
            valor={brl(kFin.abertoValor)}
            sub={kFin.vencidoQtd
              ? <b className="text-red-600 dark:text-red-400">{brl(kFin.vencidoValor)} vencido</b>
              : `${kFin.abertoQtd} título${kFin.abertoQtd === 1 ? "" : "s"}, nada vencido`}
            grafico={
              <button type="button" onClick={() => setSubAba("financeiro")} className="mt-2 text-xs font-semibold text-primary hover:underline">
                Ver títulos{kFin.pontualidade != null ? ` · pontualidade ${kFin.pontualidade}%` : ""}
              </button>
            }
          />
        )}
      </section>

      {/* ------------------------------------------------ atenção */}
      {alertas.length > 0 && (
        <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4" aria-label="O que pede atenção">
          {alertas.map((a, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5">
              <span className={cn("grid h-7 w-7 flex-none place-items-center rounded-lg", {
                ruim: "bg-red-500/15 text-red-600 dark:text-red-400",
                alerta: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
                ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
              }[a.tom])}>
                <a.Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 text-[12.5px]">
                <div className="text-[13px] font-bold">{a.titulo}</div>
                {a.sub && <div className="line-clamp-2 text-muted-foreground">{a.sub}</div>}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ------------------------------------------------ sub-abas */}
      <Tabs value={subAba} onValueChange={setSubAba}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <TabsList className="h-auto flex-wrap bg-transparent p-0">
            <SubAba valor="linha">Linha do tempo</SubAba>
            <SubAba valor="atendimentos" qtd={listaAts.length}>Atendimentos</SubAba>
            <SubAba valor="tickets" qtd={listaTks.length}>Tickets</SubAba>
            <SubAba valor="avaliacoes" qtd={listaAts.filter((a) => a.csat_score != null).length}>Avaliações</SubAba>
            {finHab && <SubAba valor="financeiro" qtd={kFin.abertoQtd}>Financeiro</SubAba>}
          </TabsList>
          <DateRangePicker dateRange={periodo} onDateRangeChange={(r) => setPeriodo(r)} allowAllTime align="end" />
        </div>

        {ats.isLoading || tks.isLoading ? (
          <div className="mt-4 grid gap-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>
        ) : (
          <>
            <TabsContent value="linha" className="mt-4">
              <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
                <div className="grid min-w-0 content-start gap-3.5">
                  <MapaDeContato dias={mapa} />
                  <LinhaDoTempo eventos={eventos} onAbrirAtendimento={setAtendimentoAberto} onAbrirTicket={setTicketAberto} />
                </div>
                <div className="grid min-w-0 content-start gap-3.5">
                  <QuemFala contatos={contatos.data ?? []} />
                  <ProximosEventos eventos={proximos} />
                  <OQueUsa produtos={produtos} />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="atendimentos" className="mt-4">
              <AtendimentosLista atendimentos={listaAts} periodo={per} nomeAgente={nomeAgente} onAbrir={setAtendimentoAberto} />
            </TabsContent>
            <TabsContent value="tickets" className="mt-4">
              <TicketsLista tickets={listaTks} periodo={per} nomeAgente={nomeAgente} onAbrir={setTicketAberto} />
            </TabsContent>
            <TabsContent value="avaliacoes" className="mt-4">
              <AvaliacoesLista atendimentos={listaAts} periodo={per} nomeAgente={nomeAgente} onAbrir={setAtendimentoAberto} />
            </TabsContent>
            {finHab && (
              <TabsContent value="financeiro" className="mt-4">
                <FinanceiroSubAba titulos={titulos} atualizadoEm={fin.data?.atualizadoEm ?? null} />
              </TabsContent>
            )}
          </>
        )}
      </Tabs>

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
                qc.invalidateQueries({ queryKey: ["visao360_tickets", clienteId] });
              }
            }}
          />
        )}
        {novoTicket && c && (
          <CreateSupportTicketModal
            open={novoTicket}
            onOpenChange={setNovoTicket}
            defaultClienteId={c.id}
            defaultClienteNome={nome}
            defaultClienteCodigo={c.codigo_sequencial}
            onCreated={() => qc.invalidateQueries({ queryKey: ["visao360_tickets", clienteId] })}
          />
        )}
      </Suspense>
    </div>
  );
}

function SubAba({ valor, qtd, children }: { valor: string; qtd?: number; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={valor}
      className="gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2 font-bold text-muted-foreground data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {children}
      {qtd != null && <span className="rounded-full bg-muted px-1.5 text-[10.5px] tabular-nums text-muted-foreground">{qtd}</span>}
    </TabsTrigger>
  );
}

function Numero({ rotulo, Icon, valor, sub, grafico, carregando }: {
  rotulo: string; Icon: typeof Star; valor: React.ReactNode; sub?: React.ReactNode; grafico?: React.ReactNode; carregando?: boolean;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card p-3.5 shadow-sm transition-transform duration-500 hover:-translate-y-0.5", EASE)}>
      <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
        {rotulo}<Icon className="h-4 w-4 text-muted-foreground/70" />
      </div>
      {carregando ? (
        <div className="mt-2 grid gap-2"><Skeleton className="h-7 w-28" /><Skeleton className="h-4 w-40" /></div>
      ) : (
        <>
          <div className="mt-1.5 text-[22px] font-extrabold tabular-nums tracking-tight">{valor}</div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
          {grafico}
        </>
      )}
    </div>
  );
}
