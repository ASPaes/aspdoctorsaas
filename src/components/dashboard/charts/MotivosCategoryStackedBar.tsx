import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

interface CategoriaData {
  mrr: number;
  qtd: number;
}

interface MotivosCategoryStackedBarProps {
  categorias: {
    voluntary: CategoriaData;
    involuntary: CategoriaData;
    mortality: CategoriaData;
    semClassif: CategoriaData;
  };
  tvMode?: boolean;
  className?: string;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

interface Segment {
  key: 'voluntary' | 'involuntary' | 'mortality' | 'semClassif';
  label: string;
  description: string;
  mrr: number;
  qtd: number;
  bgClass: string;
  textClass: string;
  dotClass: string;
  labelClass: string;
}

export function MotivosCategoryStackedBar({
  categorias,
  tvMode = false,
  className,
}: MotivosCategoryStackedBarProps) {
  const total =
    categorias.voluntary.mrr +
    categorias.involuntary.mrr +
    categorias.mortality.mrr +
    categorias.semClassif.mrr;

  const segments: Segment[] = [
    {
      key: 'voluntary',
      label: 'Voluntário',
      description: 'concorrência, preço, produto',
      mrr: categorias.voluntary.mrr,
      qtd: categorias.voluntary.qtd,
      bgClass: 'bg-red-500',
      textClass: 'text-white',
      dotClass: 'bg-red-500',
      labelClass: 'text-red-600 dark:text-red-400',
    },
    {
      key: 'involuntary',
      label: 'Involuntário',
      description: 'inadimplência, operacional',
      mrr: categorias.involuntary.mrr,
      qtd: categorias.involuntary.qtd,
      bgClass: 'bg-orange-500',
      textClass: 'text-orange-950',
      dotClass: 'bg-orange-500',
      labelClass: 'text-orange-600 dark:text-orange-400',
    },
    {
      key: 'mortality',
      label: 'Mortalidade',
      description: 'cliente fechou ou parou',
      mrr: categorias.mortality.mrr,
      qtd: categorias.mortality.qtd,
      bgClass: 'bg-zinc-500',
      textClass: 'text-white',
      dotClass: 'bg-zinc-500',
      labelClass: 'text-zinc-600 dark:text-zinc-400',
    },
    {
      key: 'semClassif',
      label: 'Sem classificação',
      description: 'motivo não cadastrado',
      mrr: categorias.semClassif.mrr,
      qtd: categorias.semClassif.qtd,
      bgClass: 'bg-muted',
      textClass: 'text-muted-foreground',
      dotClass: 'bg-muted-foreground/40',
      labelClass: 'text-muted-foreground',
    },
  ];

  const voluntaryPct = total > 0 ? categorias.voluntary.mrr / total : 0;
  const showVoluntaryAlert = voluntaryPct > 0.35;

  const barHeight = tvMode ? 'h-12' : 'h-10';
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const subtitleSize = tvMode ? 'text-sm' : 'text-xs';
  const labelInsideSize = tvMode ? 'text-sm' : 'text-xs';
  const legendSize = tvMode ? 'text-xs' : 'text-[11px]';

  // Estado vazio
  if (total === 0) {
    return (
      <Card className={cn('border-border/50', className)}>
        <CardHeader className="pb-2">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Categorias de churn
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Natureza do problema — voluntary, involuntary, mortality
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sem cancelamentos com MRR no período.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4 w-full">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Categorias de churn
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              % do MRR perdido por natureza do problema
            </p>
          </div>
          <div className="text-right">
            <div className={cn('text-muted-foreground uppercase tracking-wide', tvMode ? 'text-xs' : 'text-[10px]')}>
              Total MRR perdido
            </div>
            <div className={cn('font-bold tabular-nums text-foreground', tvMode ? 'text-2xl' : 'text-lg')}>
              {fmt(total)}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stacked bar */}
        <div className={cn('relative w-full overflow-hidden rounded-md bg-muted/40', barHeight)}>
          {segments.map((seg) => {
            if (seg.mrr <= 0) return null;
            const pct = (seg.mrr / total) * 100;
            const showLabel = pct >= 12;
            return (
              <div
                key={seg.key}
                className={cn('absolute top-0 bottom-0 flex flex-col items-center justify-center', seg.bgClass, seg.textClass)}
                style={{
                  left: `${segments.slice(0, segments.indexOf(seg)).reduce((s, x) => s + (x.mrr > 0 ? (x.mrr / total) * 100 : 0), 0)}%`,
                  width: `${pct}%`,
                }}
              >
                {showLabel && (
                  <>
                    <span className={cn('font-bold tabular-nums leading-tight', labelInsideSize)}>
                      {pct.toFixed(0)}%
                    </span>
                    <span className={cn('tabular-nums leading-tight opacity-90', labelInsideSize)}>
                      {seg.label}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {segments.map((seg) => {
            const pct = total > 0 ? (seg.mrr / total) * 100 : 0;
            return (
              <div key={seg.key} className="flex items-start gap-2 min-w-0">
                <span className={cn('inline-block h-2.5 w-2.5 rounded-sm shrink-0 mt-0.5', seg.dotClass)} />
                <div className={cn('min-w-0', legendSize)}>
                  <div className="flex items-center gap-1">
                    <span className={cn('font-semibold', seg.labelClass)}>{seg.label}</span>
                    <span className="text-foreground tabular-nums">
                      {pct.toFixed(0)}% · {fmt(seg.mrr)}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    ({seg.qtd} {seg.qtd === 1 ? 'logo' : 'logos'}) — {seg.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Alerta condicional: voluntary > 35% */}
        {showVoluntaryAlert && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/[0.08] px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
              <p className={cn('text-yellow-800 dark:text-yellow-300', tvMode ? 'text-sm' : 'text-xs')}>
                <strong>Voluntary acima de 35% do MRR perdido</strong>
                {' — '}
                sinaliza problema de produto, preço ou competitividade, não falha de cobrança. Atacar causa raiz do churn voluntário deve ser prioridade.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
