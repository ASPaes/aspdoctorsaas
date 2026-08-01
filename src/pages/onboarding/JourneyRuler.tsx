import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatMinUtil } from "./slaFormat";

/**
 * Régua da Jornada: o trilho inteiro (Onboarding → Implantação → Acompanhamento) com o
 * PLANO em cima e o REALIZADO embaixo, ambos com largura proporcional ao tempo. O número
 * "6d de 8d" diz que estourou; a régua diz ONDE.
 *
 * Uma linha por ETAPA, nunca por passagem: em produção há jornadas que passaram 3x pela
 * mesma etapa. A agregação vem pronta de `get_journey_ruler` — o cliente não recalcula
 * horário útil, senão diverge do resto do sistema.
 */
export type RulerStage = {
  stage_id: string;
  nome: string;
  fase: string;
  ordem: number;
  plano_min: number;
  real_min: number;
  passagens: number;
  aberta: boolean;
  inicia: boolean;
  encerra: boolean;
  fora_janela: boolean;
};

/** Largura mínima em % para uma etapa curta continuar visível e clicável. */
const MIN_PCT = 3;

/** Espaço entre segmentos, em px. Precisa bater com o `gap-0.5` do Tailwind. */
const GAP_PX = 2;

/**
 * Largura do segmento já descontando o gap.
 *
 * As porcentagens somam 100%, e os segmentos são `shrink-0`. Sem descontar, os (n-1)
 * gaps entram POR CIMA dos 100% e a régua vaza para fora do diálogo — com 9 etapas são
 * ~16px de estouro, o suficiente para cortar as últimas etapas.
 */
function estiloSegmento(pct: number, n: number): { width: string } {
  const desconto = n > 1 ? (GAP_PX * (n - 1)) / n : 0;
  return { width: `calc(${pct}% - ${desconto}px)` };
}

export function semaforo(plano: number, real: number): "verde" | "amarelo" | "vermelho" | "sem_sla" {
  if (!plano) return "sem_sla";
  if (real >= plano) return "vermelho";
  if (real >= plano * 0.7) return "amarelo";
  return "verde";
}

const COR: Record<string, string> = {
  verde: "bg-emerald-500",
  amarelo: "bg-amber-500",
  vermelho: "bg-rose-500",
  sem_sla: "bg-muted-foreground/40",
};

/**
 * A etapa que mais estourou o plano, em minutos absolutos.
 *
 * Absoluto e não proporcional de propósito: uma etapa de 10 min que levou 60 é 6x o
 * plano, mas custou 50 minutos da jornada — não é ela que explica o atraso. Quem
 * explica é a que comeu mais tempo a mais do que devia.
 *
 * Etapa sem plano fica fora: não há contra o que estourar.
 */
export function piorEtapa(etapas: RulerStage[]): RulerStage | null {
  const estouradas = etapas.filter((e) => e.plano_min > 0 && e.real_min > e.plano_min);
  if (!estouradas.length) return null;
  return estouradas.reduce((pior, e) =>
    e.real_min - e.plano_min > pior.real_min - pior.plano_min ? e : pior,
  );
}

/**
 * Distribui 100% entre os segmentos, garantindo MIN_PCT a cada um — sem o piso, uma
 * etapa de 2h ao lado de uma de 28h vira um traço de 0,3% que ninguém acerta com o mouse.
 */
export function larguras(valores: number[]): number[] {
  if (!valores.length) return [];
  const n = valores.length;
  const total = valores.reduce((a, b) => a + b, 0);

  // O piso é RESERVADO antes de distribuir, não aplicado depois. Aplicar depois e
  // renormalizar empurra o segmento pequeno de volta para baixo do mínimo — com
  // [1, 10000] o piso de 3% virava 2,9% e a etapa sumia de novo.
  const reserva = Math.min(MIN_PCT * n, 100);
  const resto = 100 - reserva;
  const base = reserva / n;

  if (total <= 0) return valores.map(() => 100 / n);
  return valores.map((v) => base + (v / total) * resto);
}

