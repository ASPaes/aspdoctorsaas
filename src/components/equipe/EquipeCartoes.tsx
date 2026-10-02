import { Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Clock, EyeOff, Headset, Ticket, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { lazyWithReload } from "@/lib/staleChunkReload";
import { AvatarPessoa } from "./AvatarPessoa";
import { useCartoes } from "./useEquipe";
import type { Cartao, Pessoa, Ref } from "./tipos";

// o mesmo diálogo do módulo de Tickets (como na Visão 360): abre ali mesmo, sem sair do chat
const SupportTicketDetailDialog = lazyWithReload(() => import("@/components/tickets/SupportTicketDetailDialog"));
// idem para a conversa do atendimento (DEM-0515)
const AtendimentoConversaDialog = lazyWithReload(() => import("./AtendimentoConversaDialog"));

const moeda = (v: number | null | undefined) =>
  v == null ? null : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function minutosDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function duracao(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)}d`;
}

const PRIORIDADE: Record<string, { rotulo: string; cls: string }> = {
  baixa: { rotulo: "Baixa", cls: "bg-muted text-muted-foreground" },
  media: { rotulo: "Média", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  alta: { rotulo: "Alta", cls: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  urgente: { rotulo: "Urgente", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
};

const STATUS_ATENDIMENTO: Record<string, { rotulo: string; cls: string }> = {
  waiting: { rotulo: "Na fila", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  in_progress: { rotulo: "Em atendimento", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  closed: { rotulo: "Encerrado", cls: "bg-muted text-muted-foreground" },
  inactive_closed: { rotulo: "Encerrado", cls: "bg-muted text-muted-foreground" },
};

function Moldura({ icone: Icone, cor, children, acoes }: { icone: typeof Ticket; cor: string; children: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <div className="mt-1.5 max-w-lg overflow-hidden rounded-lg border bg-card">
      <div className="flex gap-3 p-3">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md", cor)}><Icone className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1 space-y-1">{children}</div>
      </div>
      {acoes && <div className="flex flex-wrap gap-2 border-t bg-muted/30 px-3 py-2">{acoes}</div>}
    </div>
  );
}

const botao = "inline-flex h-7 items-center rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-muted";
const botaoPri = "inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90";

function CartaoTicket({ c, mapa, onAbrir }: { c: Cartao; mapa: Map<string, Pessoa>; onAbrir: () => void }) {
  const d = c.dados;
  const pri = PRIORIDADE[d.prioridade] ?? PRIORIDADE.media;
  const resp = d.responsavel ? mapa.get(d.responsavel) : undefined;
  const concluido = !!d.concluido_em || d.status_final;
  const previsaoMin = d.previsao && !concluido ? Math.round((new Date(d.previsao).getTime() - Date.now()) / 60_000) : null;
  return (
    <Moldura icone={Ticket} cor="bg-sky-500/15 text-sky-600 dark:text-sky-400"
      acoes={<button type="button" className={botaoPri} onClick={onAbrir}>Abrir ticket</button>}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-mono font-semibold">{d.codigo ?? "Ticket"}</span>
        {d.status && (
          <span className="rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: `${d.status_cor}22`, color: d.status_cor }}>{d.status}</span>
        )}
        {!concluido && <span className={cn("rounded-full px-2 py-0.5 font-semibold", pri.cls)}>{pri.rotulo}</span>}
        {previsaoMin !== null && (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
            previsaoMin < 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-muted text-muted-foreground")}>
            <Clock className="h-3 w-3" />{previsaoMin < 0 ? `Atrasado ${duracao(-previsaoMin)}` : `Previsto em ${duracao(previsaoMin)}`}
          </span>
        )}
      </div>
      <p className="text-sm font-semibold leading-snug">{d.assunto}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {d.cliente && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{d.cliente}</span>}
        {resp ? (
          <span className="inline-flex items-center gap-1"><AvatarPessoa userId={d.responsavel} pessoa={resp} tamanho="xs" />{resp.nome}</span>
        ) : !concluido && <span>Sem responsável</span>}
      </div>
    </Moldura>
  );
}

function CartaoCliente({ c, onAbrir }: { c: Cartao; onAbrir: () => void }) {
  const d = c.dados;
  const desde = d.cliente_desde ? new Date(d.cliente_desde).getFullYear() : null;
  return (
    <Moldura icone={Building2} cor="bg-violet-500/15 text-violet-600 dark:text-violet-400"
      acoes={<button type="button" className={botaoPri} onClick={onAbrir}>Abrir cliente</button>}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold">{d.nome ?? "Cliente"}</span>
        {d.cancelado && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">Cancelado</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {d.cnpj && <span className="font-mono">{d.cnpj}</span>}
        {desde && <span>Cliente desde {desde}</span>}
        {moeda(d.mensalidade) && !d.cancelado && <span>Mensalidade {moeda(d.mensalidade)}</span>}
        <span className={cn(Number(d.tickets_abertos) > 0 && "font-semibold text-foreground")}>
          {Number(d.tickets_abertos) === 0 ? "Nenhum ticket aberto" : `${d.tickets_abertos} ${Number(d.tickets_abertos) === 1 ? "ticket aberto" : "tickets abertos"}`}
        </span>
      </div>
    </Moldura>
  );
}

function CartaoAtendimento({ c, mapa, eu, onAbrir, onVer }: { c: Cartao; mapa: Map<string, Pessoa>; eu: string; onAbrir: () => void; onVer: () => void }) {
  const d = c.dados;
  const st = STATUS_ATENDIMENTO[d.status] ?? { rotulo: d.status, cls: "bg-muted text-muted-foreground" };
  const aberto = d.status === "waiting" || d.status === "in_progress";
  const resp = d.responsavel ? mapa.get(d.responsavel) : undefined;
  // bola com a gente: a última palavra foi do cliente
  const esperando = aberto && d.ultima_do_cliente && (!d.ultima_nossa || d.ultima_do_cliente > d.ultima_nossa)
    ? minutosDesde(d.ultima_do_cliente) : null;
  return (
    <Moldura icone={Headset} cor="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      acoes={aberto ? (
        <>
          {/* responder só se faz na tela do chat; olhar, dá daqui mesmo */}
          <button type="button" className={botaoPri} onClick={onAbrir}>Abrir conversa</button>
          <button type="button" className={botao} onClick={onVer}>Ver aqui</button>
        </>
      ) : <button type="button" className={botao} onClick={onVer}>Ver conversa</button>}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold">Atendimento{d.grupo ? " em grupo" : ""}</span>
        {d.codigo && <span className="font-mono text-muted-foreground">{d.codigo}</span>}
        <span className={cn("rounded-full px-2 py-0.5 font-semibold", st.cls)}>{st.rotulo}</span>
        {esperando !== null && (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
            esperando >= 15 ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
            <Clock className="h-3 w-3" />Cliente esperando há {duracao(esperando)}
          </span>
        )}
      </div>
      <p className="text-sm font-semibold leading-snug">
        {d.contato}{d.cliente && d.cliente !== d.contato && <span className="font-normal text-muted-foreground"> · {d.cliente}</span>}
      </p>
      {d.previa && <p className="line-clamp-2 text-xs text-muted-foreground">“{d.previa}”</p>}
      <div className="text-xs text-muted-foreground">
        {resp ? (
          <span className="inline-flex items-center gap-1"><AvatarPessoa userId={d.responsavel} pessoa={resp} tamanho="xs" />{d.responsavel === eu ? "Com você" : `Com ${resp.nome}`}</span>
        ) : aberto && <span>Ninguém assumiu ainda</span>}
      </div>
    </Moldura>
  );
}

function SemAcesso({ r }: { r: Ref }) {
  const nome = r.tipo === "ticket" ? "este ticket" : r.tipo === "cliente" ? "este cliente" : "esta conversa";
  return (
    <div className="mt-1.5 flex max-w-lg items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <EyeOff className="h-3.5 w-3.5 shrink-0" />
      Você não tem acesso a {nome}{r.tipo === "atendimento" ? " (é de outro setor)" : ""}.
    </div>
  );
}

/** Cartões vivos anexados a uma mensagem. */
export function EquipeCartoes({ refs, mapa, eu }: { refs: Ref[]; mapa: Map<string, Pessoa>; eu: string }) {
  const navigate = useNavigate();
  const { lista, porChave, isLoading } = useCartoes(refs);
  const [ticket, setTicket] = useState<string | null>(null);
  const [atendimento, setAtendimento] = useState<string | null>(null);
  if (lista.length === 0) return null;
  return (
    <>
      {lista.map((r) => {
        const c = porChave.get(`${r.tipo}:${r.id}`);
        if (!c) {
          return isLoading
            ? <div key={`${r.tipo}:${r.id}`} className="mt-1.5 h-20 max-w-lg animate-pulse rounded-lg border bg-muted/40" />
            : <SemAcesso key={`${r.tipo}:${r.id}`} r={r} />;
        }
        if (c.tipo === "ticket") return <CartaoTicket key={c.id} c={c} mapa={mapa} onAbrir={() => setTicket(c.id)} />;
        if (c.tipo === "cliente") return <CartaoCliente key={c.id} c={c} onAbrir={() => navigate(`/clientes/${c.id}`)} />;
        return <CartaoAtendimento key={c.id} c={c} mapa={mapa} eu={eu}
          onAbrir={() => navigate(`/whatsapp?conversation=${c.dados.conversa_id}`)} onVer={() => setAtendimento(c.id)} />;
      })}
      {ticket && (
        <Suspense fallback={null}>
          <SupportTicketDetailDialog ticketId={ticket} open={!!ticket} onOpenChange={(o) => { if (!o) setTicket(null); }} />
        </Suspense>
      )}
      {atendimento && (
        <Suspense fallback={null}>
          <AtendimentoConversaDialog attendanceId={atendimento} onClose={() => setAtendimento(null)} />
        </Suspense>
      )}
    </>
  );
}

/** Etiqueta do anexo ainda no campo de escrever (antes de enviar). */
export function EtiquetaRef({ r, rotulo, onTirar }: { r: Ref; rotulo: string; onTirar: () => void }) {
  const Icone = r.tipo === "ticket" ? Ticket : r.tipo === "cliente" ? Building2 : Headset;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/50 py-0.5 pl-2 pr-1 text-xs">
      <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{rotulo}</span>
      <button type="button" onClick={onTirar} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Tirar ${rotulo}`}>
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
