import { Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useWhatsappCostDashboard } from "@/components/whatsappCusto/useWhatsappCusto";
import { AvisoDoValor, BarraComMarca, BarrasOrigem, ListaSugestoes, SeloValor, CartaoCusto } from "@/components/whatsappCusto/CustoUi";
import { brl, dec, num, pct } from "@/components/whatsappCusto/whatsappCustoFormat";

/**
 * Sub-aba "WhatsApp Oficial" da Visão 360° do colaborador: o custo das
 * mensagens que ESTA pessoa digitou na API Oficial, contra a mediana do time
 * (sem nomes). Quem pode ver quem é a regra da própria 360°, aplicada de novo
 * no servidor (get_whatsapp_cost_dashboard com p_user_id).
 */
export function WhatsappOficialColaborador({ tenantId, userId, de, ate }: {
  tenantId: string | null; userId: string; de: Date; ate: Date;
}) {
  const q = useWhatsappCostDashboard({ tenantId, de, ate, userId });

  if (q.isLoading) {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if ((q.error as any)?.code === "42501") {
    return <p className="py-6 text-center text-sm text-muted-foreground">Você não tem acesso ao custo desta pessoa.</p>;
  }
  if (q.isError || !q.data) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Não foi possível carregar o custo agora.</p>;
  }

  const d = q.data;
  const eu = d.por_tecnico[0];
  const t = d.time;
  if (!eu || eu.enviadas === 0) {
    return (
      <div className="rounded-xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        Nenhuma mensagem digitada pela API Oficial neste período.
      </div>
    );
  }

  const digitadas = eu.enviadas;
  const acimaMed = (v: number | null, m: number | null | undefined) =>
    v != null && m ? Math.round(((v - m) / m) * 100) : null;
  const difMpa = acimaMed(eu.msgs_por_atendimento, t?.msgs_por_atendimento);
  const pos = d.posicao_enviadas;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <AvisoDoValor fonte={d.resumo.fonte} simulacao={d.simulacao} preco={d.resumo.preco_unitario} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoCusto
          rotulo="Mensagens enviadas"
          selo={<SeloValor fonte={d.resumo.fonte} simulacao={d.simulacao} />}
          valor={num(digitadas)}
          detalhe={<>{brl(eu.custo_rs)} no período</>}
          barra={<BarraComMarca valor={digitadas} marca={t?.enviadas ?? null} max={Math.max(digitadas, t?.enviadas ?? 0) * 1.15} />}
          rodape={[`time: ${num(t?.enviadas)}`, pos ? `${pos.posicao}º de ${pos.de}` : ""]}
        />
        <CartaoCusto
          rotulo="Mensagens picadas"
          valor={pct(eu.pct_rajada)}
          valorRuim={eu.pct_rajada > 30}
          detalhe={eu.pct_rajada > 30
            ? <><b className="text-red-600 dark:text-red-400">acima do limite de 30%</b> · {num(eu.rajadas)} mensagens</>
            : <>{num(eu.rajadas)} mensagens enviadas logo depois de outra</>}
          barra={<BarraComMarca valor={eu.pct_rajada} marca={t?.pct_rajada ?? null} max={50} ruim={eu.pct_rajada > 30} />}
          rodape={[`time: ${pct(t?.pct_rajada)}`, `economia: ${brl(eu.evitavel_rs)}`]}
        />
        <CartaoCusto
          rotulo="Msgs por atendimento"
          valor={dec(eu.msgs_por_atendimento)}
          valorRuim={difMpa != null && difMpa > 50}
          detalhe={difMpa == null ? `${num(eu.atendimentos)} atendimentos encerrados`
            : difMpa > 0 ? <><b className={difMpa > 50 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}>{difMpa}% acima</b> · {num(eu.atendimentos)} atendimentos</>
            : <><b className="text-emerald-600 dark:text-emerald-400">{Math.abs(difMpa)}% abaixo</b> · {num(eu.atendimentos)} atendimentos</>}
          barra={<BarraComMarca valor={eu.msgs_por_atendimento} marca={t?.msgs_por_atendimento ?? null}
            max={Math.max(eu.msgs_por_atendimento ?? 0, t?.msgs_por_atendimento ?? 0) * 1.25} ruim={difMpa != null && difMpa > 0} />}
          rodape={[`time: ${dec(t?.msgs_por_atendimento)}`, "mediana"]}
        />
        <CartaoCusto
          rotulo="Só “ok”, “entendi”"
          valor={pct(eu.pct_vazias)}
          valorRuim={eu.pct_vazias > 5}
          detalhe={eu.pct_vazias > 5
            ? <><b className="text-red-600 dark:text-red-400">acima do limite de 5%</b> · {num(eu.vazias)} mensagens</>
            : <>{num(eu.vazias)} mensagens sem informação nova</>}
          barra={<BarraComMarca valor={eu.pct_vazias} marca={5} max={10} ruim={eu.pct_vazias > 5} />}
          rodape={["limite: 5%", `time: ${pct(t?.pct_vazias)}`]}
        />
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="min-w-0 rounded-xl border bg-card p-3.5 shadow-sm">
          <div className="mb-3 text-xs font-semibold text-muted-foreground">Para onde vão as mensagens</div>
          <BarrasOrigem linhas={d.por_origem} agrupar={false} />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Pergunta do CSAT e “atendimento encerrado” saem com o nome da pessoa, mas são automáticas: não entram aqui.
          </p>
        </div>
        <div className="min-w-0 rounded-xl border bg-card p-3.5 shadow-sm">
          <div className="mb-3 text-xs font-semibold text-muted-foreground">Como melhorar</div>
          <ListaSugestoes
            itens={eu.sugestoes.map((s) => ({
              ...s,
              detalhe: s.codigo === "rajada" ? "Shift+Enter quebra a linha sem enviar." : s.codigo === "vazias" ? "Junte com a próxima informação." : undefined,
            }))}
            vazio="Nada a ajustar: as mensagens estão bem agrupadas."
          />
          <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />Comparação contra a mediana do time, sem mostrar o nome de ninguém.
          </div>
        </div>
      </div>
    </div>
  );
}