export function JourneyRuler({
  journeyId,
  open,
  onOpenChange,
}: {
  journeyId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: etapas = [], isLoading } = useQuery({
    queryKey: ["journey-ruler", journeyId],
    // Só busca no clique: a régua não pode encarecer o kanban nem entrar em polling.
    enabled: open && !!journeyId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_journey_ruler", {
        p_journey_id: journeyId,
      });
      if (error) throw error;
      return (data ?? []) as RulerStage[];
    },
  });

  const janela = useMemo(() => etapas.filter((e) => !e.fora_janela), [etapas]);
  const fora = useMemo(() => etapas.filter((e) => e.fora_janela), [etapas]);
  const totalPlano = janela.reduce((a, e) => a + e.plano_min, 0);
  const totalReal = janela.reduce((a, e) => a + e.real_min, 0);
  const wPlano = useMemo(() => larguras(janela.map((e) => e.plano_min)), [janela]);
  const wReal = useMemo(() => larguras(janela.map((e) => e.real_min)), [janela]);
  const pior = useMemo(() => piorEtapa(janela), [janela]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Régua da jornada</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : !janela.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Esta jornada ainda não tem etapa na janela contada.
          </p>
        ) : (
          <TooltipProvider delayDuration={150}>
            <div className="space-y-7 py-2">
              <Linha
                titulo="Plano"
                linha="plano"
                total={totalPlano}
                etapas={janela}
                ws={wPlano}
                corFixa="bg-muted-foreground/40"
              />
              <Linha
                titulo="Real"
                linha="real"
                total={totalReal}
                etapas={janela}
                ws={wReal}
                corFixa={null}
              />

              {/* Leitura: sem isto o usuário tem que garimpar a barra para achar o culpado. */}
              <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                {pior ? (
                  <p className="text-[11px] leading-relaxed">
                    <span className="text-muted-foreground">O que salta: </span>
                    <strong className="font-semibold">{pior.nome}</strong>
                    <span className="text-muted-foreground">
                      {" "}levou{" "}
                    </span>
                    <span className="font-mono text-rose-400">{formatMinUtil(pior.real_min)}</span>
                    <span className="text-muted-foreground"> contra </span>
                    <span className="font-mono">{formatMinUtil(pior.plano_min)}</span>
                    <span className="text-muted-foreground"> de plano</span>
                    {pior.passagens > 1 && (
                      <span className="text-muted-foreground">, em {pior.passagens} passagens</span>
                    )}
                    <span className="text-muted-foreground">.</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Nenhuma etapa estourou o plano até aqui.
                  </p>
                )}

                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-emerald-500" />abaixo de 70% do plano
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-amber-500" />a partir de 70%
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-rose-500" />estourou
                  </span>
                  <span>·</span>
                  <span>×N = passagens repetidas pela mesma etapa</span>
                </p>
              </div>

              {fora.length > 0 && (
                <div className="space-y-1.5 border-t border-border/60 pt-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    fora da contagem
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {fora.map((e) => (
                      <span
                        key={e.stage_id}
                        data-ruler-stage={e.stage_id}
                        data-linha="fora"
                        data-fora-janela="true"
                        data-passagens={e.passagens}
                        data-semaforo="sem_sla"
                        className="rounded border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {e.nome}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TooltipProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Linha({
  titulo,
  linha,
  total,
  etapas,
  ws,
  corFixa,
}: {
  titulo: string;
  linha: "plano" | "real";
  total: number;
  etapas: RulerStage[];
  ws: number[];
  corFixa: string | null;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{titulo}</span>
        <span className="font-mono text-xs font-semibold">{formatMinUtil(total)}</span>
      </div>

      {/*
        Os nós ficam FORA do trilho de segmentos. Eles têm largura fixa (12px cada) e,
        somados às larguras percentuais, estouravam o diálogo pela direita — os dois nós
        mais os gaps passavam de 100%. O wrapper `flex-1 min-w-0` dá aos segmentos
        exatamente o espaço que sobra, e os rótulos herdam a mesma caixa, o que também
        conserta o alinhamento entre rótulo e barra.
      */}
      <div className="flex items-start gap-1">
        <span
          className="h-3 w-3 shrink-0 rounded-full bg-foreground"
          aria-label="início da contagem"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-0.5">
            {etapas.map((e, i) => {
          const sem = semaforo(e.plano_min, e.real_min);
          return (
            <Tooltip key={e.stage_id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ruler-stage={e.stage_id}
                  data-linha={linha}
                  data-passagens={e.passagens}
                  data-semaforo={sem}
                  data-fora-janela="false"
                  style={estiloSegmento(ws[i], etapas.length)}
                  className={cn(
                    "relative h-3 shrink-0 rounded-sm transition-all hover:brightness-110",
                    corFixa ?? COR[sem],
                    linha === "real" && e.aberta && "animate-pulse",
                  )}
                >
                  {linha === "real" && e.passagens > 1 && (
                    <span className="pointer-events-none absolute -top-3.5 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground">
                      ×{e.passagens}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs font-semibold">{e.nome}</p>
                <p className="text-[11px] text-muted-foreground">{e.fase}</p>
                <p className="text-[11px]">
                  plano {formatMinUtil(e.plano_min)} · real {formatMinUtil(e.real_min)}
                </p>
                {e.passagens > 1 && (
                  <p className="text-[11px]">{e.passagens} passagens nesta etapa</p>
                )}
                {e.aberta && <p className="text-[11px] text-amber-500">em andamento</p>}
              </TooltipContent>
            </Tooltip>
              );
            })}
          </div>

          <div className="mt-1 flex gap-0.5">
            {etapas.map((e, i) => (
              <span
                key={e.stage_id}
                style={estiloSegmento(ws[i], etapas.length)}
                className="truncate text-[9px] leading-tight text-muted-foreground"
                title={e.nome}
              >
                {e.nome}
              </span>
            ))}
          </div>
        </div>
        <span
          className="h-3 w-3 shrink-0 self-start rounded-full bg-emerald-500"
          aria-label="fim da contagem"
        />
      </div>
    </div>
  );
}
