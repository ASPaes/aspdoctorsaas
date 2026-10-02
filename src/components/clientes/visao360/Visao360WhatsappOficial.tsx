import { Skeleton } from "@/components/ui/skeleton";
import { useWhatsappCostCliente } from "@/components/whatsappCusto/useWhatsappCusto";
import { AvisoDoValor, BarraComMarca, BarrasOrigem, SeloValor, CartaoCusto } from "@/components/whatsappCusto/CustoUi";
import { brl, dec, num, pct } from "@/components/whatsappCusto/whatsappCustoFormat";

/**
 * Sub-aba "WhatsApp Oficial" da Visão 360° do cliente: quanto este cliente
 * custa em mensagens da API Oficial, quanto isso pesa na mensalidade e quem
 * mais escreveu para ele. Mensagem é do cliente do atendimento (ou do contato,
 * quando o atendimento não tem cliente). Exige a permissão
 * painel_uso.custo_whatsapp — conferida de novo no servidor.
 */
export function Visao360WhatsappOficial({ clienteId, de, ate, mrrAtual }: {
  clienteId: string; de: Date | undefined; ate: Date | undefined; mrrAtual: number;
}) {
  const q = useWhatsappCostCliente(clienteId, de, ate);

  if (q.isLoading) {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if ((q.error as any)?.code === "42501") {
    return <p className="py-6 text-center text-sm text-muted-foreground">Você não tem acesso ao custo do WhatsApp Oficial.</p>;
  }
  if (q.isError || !q.data) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Não foi possível carregar o custo agora.</p>;
  }

  const d = q.data;
  const r = d.resumo;
  if (r.enviadas === 0) {
    return (
      <div className="rounded-xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        Nenhuma mensagem enviada a este cliente pela API Oficial neste período.
      </div>
    );
  }

  const dias = Math.max(1, Math.round(((ate ?? new Date()).getTime() - (de ?? new Date(d.periodo.de)).getTime()) / 86_400_000) + 1);
  const custoMes = (r.custo_rs / dias) * 30;
  const peso = mrrAtual > 0 ? (custoMes / mrrAtual) * 100 : null;
  const med = r.mediana_clientes_msgs_por_atendimento;
  const vezes = r.msgs_por_atendimento != null && med ? r.msgs_por_atendimento / med : null;
  const maxTec = Math.max(1, ...d.por_tecnico.map((t) => t.enviadas));
  const topTec = d.por_tecnico.slice(0, 4);
  const resto = d.por_tecnico.slice(4);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <AvisoDoValor fonte={r.fonte} simulacao={d.simulacao} preco={r.preco_unitario} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoCusto
          rotulo="Custo do cliente"
          selo={<SeloValor fonte={r.fonte} simulacao={d.simulacao} />}
          valor={brl(r.custo_rs)}
          detalhe={`${num(r.enviadas)} mensagens enviadas a ele`}
          barra={null}
          rodape={[r.custo_por_atendimento != null ? `${brl(r.custo_por_atendimento)}/atend.` : "sem atendimento", `${num(r.atendimentos)} atend.`]}
        />
        <CartaoCusto
          rotulo="Peso na mensalidade"
          valor={peso != null ? pct(peso) : "—"}
          valorRuim={peso != null && peso > 5}
          detalhe={peso != null ? <>do MRR de {brl(mrrAtual)} vai em mensagens</> : "sem mensalidade cadastrada"}
          barra={peso != null ? <BarraComMarca valor={peso} marca={null} max={10} ruim={peso > 5} /> : null}
          rodape={[peso != null ? "até 10%" : "", `${brl(custoMes)}/mês`]}
        />
        <CartaoCusto
          rotulo="Msgs por atendimento"
          valor={dec(r.msgs_por_atendimento)}
          valorRuim={vezes != null && vezes > 1.5}
          detalhe={vezes == null ? "—"
            : vezes > 1.05 ? <><b className={vezes > 1.5 ? "text-red-600 dark:text-red-400" : undefined}>{dec(vezes)}× a mediana dos clientes</b></>
            : <>perto da mediana dos clientes</>}
          barra={<BarraComMarca valor={r.msgs_por_atendimento} marca={med} max={Math.max(r.msgs_por_atendimento ?? 0, med ?? 0) * 1.25} ruim={vezes != null && vezes > 1.5} />}
          rodape={[`mediana ${dec(med)}`, r.posicao_enviadas ? `${r.posicao_enviadas}º de ${num(r.n_clientes)}` : ""]}
        />
        <CartaoCusto
          rotulo="Mensagens picadas"
          valor={pct(r.pct_rajada)}
          valorRuim={r.pct_rajada > 30}
          detalhe={`${num(r.rajadas)} mensagens · economia ${brl(r.economia_rajada_rs)}`}
          barra={<BarraComMarca valor={r.pct_rajada} marca={30} max={50} ruim={r.pct_rajada > 30} />}
          rodape={["limite 30%", "das digitadas"]}
        />
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="min-w-0 rounded-xl border bg-card p-3.5">
          <div className="mb-3 text-xs font-semibold text-muted-foreground">Para onde vão as mensagens deste cliente</div>
          <BarrasOrigem linhas={d.por_origem} agrupar={false} />
        </div>
        <div className="min-w-0 rounded-xl border bg-card p-3.5">
          <div className="mb-3 flex items-baseline justify-between gap-2 text-xs font-semibold text-muted-foreground">
            Quem mais escreveu para ele<span className="font-normal">mensagens digitadas</span>
          </div>
          {d.por_tecnico.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-muted-foreground">Só mensagens automáticas no período.</p>
          ) : (
            <div className="grid gap-2">
              {[...topTec, ...(resto.length ? [{
                user_id: "outros", nome: `Outras ${resto.length} pessoa${resto.length === 1 ? "" : "s"}`,
                enviadas: resto.reduce((s, t) => s + t.enviadas, 0), pct: resto.reduce((s, t) => s + t.pct, 0),
              }] : [])].map((t) => (
                <div key={t.user_id} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_64px] items-center gap-3 text-[12.5px]">
                  <span className="truncate" title={t.nome}>{t.nome}</span>
                  <div className="h-3.5 overflow-hidden rounded bg-muted"><i className="block h-full rounded bg-slate-500" style={{ width: `${(t.enviadas / maxTec) * 100}%` }} /></div>
                  <span className="text-right tabular-nums">{num(t.enviadas)}<small className="block text-[10.5px] text-muted-foreground">{pct(t.pct, 0)}</small></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

