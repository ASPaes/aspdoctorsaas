import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWhatsappCostDashboard, type TecnicoCusto } from "./useWhatsappCusto";
import { AvisoDoValor, BarrasOrigem, LegendaOrigem, ListaSugestoes, SeloValor } from "./CustoUi";
import { brl, dec, ehAutomacao, num, origemInfo, pct } from "./whatsappCustoFormat";

/**
 * Aba "Custo WhatsApp Oficial" do Painel de Uso. Uma chamada só
 * (get_whatsapp_cost_dashboard); o período vem do seletor do topo do painel.
 * Só é montada para quem tem a permissão painel_uso.custo_whatsapp e para
 * empresa com número da API Oficial — o PainelUso decide.
 */

const NOMES_SUG: Record<string, string> = {
  rajada: "Mensagens picadas",
  vazias: "Só “ok”",
  atendimento_longo: "Atendimento longo",
};

type Chave = "nome" | "enviadas" | "atendimentos" | "msgs_por_atendimento" | "pct_rajada" | "pct_vazias" | "custo_rs" | "evitavel_rs";

const COLUNAS: Array<{ k: Chave; rotulo: string }> = [
  { k: "nome", rotulo: "Técnico" },
  { k: "enviadas", rotulo: "Enviadas" },
  { k: "atendimentos", rotulo: "Atendimentos" },
  { k: "msgs_por_atendimento", rotulo: "Msgs/atend." },
  { k: "pct_rajada", rotulo: "% picadas" },
  { k: "pct_vazias", rotulo: "% só “ok”" },
  { k: "custo_rs", rotulo: "R$" },
  { k: "evitavel_rs", rotulo: "R$ evitável" },
];

function Painel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-xl border bg-card px-3.5 py-3", className)}>{children}</div>;
}

function Titulo({ children, dica }: { children: React.ReactNode; dica?: string }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{children}</span>
      {dica && <span className="text-[11px] text-muted-foreground">{dica}</span>}
    </div>
  );
}

