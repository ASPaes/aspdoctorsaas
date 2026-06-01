import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowRight, Clock } from 'lucide-react';

interface BucketData {
  qtd: number;
  mrr: number;
}

interface TenureBucketsChartProps {
  buckets: {
    ate90d: BucketData;
    d91_180: BucketData;
    d181_365: BucketData;
    mais1y: BucketData;
  };
  earlyChurnRate?: number; // 0-1
  tvMode?: boolean;
  className?: string;
  onNavigateToCohort?: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return `R$ ${v.toFixed(0)}`;
};

interface BucketDef {
  key: string;
  label: string;
  sublabel: string;
  description: string;
  data: BucketData;
  isEarlyChurn?: boolean;
}

export function TenureBucketsChart({
  buckets,
  earlyChurnRate = 0,
  tvMode = false,
  className,
  onNavigateToCohort,
}: TenureBucketsChartProps) {
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const subtitleSize = tvMode ? 'text-sm' : 'text-xs';
  const labelSize = tvMode ? 'text-xs' : 'text-[10px]';
  const valueSize = tvMode ? 'text-3xl' : 'text-2xl';
  const metaSize = tvMode ? 'text-xs' : 'text-[11px]';

  const totalQtd =
    buckets.ate90d.qtd + buckets.d91_180.qtd + buckets.d181_365.qtd + buckets.mais1y.qtd;
  const totalMrr =
    buckets.ate90d.mrr + buckets.d91_180.mrr + buckets.d181_365.mrr + buckets.mais1y.mrr;

  const bucketDefs: BucketDef[] = [
    {
      key: 'ate90d',
      label: '≤ 90 dias',
      sublabel: 'Early Churn',
      description: 'Onboarding/ICP errado',
      data: buckets.ate90d,
      isEarlyChurn: true,
    },
    {
      key: 'd91_180',
      label: '91-180 dias',
      sublabel: '3-6 meses',
      description: 'Adaptação inicial falhou',
      data: buckets.d91_180,
    },
    {
      key: 'd181_365',
      label: '181-365 dias',
      sublabel: '6-12 meses',
      description: 'Primeira renovação não saiu',
      data: buckets.d181_365,
    },
    {
      key: 'mais1y',
      label: '> 1 ano',
      sublabel: 'Clientes maduros',
      description: 'Cancelamento de cliente velho',
      data: buckets.mais1y,
    },
  ];

  // Estado vazio
  if (totalQtd === 0) {
    return (
      <Card className={cn('border-border/50', className)}>
        <CardHeader className="pb-2">
          <div className="text-left">
            <h3 className={cn('font-semibold text-foreground', headerSize)}>
              Cohort de saída — quando foram embora
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Distribuição dos cancelamentos por tenure
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sem cancelamentos no período.
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
            <div className="flex items-center gap-2">
              <h3 className={cn('font-semibold text-foreground', headerSize)}>
                Cohort de saída — quando foram embora
              </h3>
            </div>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Distribuição dos cancelamentos por tempo de vida do cliente
            </p>
          </div>
          {earlyChurnRate > 0.2 && (
            <div className="flex items-center gap-1.5 shrink-0 rounded-md border border-red-500/30 bg-red-500/[0.08] px-2.5 py-1">
              <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />
              <span className={cn('font-medium text-red-700 dark:text-red-300', labelSize)}>
                Early Churn elevado
              </span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Grid de 4 buckets */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {bucketDefs.map((b) => {
            const pctQtd = totalQtd > 0 ? (b.data.qtd / totalQtd) * 100 : 0;
            const isEarly = b.isEarlyChurn && b.data.qtd > 0;

            return (
              <div
                key={b.key}
                className={cn(
                  'rounded-lg border p-3 flex flex-col gap-2',
                  isEarly
                    ? 'border-red-500/40 bg-red-500/[0.04]'
                    : 'border-border bg-card'
                )}
              >
                {/* Header do bucket */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={cn('font-semibold text-foreground leading-tight', labelSize)}>
                      {b.label}
                    </div>
                    <div className={cn('text-muted-foreground', labelSize)}>
                      {b.sublabel}
                    </div>
                  </div>
                  {isEarly && (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                  )}
                </div>

                {/* Valor principal: qtd */}
                <div className={cn('font-bold tabular-nums text-foreground', valueSize)}>
                  {b.data.qtd}
                </div>
                <div className={cn('text-muted-foreground tabular-nums', metaSize)}>
                  {pctQtd.toFixed(0)}% dos cancelamentos
                </div>

                {/* MRR perdido */}
                <div className="mt-auto pt-2 border-t border-border/50 space-y-1">
                  <div className={cn('text-muted-foreground uppercase tracking-wide', 'text-[9px]')}>
                    MRR perdido
                  </div>
                  <div className={cn('font-semibold tabular-nums text-foreground', metaSize)}>
                    {fmtShort(b.data.mrr)}
                  </div>
                  <div className={cn('text-muted-foreground line-clamp-1', metaSize)}>
                    {b.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Resumo total + linkbox */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border/50">
          <div className={cn('text-muted-foreground', metaSize)}>
            <span className="font-medium text-foreground">Total:</span>{' '}
            {totalQtd} cancelamentos
            {' · '}
            {fmt(totalMrr)} de MRR perdido
          </div>

          {onNavigateToCohort && (
            <button
              type="button"
              onClick={onNavigateToCohort}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              Ver retenção completa por coorte
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
