import { useMemo, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDown, ArrowUp, ArrowUpDown, SquareArrowOutUpRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ColumnFilter, FiltroData, FiltroFaixa, FiltroOpcoes, FiltroTexto } from "@/components/ui/ColumnFilter";
import { cn } from "@/lib/utils";
import { Cartao, Chips, Estrelas, Etiqueta, Mini, Vazio } from "./Visao360Ui";
import {
  FILTROS_ATENDIMENTO_VAZIOS, filtrarOrdenarAtendimentos, filtroAtendimentoAtivo, kpisAtendimento, kpisCsat,
  kpisTicket, minutos, rotuloResolucao, valorOpcaoAtendimento,
  type Atendimento360, type ColunaAtendimento, type FiltrosAtendimento, type Periodo, type Ticket360,
} from "./visao360Calc";

function noPeriodo(iso: string | null, p: Periodo) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= p.from.getTime() && t <= p.to.getTime();
}

function dataHora(iso: string) {
  return format(parseISO(iso), "dd/MM/yy HH:mm");
}

const LOTE = 50;

function MaisLinhas({ total, limite, onMais }: { total: number; limite: number; onMais: () => void }) {
  if (total <= limite) return null;
  return (
    <div className="border-t px-4 py-2 text-center">
      <Button variant="ghost" size="sm" onClick={onMais}>Mostrar mais ({total - limite} restantes)</Button>
    </div>
  );
}

