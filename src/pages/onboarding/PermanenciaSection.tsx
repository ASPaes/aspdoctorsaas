import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { getRetentionColor } from "@/components/dashboard/retentionColor";
import PermanenciaDrilldown from "./PermanenciaDrilldown";
import {
  calcularPermanencia, MARCOS,
  type ClientePermanencia, type JourneyPermanencia, type TreinoPermanencia,
} from "./permanencia";
import type { JourneyNomes } from "./useJourneyNames";
import type { PeriodoResponsavel } from "./responsavelNaJanela";

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split("-");
  return `${MES_CURTO[Number(m) - 1]}/${y.slice(2)}`;
};

/**
 * Quantos dos clientes entregues continuam na base — a coorte que um tenant usa
 * para remunerar o implantador pelos clientes vivos 180 dias após a entrega.
 *
 * A janela de coortes é SEPARADA do filtro de data do topo de propósito: o topo
 * abre no mês corrente e a matriz sairia com uma linha só, que não é coorte
 * nenhuma. Os filtros de unidade, pipeline e responsável continuam valendo,
 * porque `journeys` já chega recortado por eles.
 */
export default function PermanenciaSection({
  journeys, treinos, tenantId, nomes, periodosResponsavel, nomePorUsuario, recorteResponsavelExato,
}: {
  journeys: JourneyPermanencia[];
  /** Já carregados pela página (`trainingsAllQ`). É deles que sai o implantador. */
  treinos: TreinoPermanencia[];
  tenantId: string | null;
  nomes: JourneyNomes;
  periodosResponsavel: Record<string, PeriodoResponsavel[]>;
  nomePorUsuario: Record<string, string>;
  /** Vem do hook de filtros da página. Sem filtro ativo, devolve `true` para tudo. */
  recorteResponsavelExato?: (userId: string | null) => boolean;
}) {
  const [mesesJanela, setMesesJanela] = useState<3 | 6 | 12>(12);
  const [tipoTreinoId, setTipoTreinoId] = useState<string>("todos");
  const [drill, setDrill] = useState<{ titulo: string; regra: string; linhas: ClientePermanencia[] } | null>(null);

  /** As jornadas que entram na coorte — é contra elas que o seletor de tipo se limita. */
  const journeyIdsDaCoorte = useMemo(
    () =>
      new Set(
        journeys
          .filter((j) => j.situacao === "concluido" && j.cliente_id)
          .map((j) => j.journey_id),
      ),
    [journeys],
  );

  /** Tipos que existem nos treinos DESTAS jornadas — não o catálogo inteiro do tenant.
   *  `treinos` chega da página sem recorte de unidade/pipeline/responsável; sem este
   *  cruzamento o seletor ofereceria tipo que devolve coorte vazia. */
  const tiposDisponiveis = useMemo(() => {
    const m = new Map<string, string>();
    treinos.forEach((t) => {
      if (!t.journey_id || !journeyIdsDaCoorte.has(t.journey_id)) return;
      if (t.training_type_id && t.tipo_nome) m.set(t.training_type_id, t.tipo_nome);
    });
    return Array.from(m.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [treinos, journeyIdsDaCoorte]);

  /** Só quem tem cancelamento registrado. Cliente ausente da resposta = ainda na base.
   *  Buscar por `.in("id", ...)` fazia a URL crescer com a coorte e estourar o gateway. */
  const cancelamentosQ = useQuery({
    queryKey: ["onb-permanencia-cancelamentos", tenantId],
    enabled: !!tenantId,
    queryFn: async () =>
      fetchAllRows<{ id: string; data_cancelamento: string | null }>(() =>
        (supabase.from("clientes" as any) as any)
          .select("id, data_cancelamento")
          .eq("tenant_id", tenantId)
          .not("data_cancelamento", "is", null),
      ),
  });

  const resultado = useMemo(() => {
    const cancelamentoPorCliente: Record<string, string | null> = {};
    (cancelamentosQ.data ?? []).forEach((c) => {
      cancelamentoPorCliente[c.id] = c.data_cancelamento;
    });
    return calcularPermanencia({
      journeys,
      cancelamentoPorCliente,
      periodosResponsavel,
      treinos,
      tipoTreinoId: tipoTreinoId === "todos" ? null : tipoTreinoId,
      hoje: new Date(),
      mesesJanela,
      filtroImplantador: recorteResponsavelExato,
    });
  }, [
    journeys, cancelamentosQ.data, periodosResponsavel, treinos, tipoTreinoId, mesesJanela,
    recorteResponsavelExato,
  ]);

  const nomeImplantador = (userId: string | null) => (userId ? nomePorUsuario[userId] ?? "—" : "—");
  const nomeCliente = (journeyId: string) => nomes.cliente(journeyId);

  const totalSaidas = resultado.faixas.reduce((s, f) => s + f.clientes.length, 0);
  const semTreino = resultado.clientes.filter((c) => c.origem === "jornada").length;
  const carregando = cancelamentosQ.isLoading;
  const erro = cancelamentosQ.isError;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Permanência pós-implantação
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Quantos dos clientes entregues continuam na base. M6 é o marco de 180 dias.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={tipoTreinoId} onValueChange={setTipoTreinoId}>
            <SelectTrigger className="w-[190px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos de treino</SelectItem>
              {tiposDisponiveis.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(mesesJanela)} onValueChange={(v) => setMesesJanela(Number(v) as 3 | 6 | 12)}>
            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Últimos 12 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {carregando ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : erro ? (
        <div className="rounded-lg border border-destructive/40 bg-card p-6 text-center">
          <p className="text-sm font-medium">Não foi possível carregar os cancelamentos.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Sem esse dado a permanência não pode ser calculada — o número seria 100% para todo mundo.
          </p>
        </div>
      ) : resultado.clientes.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm font-medium">Nenhuma implantação concluída nesta janela.</p>
          <p className="text-xs text-muted-foreground mt-1">
            A coorte começa a existir quando a primeira jornada é concluída.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Bloco 1 — matriz M0..M6 */}
          <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-0.5">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pr-3">Entrega</th>
                  <th className="text-right font-medium pr-3">Clientes</th>
                  {MARCOS.map((m) => (
                    <th key={m} className={`text-center font-medium ${m === 6 ? "text-foreground" : ""}`}>
                      M{m}
                      {m === 6 && <span className="block text-[10px] font-normal">180 dias</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultado.coortes.map((c) => {
                  const daCoorte = resultado.clientes.filter((x) => x.coorte === c.mes);
                  return (
                    <tr key={c.mes}>
                      <td className="pr-3 font-medium whitespace-nowrap">{rotuloMes(c.mes)}</td>
                      <td className="pr-3 text-right tabular-nums text-muted-foreground">{c.tamanho}</td>
                      {MARCOS.map((m) => {
                        const v = c.celulas[m];
                        if (v == null) {
                          return (
                            <td
                              key={m}
                              className="text-center text-muted-foreground/50 rounded"
                              title={`A turma de ${rotuloMes(c.mes)} ainda não chegou a M${m}.`}
                            >
                              —
                            </td>
                          );
                        }
                        return (
                          <td
                            key={m}
                            className={`text-center rounded py-1 cursor-pointer tabular-nums ${getRetentionColor(v)}`}
                            onClick={() =>
                              setDrill({
                                titulo: `${rotuloMes(c.mes)} · M${m}`,
                                regra:
                                  m === 0
                                    ? `${c.tamanho} clientes entregues em ${rotuloMes(c.mes)}; ${c.saidas[m]} já haviam saído no momento da entrega.`
                                    : `${c.tamanho} clientes entregues em ${rotuloMes(c.mes)}; ${c.saidas[m]} já haviam saído ${m} ${m === 1 ? "mês" : "meses"} depois da própria entrega.`,
                                linhas: daCoorte,
                              })
                            }
                          >
                            {v}%
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground mt-2">
              "—" é coorte que ainda não alcançou o marco — não é 100%.
            </p>
            {/* A coluna "Clientes" é a mitigação do risco de coorte pequena (§10 do
                spec): "1 de 1 saiu" e "50 de 50 saíram" leem 0% igual, e sem o `n`
                ao lado a Consysa (3 jornadas) viraria percentual sem sentido. */}
            {tipoTreinoId !== "todos" ? (
              <p className="text-[11px] text-muted-foreground mt-1">
                Recorte por tipo de treino: só entram clientes que passaram por este treino, e o
                crédito é de quem o conduziu.
              </p>
            ) : semTreino > 0 ? (
              <p className="text-[11px] text-muted-foreground mt-1">
                {semTreino} {semTreino === 1 ? "cliente foi creditado" : "clientes foram creditados"} ao
                responsável da jornada, por não ter treino registrado.
              </p>
            ) : null}
          </div>

          {/* Bloco 2 — faixa de dias até a saída */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-medium mb-3">
              Quando saíram · {totalSaidas} {totalSaidas === 1 ? "saída" : "saídas"} até 180 dias
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {resultado.faixas.map((f) => (
                <button
                  key={f.rotulo}
                  type="button"
                  disabled={f.clientes.length === 0}
                  onClick={() =>
                    setDrill({
                      titulo: `Saíram em ${f.rotulo}`,
                      regra: `Clientes cujo cancelamento caiu nessa distância da própria entrega.`,
                      linhas: f.clientes,
                    })
                  }
                  className="rounded-lg border border-border p-3 text-left transition-colors enabled:hover:border-foreground/30 enabled:hover:bg-muted/20 disabled:opacity-60"
                >
                  <p className="text-[11px] text-muted-foreground">{f.rotulo}</p>
                  <p className="text-xl font-semibold tabular-nums">{f.clientes.length}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Bloco 3 — implantador x permanência */}
          <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
            <h3 className="text-xs font-medium mb-3">Implantador × permanência</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 font-medium">Implantador</th>
                  <th className="py-2 font-medium text-right">Entregues</th>
                  <th className="py-2 font-medium text-right">Saíram (total)</th>
                  <th className="py-2 font-medium text-right">Dias médios</th>
                  <th className="py-2 font-medium text-right">% em M6</th>
                </tr>
              </thead>
              <tbody>
                {resultado.porImplantador.map((l) => (
                  <tr
                    key={l.userId ?? "sem"}
                    className="border-b border-border/50 cursor-pointer hover:bg-muted/20"
                    onClick={() =>
                      setDrill({
                        titulo: nomeImplantador(l.userId),
                        regra: `Clientes entregues por esta pessoa. O crédito é de quem conduziu o primeiro treino da jornada; sem treino registrado, do responsável no momento da conclusão.`,
                        linhas: l.clientes,
                      })
                    }
                  >
                    <td className="py-2">{nomeImplantador(l.userId)}</td>
                    <td className="py-2 text-right tabular-nums">{l.entregues}</td>
                    <td className="py-2 text-right tabular-nums">{l.saidas}</td>
                    <td className="py-2 text-right tabular-nums">{l.diasMedio ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      {l.pctM6 == null ? (
                        <span className="text-muted-foreground" title="Nenhuma entrega desta pessoa completou 180 dias.">—</span>
                      ) : (
                        `${l.pctM6}%`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {resultado.porImplantador.length > 0 &&
              resultado.porImplantador.every((l) => l.pctM6 == null) && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Nenhuma entrega completou 180 dias ainda — a coluna "% em M6" fica vazia até a
                  primeira turma alcançar o marco.
                </p>
              )}
          </div>

          {resultado.inconsistentes.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setDrill({
                  titulo: "Cadastro a conferir",
                  regra: "Clientes cuja data de cancelamento é anterior à própria entrega. Ficam fora da conta: não são retenção nem saída.",
                  linhas: resultado.inconsistentes,
                })
              }
              className="flex items-center gap-2 text-[11px] text-[hsl(38_92%_50%)] hover:underline"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {resultado.inconsistentes.length}{" "}
              {resultado.inconsistentes.length === 1 ? "cliente consta cancelado" : "clientes constam cancelados"}{" "}
              antes da própria entrega — fora da conta
            </button>
          )}
        </div>
      )}

      <PermanenciaDrilldown
        open={drill !== null}
        onOpenChange={(v) => !v && setDrill(null)}
        titulo={drill?.titulo ?? ""}
        regra={drill?.regra ?? ""}
        linhas={drill?.linhas ?? []}
        nomeCliente={nomeCliente}
        nomeImplantador={nomeImplantador}
      />
    </section>
  );
}
