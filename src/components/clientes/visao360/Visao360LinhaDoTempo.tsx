import { useMemo, useState } from "react";
import { format, parseISO, isToday, isYesterday, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageCircle, Ticket, Star, FileText, CalendarClock, ShieldCheck, Phone, Mail, Receipt, SquareArrowOutUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Cartao, Chips, Etiqueta, Vazio } from "./Visao360Ui";
import { brl, diaSP, type Evento360, type Produto360, type TipoEvento } from "./visao360Calc";
import type { Contato360, Modulo360 } from "./useVisao360";

const ICONE: Record<TipoEvento, { Icon: typeof MessageCircle; cls: string }> = {
  atendimento: { Icon: MessageCircle, cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  ticket: { Icon: Ticket, cls: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  avaliacao: { Icon: Star, cls: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  contrato: { Icon: FileText, cls: "bg-muted text-muted-foreground" },
  financeiro: { Icon: Receipt, cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
};

function rotuloDia(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return `Hoje · ${format(d, "dd/MM")}`;
  if (isYesterday(d)) return `Ontem · ${format(d, "dd/MM")}`;
  return format(d, "EEEE · dd/MM/yyyy", { locale: ptBR });
}

const LOTE = 25;

export function LinhaDoTempo({
  eventos,
  onAbrirAtendimento,
  onAbrirTicket,
}: {
  eventos: Evento360[];
  onAbrirAtendimento: (id: string) => void;
  onAbrirTicket: (id: string) => void;
}) {
  const [filtro, setFiltro] = useState<"todos" | TipoEvento>("todos");
  const [limite, setLimite] = useState(LOTE);

  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of eventos) c[e.tipo] = (c[e.tipo] ?? 0) + 1;
    return c;
  }, [eventos]);

  const visiveis = useMemo(
    () => eventos.filter((e) => filtro === "todos" || e.tipo === filtro),
    [eventos, filtro],
  );
  const pagina = visiveis.slice(0, limite);

  let diaAnterior = "";

  return (
    <Cartao
      titulo="Tudo o que aconteceu"
      acao={
        <Chips
          valor={filtro}
          onChange={(v) => { setFiltro(v); setLimite(LOTE); }}
          opcoes={[
            { id: "todos", label: "Tudo", qtd: eventos.length },
            { id: "atendimento", label: "Atendimentos", qtd: contagem.atendimento ?? 0 },
            { id: "ticket", label: "Tickets", qtd: contagem.ticket ?? 0 },
            { id: "avaliacao", label: "Avaliações", qtd: contagem.avaliacao ?? 0 },
            { id: "contrato", label: "Contrato", qtd: contagem.contrato ?? 0 },
            ...(contagem.financeiro ? [{ id: "financeiro" as const, label: "Financeiro", qtd: contagem.financeiro }] : []),
          ]}
        />
      }
    >
      {pagina.length === 0 ? (
        <Vazio>Nada aconteceu com este cliente no período escolhido.</Vazio>
      ) : (
        <ol className="max-h-[900px] overflow-y-auto px-4 pb-4">
          {pagina.map((e, i) => {
            const dia = diaSP(parseISO(e.quando));
            const mostraDia = dia !== diaAnterior;
            diaAnterior = dia;
            const { Icon, cls } = ICONE[e.tipo];
            const ultimo = i === pagina.length - 1 || diaSP(parseISO(pagina[i + 1].quando)) !== dia;
            const clicavel = !!(e.attendanceId || e.ticketId);
            return (
              <li key={e.id}>
                {mostraDia && (
                  <div className="pb-1.5 pl-10 pt-3 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground first-letter:uppercase">
                    {rotuloDia(e.quando)}
                  </div>
                )}
                <div className="relative grid grid-cols-[28px_1fr_auto] gap-3 py-2">
                  {!ultimo && <span className="absolute bottom-[-8px] left-[13.5px] top-9 w-px bg-border" aria-hidden />}
                  <span className={cn("grid h-7 w-7 place-items-center rounded-lg", cls)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <button
                      type="button"
                      disabled={!clicavel}
                      onClick={() => (e.ticketId ? onAbrirTicket(e.ticketId) : e.attendanceId && onAbrirAtendimento(e.attendanceId))}
                      className={cn("text-left text-[13px] font-bold", clicavel && "hover:text-primary hover:underline")}
                    >
                      {e.titulo}
                    </button>
                    {e.detalhe && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">{e.detalhe}</p>}
                    {e.mrr && e.mrr.antes !== e.mrr.depois && (
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px]">
                        <span className="text-muted-foreground">MRR</span>
                        <span className="tabular-nums text-muted-foreground">{brl(e.mrr.antes)}</span>
                        <span className={e.mrr.depois > e.mrr.antes ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>→</span>
                        <b className="tabular-nums">{brl(e.mrr.depois)}</b>
                      </p>
                    )}
                    {e.citacao && (
                      <p className="mt-1.5 border-l-2 pl-2.5 text-[12.5px] italic text-muted-foreground">"{e.citacao}"</p>
                    )}
                    {(e.tags.length > 0 || clicavel) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {e.tags.map((t, k) => <Etiqueta key={k} tom={t.tom}>{t.texto}</Etiqueta>)}
                        {clicavel && (
                          <button
                            type="button"
                            onClick={() => (e.ticketId ? onAbrirTicket(e.ticketId) : e.attendanceId && onAbrirAtendimento(e.attendanceId))}
                            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                          >
                            <SquareArrowOutUpRight className="h-3 w-3" />
                            {e.ticketId ? "Abrir ticket" : "Ver atendimento"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <time className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                    {e.tipo === "contrato" ? "" : format(parseISO(e.quando), "HH:mm")}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {visiveis.length > limite && (
        <div className="border-t px-4 py-2 text-center">
          <Button variant="ghost" size="sm" onClick={() => setLimite((l) => l + LOTE)}>
            Mostrar mais ({visiveis.length - limite} restantes)
          </Button>
        </div>
      )}
    </Cartao>
  );
}

const NIVEIS = [
  "bg-muted",
  "bg-emerald-500/30",
  "bg-emerald-500/55",
  "bg-emerald-500/80",
  "bg-emerald-600",
];

export function MapaDeContato({ dias }: { dias: { dia: string; qtd: number }[] }) {
  const total = dias.reduce((a, d) => a + d.qtd, 0);
  const nivel = (q: number) => (q === 0 ? 0 : q === 1 ? 1 : q === 2 ? 2 : q <= 4 ? 3 : 4);
  return (
    <Cartao titulo="Ritmo de contato" sub={`${total} atendimento${total === 1 ? "" : "s"} nos últimos 12 meses`}>
      <div className="px-4 pb-4">
        <div className="overflow-x-auto pb-1">
          <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]">
            {dias.map((d) => (
              <span
                key={d.dia}
                className={cn("block h-[11px] w-[11px] rounded-[3px]", NIVEIS[nivel(d.qtd)])}
                title={`${d.dia.split("-").reverse().join("/")}: ${d.qtd} atendimento${d.qtd === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          menos {NIVEIS.map((c) => <span key={c} className={cn("inline-block h-2.5 w-2.5 rounded-[3px]", c)} />)} mais
        </div>
      </div>
    </Cartao>
  );
}

export function QuemFala({ contatos }: { contatos: Contato360[] }) {
  return (
    <Cartao titulo="Quem fala pelo cliente" sub={`${contatos.length} contato${contatos.length === 1 ? "" : "s"}`}>
      {contatos.length === 0 ? (
        <Vazio>Nenhum contato cadastrado na ficha.</Vazio>
      ) : (
        <ul className="grid gap-2.5 px-4 pb-4">
          {contatos.slice(0, 6).map((c) => (
            <li key={c.id} className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-muted text-xs font-extrabold text-muted-foreground">
                {c.nome.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold">{c.nome}</div>
                <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {c.cargo && <span>{c.cargo}</span>}
                  {c.fone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.fone}</span>}
                  {c.email && <span className="inline-flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{c.email}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

export interface ProximoEvento {
  data: string;
  titulo: string;
  sub: string;
  icone: "reajuste" | "certificado" | "boleto";
}

export function ProximosEventos({ eventos }: { eventos: ProximoEvento[] }) {
  return (
    <Cartao titulo="Próximos eventos">
      {eventos.length === 0 ? (
        <Vazio>Nada agendado para os próximos meses.</Vazio>
      ) : (
        <ul className="px-4 pb-3">
          {eventos.map((e, i) => {
            const d = parseISO(e.data);
            const falta = differenceInCalendarDays(d, new Date());
            const Icon = e.icone === "certificado" ? ShieldCheck : e.icone === "boleto" ? Receipt : CalendarClock;
            return (
              <li key={i} className={cn("grid grid-cols-[44px_1fr] items-center gap-2.5 py-2", i > 0 && "border-t")}>
                <div className="rounded-lg border py-0.5 text-center leading-tight">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">{format(d, "MMM", { locale: ptBR })}</div>
                  <div className="text-base font-extrabold tabular-nums">{format(d, "dd")}</div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[13px] font-bold"><Icon className="h-3.5 w-3.5 text-muted-foreground" />{e.titulo}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.sub} · {falta < 0 ? `venceu há ${-falta} dia${falta === -1 ? "" : "s"}` : falta === 0 ? "hoje" : `em ${falta} dia${falta === 1 ? "" : "s"}`}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

export function OQueUsa({ produtos }: { produtos: Produto360[] }) {
  const ativos = produtos.filter((p) => p.ativo);
  const total = ativos.reduce((a, p) => a + p.vlr_mensal, 0);
  return (
    <Cartao titulo="O que ele usa" sub={ativos.length ? `${brl(total)}/mês em produtos` : undefined}>
      {ativos.length === 0 ? (
        <Vazio>Nenhum produto ativo.</Vazio>
      ) : (
        <ul className="px-4 pb-3">
          {ativos.map((p, i) => (
            <li key={p.id} className={cn("flex justify-between gap-3 py-2 text-[13px]", i > 0 && "border-t")}>
              <div className="min-w-0">
                <div className="truncate font-semibold">{p.produto}</div>
                {(p.data_ativacao || p.data_venda) && (
                  <div className="text-[11.5px] text-muted-foreground">
                    desde {format(parseISO((p.data_ativacao || p.data_venda) as string), "MM/yyyy")}
                  </div>
                )}
              </div>
              <span className="font-bold tabular-nums">{brl(p.vlr_mensal)}</span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

/**
 * Módulos ativos, agrupados pelo produto. Só aparece quando existe ao menos um:
 * cliente sem módulo não ganha um card vazio.
 * O valor mensal gravado é por unidade; a linha mostra quantidade × unitário.
 */
export function ModulosContratados({ produtos, modulos }: { produtos: Produto360[]; modulos: Modulo360[] }) {
  if (!modulos.length) return null;
  const grupos = produtos
    .filter((p) => p.ativo)
    .map((p) => ({ produto: p, itens: modulos.filter((m) => m.cliente_produto_id === p.id) }))
    .filter((g) => g.itens.length);
  const varios = grupos.length > 1;
  return (
    <Cartao titulo="Módulos contratados" sub={`${modulos.length} ativo${modulos.length === 1 ? "" : "s"}`}>
      <div className="grid gap-3 px-4 pb-4">
        {grupos.map((g) => (
          <div key={g.produto.id}>
            {varios && <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.produto.produto}</div>}
            <ul>
              {g.itens.map((m, i) => {
                const total = m.vlr_mensal * m.quantidade;
                return (
                  <li key={m.id} className={cn("flex items-center justify-between gap-3 py-1.5 text-[13px]", i > 0 && "border-t")}>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-semibold">{m.nome}</span>
                      {m.quantidade > 1 && <span className="rounded bg-muted px-1.5 text-[11px] font-bold tabular-nums text-muted-foreground">× {m.quantidade}</span>}
                      {m.oem && <span className="rounded border px-1 text-[10px] font-bold text-muted-foreground">OEM</span>}
                    </div>
                    <span className="flex-none text-xs tabular-nums text-muted-foreground">
                      {total > 0 ? `${brl(total)}/mês` : m.data_ativacao ? `desde ${format(parseISO(m.data_ativacao), "MM/yyyy")}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Cartao>
  );
}