export function AtendimentosLista({
  atendimentos, periodo, nomeAgente, onAbrir,
}: {
  atendimentos: Atendimento360[];
  periodo: Periodo;
  nomeAgente: (uid: string | null) => string | null;
  onAbrir: (id: string) => void;
}) {
  const [tipo, setTipo] = useState<"todos" | "individual" | "grupo" | "abertos">("todos");
  const [limite, setLimite] = useState(LOTE);
  const [filtros, setFiltros] = useState<FiltrosAtendimento>(FILTROS_ATENDIMENTO_VAZIOS);
  // Mais recente primeiro: é a ordem em que a pessoa procura "o que houve".
  const [ordem, setOrdem] = useState<{ coluna: ColunaAtendimento; dir: "asc" | "desc" }>({ coluna: "aberto", dir: "desc" });
  const k = kpisAtendimento(atendimentos, periodo);

  // Base = período + chips. Os funis recortam em cima dela, e as opções de
  // cada funil (com a contagem) saem dela também, para nunca listar um valor
  // que devolveria zero linhas.
  const base = useMemo(
    () => atendimentos
      .filter((a) => noPeriodo(a.opened_at, periodo) || (tipo === "abertos" && a.status !== "closed"))
      .filter((a) => tipo === "todos" || (tipo === "grupo" ? a.is_group : tipo === "individual" ? !a.is_group : a.status !== "closed")),
    [atendimentos, periodo, tipo],
  );
  const lista = useMemo(
    () => filtrarOrdenarAtendimentos(base, filtros, ordem, nomeAgente),
    [base, filtros, ordem, nomeAgente],
  );
  const opcoes = useMemo(() => {
    const out: Record<"assunto" | "agente" | "setor" | "csat" | "resolucao", { valor: string; rotulo: string; n: number }[]> =
      { assunto: [], agente: [], setor: [], csat: [], resolucao: [] };
    for (const c of Object.keys(out) as (keyof typeof out)[]) {
      const cont = new Map<string, number>();
      for (const a of base) { const v = valorOpcaoAtendimento(a, c, nomeAgente); cont.set(v, (cont.get(v) ?? 0) + 1); }
      out[c] = [...cont.entries()]
        .sort((x, y) => (c === "csat" ? y[0].localeCompare(x[0]) : y[1] - x[1]))
        .map(([valor, n]) => ({ valor, rotulo: valor, n }));
    }
    return out;
  }, [base, nomeAgente]);
  const qtdFunis = (Object.keys(filtros) as (keyof FiltrosAtendimento)[]).filter((c) => filtroAtendimentoAtivo(filtros, c)).length;
  const dif = k.total - k.totalAnterior;

  const mexer = <C extends keyof FiltrosAtendimento>(c: C, v: FiltrosAtendimento[C]) => {
    setFiltros((f) => ({ ...f, [c]: v }));
    setLimite(LOTE);
  };

  // Clique na mesma coluna inverte; coluna nova começa pelo sentido que faz
  // sentido nela: texto A→Z, data/número do maior para o menor.
  const ordenar = (coluna: ColunaAtendimento) =>
    setOrdem((o) => o.coluna === coluna
      ? { coluna, dir: o.dir === "asc" ? "desc" : "asc" }
      : { coluna, dir: ["aberto", "duracao", "csat"].includes(coluna) ? "desc" : "asc" });

  const cab = (coluna: ColunaAtendimento, rotulo: string, funil: ReactNode, direita = false) => {
    const ativa = ordem.coluna === coluna;
    const Icone = !ativa ? ArrowUpDown : ordem.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead className={cn("whitespace-nowrap", direita && "text-right")}>
        <div className={cn("flex items-center gap-1", direita && "justify-end")}>
          {direita && funil}
          <button
            type="button"
            onClick={() => ordenar(coluna)}
            title={ativa ? (ordem.dir === "asc" ? "Do menor para o maior. Clique para inverter." : "Do maior para o menor. Clique para inverter.") : `Ordenar por ${rotulo}`}
            className={cn("flex items-center gap-1 transition-colors hover:text-foreground", ativa && "text-foreground")}
          >
            {direita && <Icone className={cn("h-3 w-3", !ativa && "opacity-40")} />}
            {rotulo}
            {!direita && <Icone className={cn("h-3 w-3", !ativa && "opacity-40")} />}
          </button>
          {!direita && funil}
        </div>
      </TableHead>
    );
  };

  const funilOpcoes = (c: "assunto" | "agente" | "setor" | "csat" | "resolucao", titulo: string, align: "start" | "end" = "start") => (
    <ColumnFilter titulo={titulo} ativo={filtros[c].length > 0} onLimpar={() => mexer(c, [])} align={align}>
      <FiltroOpcoes opcoes={opcoes[c]} selecionadas={filtros[c]} onChange={(v) => mexer(c, v)} />
    </ColumnFilter>
  );

  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini rotulo="Atendimentos no período" valor={k.total} sub={`${dif >= 0 ? "▲" : "▼"} ${Math.abs(dif)} vs. período anterior`} />
        <Mini rotulo="1ª resposta média" valor={minutos(k.primeiraRespostaSeg)} />
        <Mini rotulo="Tempo médio (TMA)" valor={minutos(k.tmaSeg)} sub="dos encerrados" />
        <Mini
          rotulo="Resolvidos"
          valor={k.comResolucao ? `${Math.round((k.resolvidos / k.comResolucao) * 100)}%` : "—"}
          sub={k.comResolucao ? `${k.resolvidos} de ${k.comResolucao} com resolução marcada` : "nenhum com resolução marcada"}
        />
      </div>
      <Cartao
        titulo="Atendimentos"
        acao={
          <Chips
            valor={tipo}
            onChange={(v) => { setTipo(v); setLimite(LOTE); }}
            opcoes={[
              { id: "todos", label: "Todos" },
              { id: "individual", label: "Individuais" },
              { id: "grupo", label: "Grupo" },
              { id: "abertos", label: "Abertos agora", qtd: k.abertosAgora },
            ]}
          />
        }
      >
        {qtdFunis > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-y bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
            Mostrando <b className="tabular-nums text-foreground">{lista.length}</b> de <span className="tabular-nums">{base.length}</span>
            {" "}com {qtdFunis} filtro{qtdFunis > 1 ? "s" : ""} de coluna.
            <button type="button" onClick={() => { setFiltros(FILTROS_ATENDIMENTO_VAZIOS); setLimite(LOTE); }} className="font-semibold text-primary hover:underline">
              Limpar filtros
            </button>
          </div>
        )}
        {base.length === 0 ? (
          <Vazio>Nenhum atendimento no período.</Vazio>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {cab("codigo", "Nº",
                    <ColumnFilter titulo="Nº" ativo={!!filtros.codigo.trim()} onLimpar={() => mexer("codigo", "")}>
                      <FiltroTexto valor={filtros.codigo} onChange={(v) => mexer("codigo", v)} placeholder="Ex.: 48213" />
                    </ColumnFilter>)}
                  {cab("aberto", "Aberto em",
                    <ColumnFilter titulo="Aberto em" ativo={filtroAtendimentoAtivo(filtros, "aberto")} onLimpar={() => mexer("aberto", { de: "", ate: "" })} largura="w-60">
                      <FiltroData de={filtros.aberto.de} ate={filtros.aberto.ate} onChange={(v) => mexer("aberto", v)} />
                    </ColumnFilter>)}
                  {cab("contato", "Contato",
                    <ColumnFilter titulo="Contato" ativo={!!filtros.contato.trim()} onLimpar={() => mexer("contato", "")}>
                      <FiltroTexto valor={filtros.contato} onChange={(v) => mexer("contato", v)} placeholder="Nome do contato" />
                    </ColumnFilter>)}
                  {cab("assunto", "Assunto", funilOpcoes("assunto", "Assunto"))}
                  {cab("agente", "Agente", funilOpcoes("agente", "Agente"))}
                  {cab("setor", "Setor", funilOpcoes("setor", "Setor"))}
                  {cab("duracao", "Duração",
                    <ColumnFilter titulo="Duração" ativo={filtroAtendimentoAtivo(filtros, "duracao")} onLimpar={() => mexer("duracao", { min: "", max: "" })} align="end">
                      <FiltroFaixa min={filtros.duracao.min} max={filtros.duracao.max} onChange={(v) => mexer("duracao", v)} dica="Em minutos. Só atendimentos encerrados." />
                    </ColumnFilter>, true)}
                  {cab("csat", "CSAT", funilOpcoes("csat", "CSAT", "end"))}
                  {cab("resolucao", "Resolução", funilOpcoes("resolucao", "Resolução", "end"))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum atendimento com esses filtros.
                    </TableCell>
                  </TableRow>
                )}
                {lista.slice(0, limite).map((a) => {
                  const r = a.status !== "closed"
                    ? { texto: a.status === "waiting" ? "Na fila" : "Em atendimento", tom: "info" as const }
                    : rotuloResolucao(a.resolucao);
                  return (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => onAbrir(a.id)}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{a.attendance_code ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{dataHora(a.opened_at)}</TableCell>
                      <TableCell className="max-w-[160px] truncate">
                        {a.contact_name ?? "—"}{a.is_group && <Etiqueta tom="info" className="ml-1.5">Grupo</Etiqueta>}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-muted-foreground" title={a.ai_summary ?? undefined}>
                        {a.ai_category || a.ai_summary || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{nomeAgente(a.assigned_to) ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{a.departamento ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.status === "closed" ? minutos(a.handle_seconds) : "—"}</TableCell>
                      <TableCell>{a.csat_score != null ? <Estrelas nota={a.csat_score} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {r ? <Etiqueta tom={r.tom}>{r.texto}</Etiqueta> : <span className="text-muted-foreground">—</span>}
                        {a.ticket_id && <Etiqueta tom="info" className="ml-1">Ticket</Etiqueta>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <MaisLinhas total={lista.length} limite={limite} onMais={() => setLimite((l) => l + LOTE)} />
      </Cartao>
    </div>
  );
}

export function TicketsLista({
  tickets, periodo, nomeAgente, onAbrir,
}: {
  tickets: Ticket360[];
  periodo: Periodo;
  nomeAgente: (uid: string | null) => string | null;
  onAbrir: (id: string) => void;
}) {
  const [filtro, setFiltro] = useState<"abertos" | "periodo">("abertos");
  const [limite, setLimite] = useState(LOTE);
  const [cartao, setCartao] = useState<{ titulo: string; itens: Ticket360[] } | null>(null);
  const k = kpisTicket(tickets, periodo);
  // "Abertos" ignora o período de propósito: ticket esquecido há 3 meses é
  // justamente o que precisa aparecer.
  const lista = filtro === "abertos"
    ? tickets.filter((t) => !t.status_final)
    : tickets.filter((t) => noPeriodo(t.aberto_em, periodo) || noPeriodo(t.concluido_em, periodo));

  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini
          rotulo="Abertos agora" valor={k.abertos}
          sub={k.maisAntigoDias != null ? `mais antigo: ${k.maisAntigoDias} dia${k.maisAntigoDias === 1 ? "" : "s"}` : "nenhum pendente"}
          onClick={() => setCartao({ titulo: "Tickets abertos agora", itens: tickets.filter((t) => !t.status_final) })}
        />
        <Mini
          rotulo="Encerrados no período" valor={k.concluidosNoPeriodo}
          sub={k.duracaoMediaDias != null ? `levaram ${k.duracaoMediaDias.toFixed(1).replace(".", ",")} dias em média` : undefined}
          onClick={() => setCartao({ titulo: "Tickets encerrados no período", itens: tickets.filter((t) => t.status_final && noPeriodo(t.concluido_em, periodo)) })}
        />
        <Mini
          rotulo="Categoria mais comum" valor={<span className="text-base">{k.categoriaTop?.nome ?? "—"}</span>}
          sub={k.categoriaTop ? `${k.categoriaTop.pct}% dos abertos no período` : undefined}
          onClick={k.categoriaTop ? () => setCartao({
            titulo: `Categoria ${k.categoriaTop!.nome}, abertos no período`,
            itens: tickets.filter((t) => noPeriodo(t.aberto_em, periodo) && (t.categoria || "Sem categoria") === k.categoriaTop!.nome),
          }) : undefined}
        />
        <Mini
          rotulo="Total na história" valor={tickets.length}
          onClick={() => setCartao({ titulo: "Todos os tickets do cliente", itens: tickets })}
        />
      </div>
      <TicketsDoCartao cartao={cartao} onFechar={() => setCartao(null)} onAbrir={onAbrir} nomeAgente={nomeAgente} />
      <Cartao
        titulo="Tickets"
        acao={
          <Chips
            valor={filtro}
            onChange={(v) => { setFiltro(v); setLimite(LOTE); }}
            opcoes={[{ id: "abertos", label: "Abertos agora", qtd: k.abertos }, { id: "periodo", label: "Do período" }]}
          />
        }
      >
        {lista.length === 0 ? (
          <Vazio>{filtro === "abertos" ? "Nenhum ticket aberto." : "Nenhum ticket no período."}</Vazio>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead><TableHead>Aberto em</TableHead><TableHead>Assunto</TableHead>
                  <TableHead>Categoria</TableHead><TableHead>Responsável</TableHead><TableHead>Status</TableHead>
                  <TableHead className="text-right">Idade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.slice(0, limite).map((t) => {
                  const fim = t.status_final && t.concluido_em ? new Date(t.concluido_em) : new Date();
                  const idade = Math.max(0, Math.floor((fim.getTime() - new Date(t.aberto_em).getTime()) / 86_400_000));
                  return (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => onAbrir(t.id)}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{t.ticket_code ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{format(parseISO(t.aberto_em), "dd/MM/yy")}</TableCell>
                      <TableCell className="max-w-[280px] truncate" title={t.assunto}>{t.assunto}</TableCell>
                      <TableCell className="whitespace-nowrap">{t.categoria ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{nomeAgente(t.responsavel_user_id) ?? "—"}</TableCell>
                      <TableCell>
                        <span
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold"
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.status_cor || (t.status_final ? "#22C55E" : "#0EA5E9") }} />
                          {t.status_nome ?? (t.status_final ? "Encerrado" : "Aberto")}
                        </span>
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", !t.status_final && idade > 7 && "font-bold text-amber-600 dark:text-amber-400")}>
                        {idade} d
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <MaisLinhas total={lista.length} limite={limite} onMais={() => setLimite((l) => l + LOTE)} />
      </Cartao>
    </div>
  );
}

const COR_NOTA = ["#EF4444", "#F97316", "#F59E0B", "#86EFAC", "#22C55E"];

export function AvaliacoesLista({
  atendimentos, periodo, nomeAgente, onAbrir,
}: {
  atendimentos: Atendimento360[];
  periodo: Periodo;
  nomeAgente: (uid: string | null) => string | null;
  onAbrir: (id: string) => void;
}) {
  const k = kpisCsat(atendimentos, periodo);
  const avaliados = atendimentos
    .filter((a) => a.csat_score != null && noPeriodo(a.csat_respondido_em ?? a.closed_at ?? a.opened_at, periodo))
    .sort((a, b) => ((b.csat_respondido_em ?? b.opened_at) > (a.csat_respondido_em ?? a.opened_at) ? 1 : -1));

  // Média por mês, últimos 12 meses — independe do período, é a tendência.
  const meses = useMemo(() => {
    const hoje = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 11 + i, 1);
      const fim = new Date(hoje.getFullYear(), hoje.getMonth() - 10 + i, 1);
      const notas = atendimentos
        .filter((a) => a.csat_score != null)
        .filter((a) => { const t = new Date(a.csat_respondido_em ?? a.closed_at ?? a.opened_at).getTime(); return t >= ini.getTime() && t < fim.getTime(); })
        .map((a) => a.csat_score as number);
      return { mes: ini, media: notas.length ? notas.reduce((x, y) => x + y, 0) / notas.length : null, qtd: notas.length };
    });
  }, [atendimentos]);

  const maxQtd = Math.max(1, ...k.dist.map((d) => d.qtd));

  return (
    <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Cartao titulo="O que o cliente disse" sub={`${avaliados.length} avaliaç${avaliados.length === 1 ? "ão" : "ões"} no período`}>
        {avaliados.length === 0 ? (
          <Vazio>Nenhuma avaliação no período.</Vazio>
        ) : (
          <ul className="max-h-[720px] overflow-y-auto px-4 pb-3">
            {avaliados.slice(0, 100).map((a, i) => (
              <li key={a.id} className={cn("py-2.5", i > 0 && "border-t")}>
                <button type="button" onClick={() => onAbrir(a.id)} className="flex flex-wrap items-center gap-2 text-left">
                  <Estrelas nota={a.csat_score as number} />
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(a.csat_respondido_em ?? a.closed_at ?? a.opened_at), "dd/MM/yy")}
                    {nomeAgente(a.assigned_to) ? ` · ${nomeAgente(a.assigned_to)}` : ""}
                    {a.attendance_code ? ` · ${a.attendance_code}` : ""}
                  </span>
                </button>
                {a.csat_reason
                  ? <p className="mt-1 text-[13px] text-muted-foreground">"{a.csat_reason}"</p>
                  : <p className="mt-1 text-xs italic text-muted-foreground/70">sem comentário</p>}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
      <div className="grid content-start gap-3.5">
        <Cartao titulo="Distribuição" sub={k.qtd ? `média ${k.media!.toFixed(1).replace(".", ",")} de 5` : undefined}>
          <div className="grid gap-2 px-4 pb-4">
            {[...k.dist].reverse().map((d) => (
              <div key={d.nota} className="grid grid-cols-[44px_1fr_32px] items-center gap-2.5 text-[12.5px]">
                <span>{d.nota} ★</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full" style={{ width: `${(d.qtd / maxQtd) * 100}%`, background: COR_NOTA[d.nota - 1] }} />
                </span>
                <b className="text-right tabular-nums">{d.qtd}</b>
              </div>
            ))}
          </div>
        </Cartao>
        <Cartao titulo="Média por mês" sub="últimos 12 meses">
          <div className="flex h-32 items-end gap-1.5 px-4 pb-2">
            {meses.map((m) => (
              <div key={m.mes.toISOString()} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={m.media != null ? `${m.media.toFixed(1)} · ${m.qtd} avaliações` : "sem avaliação"}>
                <span className="text-[9px] tabular-nums text-muted-foreground">{m.media != null ? m.media.toFixed(1).replace(".", ",") : ""}</span>
                <span
                  className="w-full rounded-t-[3px]"
                  style={{
                    height: m.media != null ? `${Math.max(6, (m.media / 5) * 80)}%` : "3px",
                    background: m.media == null ? "hsl(var(--muted))" : COR_NOTA[Math.max(0, Math.min(4, Math.round(m.media) - 1))],
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 px-4 pb-3 text-[9px] text-muted-foreground">
            {meses.map((m) => <span key={m.mes.toISOString()} className="flex-1 text-center">{format(m.mes, "MMM", { locale: ptBR }).slice(0, 3)}</span>)}
          </div>
        </Cartao>
      </div>
    </div>
  );
}

/**
 * Os tickets que formam o número de um cartão da aba Tickets. "Abrir ticket"
 * abre o detalhe por cima desta lista; fechar o detalhe volta para ela.
 */
function TicketsDoCartao({
  cartao, onFechar, onAbrir, nomeAgente,
}: {
  cartao: { titulo: string; itens: Ticket360[] } | null;
  onFechar: () => void;
  onAbrir: (id: string) => void;
  nomeAgente: (uid: string | null) => string | null;
}) {
  const itens = [...(cartao?.itens ?? [])].sort((a, b) => (b.aberto_em > a.aberto_em ? 1 : -1));
  return (
    <Dialog open={!!cartao} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[88vh] w-[96vw] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cartao?.titulo}</DialogTitle>
          <DialogDescription>{itens.length} ticket{itens.length === 1 ? "" : "s"}</DialogDescription>
        </DialogHeader>
        {itens.length === 0 ? (
          <Vazio>Nenhum ticket aqui.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Código</TableHead><TableHead className="whitespace-nowrap">Aberto em</TableHead><TableHead className="whitespace-nowrap">Assunto</TableHead>
                  <TableHead className="whitespace-nowrap">Categoria</TableHead><TableHead className="whitespace-nowrap">Responsável</TableHead><TableHead className="whitespace-nowrap">Status</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{t.ticket_code ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{format(parseISO(t.aberto_em), "dd/MM/yy")}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={t.assunto}>{t.assunto}</TableCell>
                    <TableCell className="whitespace-nowrap">{t.categoria ?? "Sem categoria"}</TableCell>
                    <TableCell className="whitespace-nowrap">{nomeAgente(t.responsavel_user_id) ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.status_cor || (t.status_final ? "#22C55E" : "#0EA5E9") }} />
                        {t.status_nome ?? (t.status_final ? "Encerrado" : "Aberto")}
                        {t.status_final && t.concluido_em ? ` em ${format(parseISO(t.concluido_em), "dd/MM/yy")}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onAbrir(t.id)}>
                        <SquareArrowOutUpRight className="h-3.5 w-3.5" />Abrir ticket
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
