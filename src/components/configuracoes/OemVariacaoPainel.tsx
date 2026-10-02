// O "por que o custo mudou" da linha de divergência de custo (DEM-0517). A
// conta mora em `oemVariacao.ts`; aqui é só a tela.
import { ArrowDown, ArrowUp, CheckCircle2, Loader2, Percent, Activity } from "lucide-react";
import {
  nomeDoMes, type Explicacao, type EventoExplicado, type TipoEvento,
} from "./oemVariacao";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const sinal = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${brl(Math.abs(v))}`;
const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : null);

// As cores são as mesmas em toda a aba: verde entra dinheiro, vermelho sai,
// azul é preço mudando sem venda. Âmbar fica para "falta na ficha", que é o
// alerta, e não para um tipo de evento.
const TIPO: Record<TipoEvento, { rotulo: string; Icone: typeof ArrowUp; cls: string }> = {
  upsell: {
    rotulo: "Up-Sell", Icone: ArrowUp,
    cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  downsell: {
    rotulo: "Down-Sell", Icone: ArrowDown,
    cls: "border-red-600/40 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  reajuste: {
    rotulo: "Reajuste Tablet Cloud", Icone: Percent,
    cls: "border-sky-600/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  consumo: {
    rotulo: "Consumo", Icone: Activity,
    cls: "border-border bg-muted text-muted-foreground",
  },
};

export function SeloTipo({ tipo, n }: { tipo: TipoEvento; n?: number }) {
  const t = TIPO[tipo];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${t.cls}`}>
      <t.Icone className="h-3 w-3" />
      {t.rotulo}{n && n > 1 ? ` ${n}` : ""}
    </span>
  );
}

/** Os selos da linha recolhida do cliente: o que mudou no mês, de relance. */
export function SelosVariacao({ contagem }: { contagem: Record<TipoEvento, number> }) {
  const tipos = (Object.keys(contagem) as TipoEvento[]).filter((t) => contagem[t] > 0);
  if (!tipos.length) return null;
  return <>{tipos.map((t) => <SeloTipo key={t} tipo={t} n={contagem[t]} />)}</>;
}

function quantidade(e: EventoExplicado) {
  if (e.qtdAntes === e.qtdDepois) return e.qtdDepois > 1 ? ` · ${e.qtdDepois} un.` : "";
  return ` · ${e.qtdAntes} → ${e.qtdDepois} un.`;
}

function LinhaEvento({ e, mostrarFilial }: { e: EventoExplicado; mostrarFilial: boolean }) {
  const ativado = e.tipo === "upsell" && e.qtdAntes === 0 ? dataBR(e.dataAtivacao) : null;
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-0.5 border-b px-3 py-2 last:border-b-0">
      <SeloTipo tipo={e.tipo} />
      <p className="min-w-0 text-sm">
        <span className="font-medium">{e.modulo}</span>
        <span className="text-muted-foreground">
          {quantidade(e)} · {brl(e.valorAntes)} → {brl(e.valorDepois)}
          {ativado && <> · ativado em {ativado}</>}
          {mostrarFilial && <> · filial {e.filial}</>}
        </span>
      </p>
      <span className={`whitespace-nowrap text-right text-sm font-semibold tabular-nums ${e.faltaNaFicha ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {sinal(e.delta)}
      </span>
      <div className="col-start-2 col-end-4 text-xs text-muted-foreground">
        {e.faltaNaFicha
          ? <span className="font-medium text-amber-600 dark:text-amber-400">Falta na ficha. </span>
          : <span className="text-emerald-600 dark:text-emerald-500">Já está na ficha. </span>}
        {e.movimento
          ? <>No DS: {e.movimento.tipo.replace("_", " ")} em {dataBR(e.movimento.data_movimento)}
              {e.faltaNaFicha && Number(e.movimento.custo_delta ?? 0) === 0 && <>, lançado com custo {brl(0)}</>}
              {e.movimento.descricao && <> ("{e.movimento.descricao.trim().slice(0, 80)}{e.movimento.descricao.trim().length > 80 ? "…" : ""}")</>}.</>
          : e.tipo === "reajuste" || e.tipo === "consumo"
            ? null
            : <>Sem lançamento no DS.</>}
      </div>
    </div>
  );
}

export default function OemVariacaoPainel({
  explicacao, competencia, diferenca, custoDs, custoOem, filiais, carregando, erro,
}: {
  explicacao: Explicacao | null;
  competencia: string | null;
  /** OEM menos ficha. */
  diferenca: number;
  custoDs: number;
  custoOem: number;
  filiais: string[];
  carregando: boolean;
  erro: string | null;
}) {
  if (carregando) {
    return (
      <div className="ml-10 mr-3 mb-3 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando o faturamento do OEM…
      </div>
    );
  }
  if (erro || !explicacao || !competencia) {
    return erro ? (
      <div className="ml-10 mr-3 mb-3 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
        Não deu para consultar o que mudou no OEM: {erro}
      </div>
    ) : null;
  }

  const mes = nomeDoMes(competencia);
  const { eventos, explicado, movimentosSemPar } = explicacao;
  const fecha = explicado != null;

  return (
    <div className="ml-10 mr-3 mb-3 overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          O que mudou no OEM em {mes}
        </span>
        {eventos.length > 0 && (
          <span className={`text-xs font-medium ${fecha ? "text-emerald-600 dark:text-emerald-500" : "text-amber-600 dark:text-amber-400"}`}>
            {fecha
              ? `Diferença explicada: ${brl(Math.abs(explicado!))} de ${brl(Math.abs(diferenca))}`
              : "As mudanças do mês não fecham a diferença"}
          </span>
        )}
      </div>

      {eventos.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          Nenhuma mudança no faturamento desta licença em {mes}: sem Up-Sell, Down-Sell ou Reajuste Tablet Cloud.
          A diferença vem de antes. Confira a ficha antes de ajustar.
        </p>
      ) : (
        eventos.map((e) => <LinhaEvento key={`${e.filial}:${e.codigo}:${e.tipo}`} e={e} mostrarFilial={filiais.length > 1} />)
      )}

      {movimentosSemPar.length > 0 && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Lançado no DS no período, sem mudança no OEM: </span>
          {movimentosSemPar.map((m, i) => (
            <span key={m.id}>
              {i > 0 && " · "}
              {m.tipo.replace("_", " ")} em {dataBR(m.data_movimento)}
              {m.descricao && <> ("{m.descricao.trim().slice(0, 60)}{m.descricao.trim().length > 60 ? "…" : ""}")</>}
            </span>
          ))}
        </div>
      )}

      {eventos.length > 0 && (
        fecha ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-emerald-500/5 px-3 py-2 text-xs tabular-nums">
            <span>ficha {brl(custoDs)} {explicado! >= 0 ? "+" : "−"} {brl(Math.abs(explicado!))} = <strong>{brl(custoOem)}</strong></span>
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" /> fecha com o OEM: ajustar o custo é seguro
            </span>
          </div>
        ) : (
          <div className="border-t bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Nenhuma combinação das mudanças de {mes} dá os {brl(Math.abs(diferenca))} de diferença: parte dela vem de antes. Confira a ficha antes de ajustar.
          </div>
        )
      )}
    </div>
  );
}
