import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { useTilt3D } from '@/hooks/useTilt3D';
import './comparativos.css';
import '@/components/dashboard/cards/kpi-card.css';

export type ComparativoFormat = 'BRL' | 'number' | 'percent';

export interface ComparativoData {
  /** Label do período de comparação, ex: "Q1 26" ou "S2 25" ou "maio 25" */
  periodoLabel: string;
  /** Valor atual */
  current: number;
  /** Valor no período anterior */
  previous: number;
  /** Pontos do sparkline (opcional) — do mais antigo para o atual */
  sparklinePoints?: number[];
}

interface ComparativosTemporaisBlockProps {
  trimestre: ComparativoData;
  semestre: ComparativoData;
  ano: ComparativoData;
  format?: ComparativoFormat;
  className?: string;
  enableTilt?: boolean;
}

function formatValue(value: number, format: ComparativoFormat): { prefix?: string; main: string } {
  if (format === 'BRL') {
    return {
      prefix: 'R$',
      main: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value),
    };
  }
  if (format === 'percent') {
    return { main: `${(value * 100).toFixed(1)}%` };
  }
  return { main: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value) };
}

function formatDelta(value: number, format: ComparativoFormat): string {
  const abs = Math.abs(value);
  if (format === 'BRL') {
    const prefix = value >= 0 ? '+R$ ' : '−R$ ';
    return prefix + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(abs);
  }
  if (format === 'percent') {
    return (value >= 0 ? '+' : '−') + `${(abs * 100).toFixed(1)}pp`;
  }
  return (value >= 0 ? '+' : '−') + new Intl.NumberFormat('pt-BR').format(abs);
}

function trendDirection(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function buildSparklinePath(
  points: number[] | undefined,
  previous: number,
  current: number,
  width = 240,
  height = 36,
): { path: string; startY: number; endY: number; trend: 'up' | 'down' | 'flat' } {
  const data = points && points.length >= 2 ? points : [previous, current];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const paddingY = 4;
  const usableH = height - paddingY * 2;

  const stepX = width / (data.length - 1);
  const coords = data.map((v, i) => {
    const x = i * stepX;
    const y = paddingY + (1 - (v - min) / range) * usableH;
    return { x, y };
  });

  let path = `M ${coords[0].x},${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    const c = coords[i];
    const prev = coords[i - 1];
    const midX = (prev.x + c.x) / 2;
    path += ` Q ${midX},${prev.y} ${midX},${(prev.y + c.y) / 2}`;
    path += ` T ${c.x},${c.y}`;
  }

  return {
    path,
    startY: coords[0].y,
    endY: coords[coords.length - 1].y,
    trend: trendDirection(current - previous),
  };
}

function CompareCard({
  data,
  titleLabel,
  format,
  enableTilt,
}: {
  data: ComparativoData;
  titleLabel: string;
  format: ComparativoFormat;
  enableTilt: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useTilt3D(cardRef, { enabled: enableTilt });

  const delta = data.current - data.previous;
  const deltaPct = data.previous !== 0 ? delta / data.previous : 0;
  const trend = trendDirection(delta);

  const current = formatValue(data.current, format);
  const previous = formatValue(data.previous, format);

  const spark = buildSparklinePath(data.sparklinePoints, data.previous, data.current, 240, 36);
  const strokeColor =
    trend === 'up'
      ? 'hsl(142 71% 45%)'
      : trend === 'down'
        ? 'hsl(0 84% 60%)'
        : 'hsl(215 25% 60%)';
  const baselineColor = 'hsl(217 19% 27% / 0.6)';

  return (
    <div ref={cardRef} className="cmp-card kpi-spatial">
      <div className="cmp-head">
        <div className="cmp-period">
          {titleLabel} · <strong>{data.periodoLabel}</strong>
        </div>
        <span
          className={cn(
            'cmp-arrow',
            trend === 'up' && 'cmp-arrow-up',
            trend === 'down' && 'cmp-arrow-down',
            trend === 'flat' && 'cmp-arrow-flat',
          )}
        >
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
        </span>
      </div>

      <div className="cmp-now">
        {current.prefix && <span className="cmp-now-pref">{current.prefix}</span>}
        {current.main}
      </div>

      <div className="cmp-then">
        <span className="cmp-then-label">era</span>
        {previous.prefix ? `${previous.prefix} ` : ''}
        {previous.main}
      </div>

      <div
        className={cn(
          'cmp-delta',
          trend === 'up' && 'cmp-delta-up',
          trend === 'down' && 'cmp-delta-down',
          trend === 'flat' && 'cmp-delta-flat',
        )}
      >
        <span>{trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—'}</span>
        <span>{formatDelta(delta, format)}</span>
        {data.previous !== 0 && (
          <>
            <span className="cmp-delta-pct">·</span>
            <span className="cmp-delta-pct">
              {deltaPct >= 0 ? '+' : ''}
              {(deltaPct * 100).toFixed(1)}%
            </span>
          </>
        )}
      </div>

      <svg
        className="cmp-track-svg"
        viewBox="0 0 240 36"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1="18"
          x2="240"
          y2="18"
          stroke={baselineColor}
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <path
          d={spark.path}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: `drop-shadow(0 0 4px ${strokeColor.replace(')', ' / 0.5)')})` }}
        />
        <circle cx="0" cy={spark.startY} r="2" fill={baselineColor} />
        <circle
          cx="240"
          cy={spark.endY}
          r="3"
          fill={strokeColor}
          style={{ filter: `drop-shadow(0 0 6px ${strokeColor.replace(')', ' / 0.7)')})` }}
        />
      </svg>
    </div>
  );
}

export function ComparativosTemporaisBlock({
  trimestre,
  semestre,
  ano,
  format = 'BRL',
  className,
  enableTilt = true,
}: ComparativosTemporaisBlockProps) {
  return (
    <div className={cn('grid gap-4 grid-cols-1 md:grid-cols-3', className)}>
      <CompareCard data={trimestre} titleLabel="vs Trimestre" format={format} enableTilt={enableTilt} />
      <CompareCard data={semestre} titleLabel="vs Semestre" format={format} enableTilt={enableTilt} />
      <CompareCard data={ano} titleLabel="vs Ano" format={format} enableTilt={enableTilt} />
    </div>
  );
}