export function CustoWhatsappTab({ tenantId, de, ate }: { tenantId: string; de: Date; ate: Date }) {
  const [instancia, setInstancia] = useState<string>("todas");
  const q = useWhatsappCostDashboard({ tenantId, de, ate, instanceId: instancia === "todas" ? null : instancia });
  // A lista de números vem da chamada sem filtro, para o seletor não encolher.
  const qTodos = useWhatsappCostDashboard({ tenantId, de, ate, enabled: instancia !== "todas" });
  const numeros = (instancia === "todas" ? q.data : qTodos.data ?? q.data)?.por_instancia ?? [];

  const [ordem, setOrdem] = useState<{ k: Chave; dir: "asc" | "desc" }>({ k: "custo_rs", dir: "desc" });
  const d = q.data;

  const tecnicos = useMemo(() => {
    // Quem só encerrou atendimento sem digitar pela API Oficial não tem custo a mostrar.
    const lista = (d?.por_tecnico ?? []).filter((t) => t.enviadas > 0);
    lista.sort((a, b) => {
      const x = a[ordem.k] as any, y = b[ordem.k] as any;
      const c = typeof x === "string" ? x.localeCompare(y, "pt-BR") : (x ?? -1) - (y ?? -1);
      return ordem.dir === "asc" ? c : -c;
    });
    return lista;
  }, [d?.por_tecnico, ordem]);

  if (q.isLoading) {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if ((q.error as any)?.code === "42501") {
    return (
      <Painel className="py-10 text-center">
        <Lock className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="mt-2 text-sm font-semibold">Você não tem acesso ao custo da empresa.</p>
        <p className="mt-1 text-xs text-muted-foreground">Quem libera é o administrador, em Configurações › Permissões.</p>
      </Painel>
    );
  }
  if (q.isError || !d) {
    return <Painel className="py-10 text-center text-sm text-muted-foreground">Não foi possível carregar o custo agora. Tente de novo em instantes.</Painel>;
  }

  const r = d.resumo;
  const mesAtual = format(new Date(), "MMMM", { locale: ptBR });
  const automacoes = d.por_origem.filter((o) => ehAutomacao(o.origem));
  const evitavelPct = r.custo_rs > 0 ? (r.evitavel_rs / r.custo_rs) * 100 : 0;
  const med = d.mediana_time_msgs_por_atendimento;
  const serie = d.por_dia.map((p) => {
    const dt = parseISO(p.dia);
    return { ...p, rotulo: format(dt, "dd/MM"), fds: dt.getDay() === 0 || dt.getDay() === 6 };
  });

  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AvisoDoValor fonte={r.fonte} simulacao={d.simulacao} preco={r.preco_unitario} franquia={r.franquia_por_numero} className="min-w-0 flex-1" />
          {numeros.length > 1 && (
            <Select value={instancia} onValueChange={setInstancia}>
              <SelectTrigger className="h-8 w-[220px] text-xs" aria-label="Filtrar por número">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos os números</SelectItem>
                {numeros.map((n) => <SelectItem key={n.instance_id} value={n.instance_id}>{n.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Painel>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Custo no período</span>
              <SeloValor fonte={r.fonte} simulacao={d.simulacao} />
            </div>
            <div className="mt-1.5 text-[26px] font-semibold tabular-nums leading-tight">{brl(r.custo_rs)}</div>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">
              {num(r.enviadas)} mensagens enviadas
              {r.fonte === "real" && <> · {num(r.cobradas_reais)} cobradas</>}
            </div>
          </Painel>
          <Painel>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Projeção de {mesAtual}</span>
              <SeloValor fonte={r.fonte} simulacao={null} />
            </div>
            <div className="mt-1.5 text-[26px] font-semibold tabular-nums leading-tight">{brl(r.projecao_mes_rs, true)}</div>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">No ritmo do mês até agora, descontada a franquia de cada número.</div>
          </Painel>
          <Painel>
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Dá para evitar</span>
            <div className="mt-1.5 text-[26px] font-semibold tabular-nums leading-tight text-red-600 dark:text-red-400">{brl(r.evitavel_rs)}</div>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">
              {pct(evitavelPct, 0)} do custo · mensagens picadas, “Você escolheu…”, resposta inválida da URA e lembretes do CSAT
            </div>
          </Painel>
          <Painel>
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Franquia em {mesAtual}</span>
            <div className="mt-2 grid gap-2.5">
              {numeros.length === 0 && <span className="text-xs text-muted-foreground">Nenhum número da API Oficial.</span>}
              {numeros.map((n) => {
                const uso = n.uso_franquia_pct ?? 0;
                const dentro = Math.min(100, uso);
                return (
                  <div key={n.instance_id}>
                    <div className="flex justify-between gap-2 text-[11.5px]">
                      <span className="truncate font-mono text-[11px]" title={n.nome}>{n.nome}</span>
                      <span className={cn("tabular-nums", uso > 100 && "font-semibold text-red-600 dark:text-red-400")}>
                        {num(n.enviadas_mes)} / {num(n.franquia)}
                      </span>
                    </div>
                    <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted" aria-label={`Uso da franquia: ${pct(uso, 0)}`}>
                      <i className="block h-full bg-emerald-500" style={{ width: `${uso > 100 ? (100 / uso) * 100 : dentro}%` }} />
                      {uso > 100 && <i className="block h-full bg-red-500" style={{ width: `${100 - (100 / uso) * 100}%` }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </Painel>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Painel>
            <Titulo dica="mensagens enviadas e R$ no período">Para onde vai o dinheiro</Titulo>
            <BarrasOrigem linhas={d.por_origem} />
            <LegendaOrigem />
          </Painel>
          <div className="grid min-w-0 gap-3">
            <Painel>
              <Titulo dica="R$ · fins de semana mais claros">Custo por dia</Titulo>
              <div className="h-[190px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serie} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={44} />
                    <RTooltip
                      cursor={{ fill: "hsl(var(--muted))" }}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, _n, p: any) => [`${brl(v)} · ${num(p?.payload?.enviadas)} msgs`, "Custo"]}
                      labelFormatter={(l) => l}
                    />
                    <Bar dataKey="custo_rs" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                      {serie.map((p) => <Cell key={p.dia} fill="#0EA5E9" fillOpacity={p.fds ? 0.35 : 1} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Painel>
            <Painel>
              <Titulo dica="economia estimada no período">Sugestões para a empresa</Titulo>
              <ListaSugestoes
                itens={d.sugestoes_gerais}
                vazio="Nenhuma automação gastando à toa neste período."
                acao={(s) => {
                  const alvo = { ura_botoes: "ura_menu", ura_confirmacao: "ura_confirmacao", csat_lembretes: "csat_cutucao", inatividade_dupla: "aviso_inatividade" }[s.codigo];
                  const cfg = alvo ? origemInfo(alvo).config : undefined;
                  return cfg ? <Link to={cfg.href} className="text-sky-600 hover:underline dark:text-sky-400">Configurar →</Link> : null;
                }}
              />
            </Painel>
          </div>
        </div>

        {/* Técnicos */}
        <Painel>
          <Titulo dica="clique no título para ordenar · passe o mouse nas sugestões">Técnicos</Titulo>
          <div className="-mx-3.5 overflow-x-auto px-3.5">
            <table className="w-full min-w-[960px] border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {COLUNAS.map((c) => (
                    <th key={c.k} className={cn("whitespace-nowrap border-b px-2 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground", c.k === "nome" ? "text-left" : "text-right")}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 uppercase hover:text-foreground"
                        onClick={() => setOrdem((o) => ({ k: c.k, dir: o.k === c.k && o.dir === "desc" ? "asc" : "desc" }))}
                      >
                        {c.rotulo}
                        {ordem.k === c.k && <span aria-hidden className="text-[9px]">{ordem.dir === "desc" ? "▾" : "▴"}</span>}
                      </button>
                    </th>
                  ))}
                  <th className="border-b px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Sugestões</th>
                </tr>
              </thead>
              <tbody>
                {tecnicos.length === 0 && (
                  <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">Nenhum técnico enviou mensagem pela API Oficial no período.</td></tr>
                )}
                {tecnicos.map((t) => <LinhaTecnico key={t.user_id} t={t} med={med} />)}
              </tbody>
            </table>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
            <span>Mediana do time: <b className="font-semibold text-foreground">{dec(med)} msgs por atendimento</b></span>
            <span><b className="font-semibold text-red-600 dark:text-red-400">vermelho</b> = acima de 30% de picadas ou 1,5× a mediana</span>
            <span>Picada = mensagem enviada até 60 s depois de outra do mesmo técnico, sem resposta do cliente no meio</span>
          </div>
        </Painel>

        {/* Automações */}
        <Painel>
          <Titulo dica="cada uma é uma mensagem cobrada">Mensagens automáticas</Titulo>
          <div className="-mx-3.5 overflow-x-auto px-3.5">
            <table className="w-full min-w-[680px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="border-b px-2 py-2 text-left font-medium">Automação</th>
                  <th className="border-b px-2 py-2 text-right font-medium">Enviadas</th>
                  <th className="border-b px-2 py-2 text-right font-medium">% do total</th>
                  <th className="border-b px-2 py-2 text-right font-medium">R$</th>
                  <th className="border-b px-2 py-2 text-left font-medium">O que fazer</th>
                  <th className="border-b px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {automacoes.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Nenhuma mensagem automática no período.</td></tr>}
                {automacoes.map((a) => {
                  const info = origemInfo(a.origem);
                  return (
                    <tr key={a.origem} className="hover:bg-muted/50">
                      <td className="border-b px-2 py-2 font-medium">{info.rotulo}</td>
                      <td className="border-b px-2 py-2 text-right tabular-nums">{num(a.qtd)}</td>
                      <td className="border-b px-2 py-2 text-right tabular-nums">{pct(a.pct)}</td>
                      <td className="border-b px-2 py-2 text-right tabular-nums">{brl(a.custo_rs)}</td>
                      <td className={cn("border-b px-2 py-2", !info.dica && "text-muted-foreground")}>{info.dica ?? "·"}</td>
                      <td className="border-b px-2 py-2 text-right">
                        {info.config && <Link to={info.config.href} className="whitespace-nowrap text-[11.5px] text-sky-600 hover:underline dark:text-sky-400">{info.config.rotulo} →</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Painel>
      </div>
    </TooltipProvider>
  );
}

function LinhaTecnico({ t, med }: { t: TecnicoCusto; med: number | null }) {
  const longo = med != null && t.atendimentos >= 10 && (t.msgs_por_atendimento ?? 0) > 1.5 * med;
  return (
    <tr className="hover:bg-muted/50">
      <td className="whitespace-nowrap border-b px-2 py-2 font-medium">{t.nome}</td>
      <td className="border-b px-2 py-2 text-right tabular-nums">{num(t.enviadas)}</td>
      <td className="border-b px-2 py-2 text-right tabular-nums">{num(t.atendimentos)}</td>
      <td className={cn("border-b px-2 py-2 text-right tabular-nums", longo && "font-semibold text-red-600 dark:text-red-400")}>{dec(t.msgs_por_atendimento)}</td>
      <td className={cn("border-b px-2 py-2 text-right tabular-nums", t.pct_rajada > 30 && "font-semibold text-red-600 dark:text-red-400")}>{pct(t.pct_rajada)}</td>
      <td className={cn("border-b px-2 py-2 text-right tabular-nums", t.pct_vazias > 5 && "font-semibold text-amber-600 dark:text-amber-400")}>{pct(t.pct_vazias)}</td>
      <td className="border-b px-2 py-2 text-right tabular-nums">{brl(t.custo_rs)}</td>
      <td className="border-b px-2 py-2 text-right tabular-nums">{brl(t.evitavel_rs)}</td>
      <td className="border-b px-2 py-2">
        <div className="flex flex-nowrap gap-1">
          {t.sugestoes.length === 0 && <span className="text-muted-foreground">·</span>}
          {t.sugestoes.map((s) => (
            <Tooltip key={s.codigo}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "cursor-help whitespace-nowrap rounded-full border bg-card px-2 py-0.5 text-[10.5px] font-medium",
                    s.severidade === "alta" ? "border-red-500 text-red-600 dark:text-red-400" : "border-amber-500 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {NOMES_SUG[s.codigo] ?? s.codigo}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-[11.5px] leading-snug">
                {s.texto} Economia: {brl(s.economia_rs)}.
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </td>
    </tr>
  );
}
