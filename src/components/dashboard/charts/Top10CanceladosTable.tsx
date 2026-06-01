import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { AlertTriangle, TrendingDown, ExternalLink } from 'lucide-react';
import type { Top10Cancelado } from '../hooks/useCancelamentosExtras';

interface Top10CanceladosTableProps {
  top10Cancelados: Top10Cancelado[];
  tvMode?: boolean;
  className?: string;
  onClienteClick?: (clienteId: string) => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const fmtData = (iso: string): string => {
  // ISO "YYYY-MM-DD" → "DD/MM/AA"
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y.slice(2)}`;
};

const getNome = (c: Top10Cancelado): string => {
  if (c.nome_fantasia && c.nome_fantasia.trim()) return c.nome_fantasia;
  if (c.razao_social && c.razao_social.trim()) return c.razao_social;
  return 'Sem nome';
};

// Pill de categoria
const categoriaConfig: Record<
  Top10Cancelado['categoria_churn'],
  { label: string; bgClass: string; textClass: string }
> = {
  voluntary: {
    label: 'Voluntário',
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-700 dark:text-red-400',
  },
  involuntary: {
    label: 'Involuntário',
    bgClass: 'bg-orange-500/10',
    textClass: 'text-orange-700 dark:text-orange-400',
  },
  mortality: {
    label: 'Mortalidade',
    bgClass: 'bg-zinc-500/10',
    textClass: 'text-zinc-700 dark:text-zinc-400',
  },
  sem_classif: {
    label: 'Sem classif.',
    bgClass: 'bg-muted',
    textClass: 'text-muted-foreground',
  },
};

export function Top10CanceladosTable({
  top10Cancelados,
  tvMode = false,
  className,
  onClienteClick,
}: Top10CanceladosTableProps) {
  const headerSize = tvMode ? 'text-xl' : 'text-base';
  const subtitleSize = tvMode ? 'text-sm' : 'text-xs';
  const rowSize = tvMode ? 'text-sm' : 'text-xs';
  const metaSize = tvMode ? 'text-xs' : 'text-[11px]';

  // Estado vazio
  if (!top10Cancelados || top10Cancelados.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <div>
            <h3 className={cn('font-semibold tracking-tight', headerSize)}>
              Top 10 cancelamentos por MRR
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Maiores sangrias do período
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

  // Total acumulado
  const totalAcumulado = top10Cancelados.reduce((s, c) => s + c.mrr_perdido, 0);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <h3 className={cn('font-semibold tracking-tight', headerSize)}>
              Top {top10Cancelados.length} cancelamentos por MRR
            </h3>
            <p className={cn('text-muted-foreground', subtitleSize)}>
              Maiores sangrias do período — alvos prioritários de investigação
            </p>
          </div>
          <div className="text-right">
            <p className={cn('text-muted-foreground', metaSize)}>Acumulado</p>
            <p className={cn('font-bold text-red-600', headerSize)}>
              {fmt(totalAcumulado)}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Segmento</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead className="text-right">Tenure</TableHead>
              <TableHead className="text-right">Cancelou</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              {onClienteClick && <TableHead className="w-8" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {top10Cancelados.map((c, idx) => {
              const cfg = categoriaConfig[c.categoria_churn];
              const isEarly = c.tenure_dias <= 90;
              const nome = getNome(c);
              const clickable = !!onClienteClick;

              return (
                <TableRow
                  key={c.cliente_id}
                  className={cn(
                    clickable && 'cursor-pointer hover:bg-muted/60'
                  )}
                  onClick={clickable ? () => onClienteClick!(c.cliente_id) : undefined}
                >
                  <TableCell className={cn('font-mono text-muted-foreground', rowSize)}>
                    {idx + 1}
                  </TableCell>

                  <TableCell className={rowSize}>
                    <span
                      className="block truncate max-w-[200px]"
                      title={nome}
                    >
                      {nome}
                    </span>
                  </TableCell>

                  <TableCell className={rowSize}>
                    <span
                      className="block truncate max-w-[120px]"
                      title={c.segmento}
                    >
                      {c.segmento}
                    </span>
                  </TableCell>

                  <TableCell className={rowSize}>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium leading-none',
                          cfg.bgClass,
                          cfg.textClass
                        )}
                      >
                        {cfg.label}
                      </span>
                      <span
                        className="block truncate max-w-[200px]"
                        title={c.motivo}
                      >
                        {c.motivo}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className={cn('text-right tabular-nums', rowSize)}>
                    {isEarly ? (
                      <span className="inline-flex items-center gap-1 text-red-600">
                        <AlertTriangle className="shrink-0" size={14} />
                        {c.tenure_dias}d
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{c.tenure_dias}d</span>
                    )}
                  </TableCell>

                  <TableCell className={cn('text-right tabular-nums text-muted-foreground', rowSize)}>
                    {fmtData(c.data_cancelamento)}
                  </TableCell>

                  <TableCell className={cn('text-right tabular-nums', rowSize)}>
                    <span className="inline-flex items-center gap-1 font-semibold text-red-600">
                      <TrendingDown className="shrink-0" size={14} />
                      {fmt(c.mrr_perdido)}
                    </span>
                  </TableCell>

                  {onClienteClick && (
                    <TableCell className="text-right">
                      <ExternalLink
                        className="inline-block text-muted-foreground"
                        size={14}
                      />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Indicador early churn no rodapé */}
        {top10Cancelados.some((c) => c.tenure_dias <= 90) && (
          <div className="mt-3 flex items-center gap-1.5 rounded-md bg-red-50/50 px-3 py-2 dark:bg-red-950/20">
            <AlertTriangle size={14} className="text-red-600" />
            <p className={cn('text-red-700 dark:text-red-400', metaSize)}>
              Linhas em vermelho indicam early churn (tenure ≤ 90d) — onboarding ou ICP errado
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
