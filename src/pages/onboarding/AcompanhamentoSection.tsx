import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import {
  useOnboardingIndicators,
  formatIndicatorValue,
  variacaoPct,
  type OnboardingIndicator,
} from "@/hooks/useOnboardingIndicators";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, TrendingUp, TrendingDown, Minus, Trash2 } from "lucide-react";

const COLETAS_QUERY_KEY = "onb-journey-indicators";

interface Coleta {
  id: string;
  indicator_id: string;
  data_ref: string;
  valor: string;
  observacao: string | null;
  origem: string;
}

function formatDataRef(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Minigráfico de linha. Sem biblioteca: são poucos pontos e o SVG é mais leve. */
function Sparkline({ valores }: { valores: number[] }) {
  if (valores.length < 2) return null;
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const span = max - min || 1;
  const pts = valores
    .map((v, i) => {
      const x = (i / (valores.length - 1)) * 96 + 2;
      const y = 26 - ((v - min) / span) * 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const subindo = valores[valores.length - 1] >= valores[0];
  return (
    <svg viewBox="0 0 100 30" className="w-full h-6 mt-1" preserveAspectRatio="none" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={subindo ? "#22C55E" : "#EF4444"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function AcompanhamentoSection({
  journeyId,
  ticketId,
  tenantId,
  readOnly,
}: {
  /** Dono do lançamento: jornada OU ticket de acompanhamento, nunca os dois. */
  journeyId?: string | null;
  ticketId?: string | null;
  tenantId: string | null;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  /** Espelha a coluna gerada `dono_id` do banco: COALESCE(journey_id, ticket_id). */
  const donoId = journeyId ?? ticketId ?? null;
  const [novaOpen, setNovaOpen] = useState(false);
  const [dataRef, setDataRef] = useState(hojeISO());
  const [valores, setValores] = useState<Record<string, string>>({});
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: indicadores = [], isLoading: loadingInd } = useOnboardingIndicators(tenantId, {
    somenteAtivos: true,
  });

  const coletasQ = useQuery({
    queryKey: [COLETAS_QUERY_KEY, donoId],
    enabled: !!donoId && !!tenantId,
    queryFn: async () =>
      fetchAllRows<Coleta>(() =>
        (supabase.from("onboarding_journey_indicators" as any) as any)
          .select("id, indicator_id, data_ref, valor, observacao, origem")
          .eq("tenant_id", tenantId)
          .eq("dono_id", donoId)
          .order("data_ref", { ascending: false }),
      ),
  });

  const coletas = coletasQ.data ?? [];

  /** Datas distintas, da mais recente para a mais antiga — são as linhas da planilha. */
  const datas = useMemo(
    () => Array.from(new Set(coletas.map((c) => c.data_ref))).sort((a, b) => b.localeCompare(a)),
    [coletas],
  );

  /** valor por (data, indicador) */
  const grade = useMemo(() => {
    const m = new Map<string, Coleta>();
    coletas.forEach((c) => m.set(`${c.data_ref}|${c.indicator_id}`, c));
    return m;
  }, [coletas]);

  /** Série cronológica de cada indicador, para o cartão e o minigráfico. */
  const serie = useMemo(() => {
    const m = new Map<string, Coleta[]>();
    coletas.forEach((c) => {
      const arr = m.get(c.indicator_id) ?? [];
      arr.push(c);
      m.set(c.indicator_id, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.data_ref.localeCompare(b.data_ref)));
    return m;
  }, [coletas]);

  function abrirNova() {
    setDataRef(hojeISO());
    setValores({});
    setObservacao("");
    setNovaOpen(true);
  }

  async function salvarColeta() {
    if (!donoId || !tenantId) return;
    const preenchidos = indicadores
      .map((ind) => ({ ind, valor: (valores[ind.id] ?? "").trim() }))
      .filter((x) => x.valor !== "");

    if (preenchidos.length === 0) {
      toast.error("Preencha ao menos um indicador.");
      return;
    }

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const linhas = preenchidos.map(({ ind, valor }) => ({
        tenant_id: tenantId,
        journey_id: journeyId ?? null,
        ticket_id: journeyId ? null : ticketId,
        indicator_id: ind.id,
        data_ref: dataRef,
        valor,
        observacao: observacao.trim() || null,
        origem: "manual",
        created_by: userData?.user?.id ?? null,
      }));

      // upsert: relançar a mesma data corrige o valor em vez de estourar a unique.
      // O alvo é a coluna gerada dono_id (COALESCE de jornada e ticket): índice único NÃO
      // parcial, porque o PostgREST não sabe declarar o predicado de um índice parcial aqui.
      const { error } = await (supabase.from("onboarding_journey_indicators" as any) as any)
        .upsert(linhas, { onConflict: "dono_id,indicator_id,data_ref" });
      if (error) throw error;

      toast.success(`Coleta de ${formatDataRef(dataRef)} registrada`);
      setNovaOpen(false);
      qc.invalidateQueries({ queryKey: [COLETAS_QUERY_KEY, donoId] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao registrar a coleta");
    } finally {
      setSaving(false);
    }
  }

  async function removerData(data: string) {
    if (!confirm(`Remover a coleta de ${formatDataRef(data)}? Todos os indicadores dessa data saem junto.`)) return;
    const { error } = await (supabase.from("onboarding_journey_indicators" as any) as any)
      .delete()
      .eq("dono_id", donoId)
      .eq("tenant_id", tenantId)
      .eq("data_ref", data);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Coleta removida");
    qc.invalidateQueries({ queryKey: [COLETAS_QUERY_KEY, donoId] });
  }

  if (loadingInd || coletasQ.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (indicadores.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-md">
        Nenhum indicador ativo. Cadastre em Configuração → Indicadores.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ---------- cartões: valor atual + variação + curva ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {indicadores.map((ind: OnboardingIndicator) => {
          const s = serie.get(ind.id) ?? [];
          const atual = s.length ? s[s.length - 1] : null;
          const anterior = s.length > 1 ? s[s.length - 2] : null;
          const varPct = atual && anterior ? variacaoPct(atual.valor, anterior.valor) : null;
          const numeros = s
            .map((c) => Number(c.valor))
            .filter((n) => Number.isFinite(n));
          const Icone = varPct == null ? Minus : varPct > 0 ? TrendingUp : varPct < 0 ? TrendingDown : Minus;
          const cor = varPct == null || varPct === 0 ? "text-muted-foreground" : varPct > 0 ? "text-[hsl(142_71%_45%)]" : "text-destructive";

          return (
            <div key={ind.id} className="rounded-md border border-border bg-card p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate" title={ind.nome}>
                {ind.nome}
              </div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-lg font-semibold tabular-nums">
                  {atual ? formatIndicatorValue(atual.valor, ind.tipo) : "—"}
                </span>
                {ind.unidade && ind.tipo === "numero" && (
                  <span className="text-[10px] text-muted-foreground">{ind.unidade}</span>
                )}
              </div>
              <div className={`flex items-center gap-1 text-[10px] ${cor}`}>
                <Icone className="h-3 w-3" />
                {varPct == null ? (
                  <span>{s.length < 2 ? "sem comparação" : "—"}</span>
                ) : (
                  <span>
                    {varPct > 0 ? "+" : ""}
                    {varPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. anterior
                  </span>
                )}
              </div>
              {numeros.length > 1 && ind.tipo !== "texto" && ind.tipo !== "booleano" && (
                <Sparkline valores={numeros} />
              )}
            </div>
          );
        })}
      </div>

      {/* ---------- planilha: uma linha por data ---------- */}
      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-medium text-[10px] uppercase tracking-wide text-muted-foreground px-2.5 py-2 whitespace-nowrap">
                Data
              </th>
              {indicadores.map((ind) => (
                <th
                  key={ind.id}
                  className="text-right font-medium text-[10px] uppercase tracking-wide text-muted-foreground px-2.5 py-2 whitespace-nowrap"
                >
                  {ind.nome}
                </th>
              ))}
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {datas.length === 0 ? (
              <tr>
                <td colSpan={indicadores.length + 2} className="text-center text-muted-foreground py-6 text-[11px]">
                  Nenhuma coleta lançada ainda.
                </td>
              </tr>
            ) : (
              datas.map((d) => {
                const obs = indicadores
                  .map((ind) => grade.get(`${d}|${ind.id}`)?.observacao)
                  .find(Boolean);
                return (
                  <tr key={d} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-2.5 py-1.5 whitespace-nowrap font-medium">
                      {formatDataRef(d)}
                      {obs && (
                        <span className="block text-[10px] text-muted-foreground font-normal truncate max-w-[180px]" title={obs}>
                          {obs}
                        </span>
                      )}
                    </td>
                    {indicadores.map((ind) => {
                      const c = grade.get(`${d}|${ind.id}`);
                      return (
                        <td key={ind.id} className="px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {c ? formatIndicatorValue(c.valor, ind.tipo) : "—"}
                        </td>
                      );
                    })}
                    {!readOnly && (
                      <td className="px-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removerData(d)}
                          title="Remover esta coleta"
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={abrirNova}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Nova coleta
        </Button>
      )}

      <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova coleta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Data da coleta</Label>
              <Input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value)} className="h-9" />
              <p className="text-[10px] text-muted-foreground">
                Data livre — não precisa ser fim de mês nem ter intervalo regular.
              </p>
            </div>

            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {indicadores.map((ind) => (
                <div key={ind.id} className="flex items-center gap-2">
                  <Label className="text-xs flex-1 truncate" title={ind.nome}>
                    {ind.nome}
                    {ind.unidade && <span className="text-muted-foreground"> ({ind.unidade})</span>}
                  </Label>
                  <Input
                    value={valores[ind.id] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [ind.id]: e.target.value }))}
                    inputMode={ind.tipo === "texto" ? "text" : "decimal"}
                    placeholder={ind.tipo === "booleano" ? "true / false" : ""}
                    className="h-8 w-32 text-right"
                  />
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Observação (opcional)</Label>
              <Textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={2}
                placeholder="Ex.: primeira semana após o treinamento"
                className="text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNovaOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={salvarColeta} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar coleta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
