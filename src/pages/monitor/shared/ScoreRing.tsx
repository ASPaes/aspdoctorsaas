export function ScoreRing({ score }: { score: number }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444';
  return (
    <svg width={80} height={80} viewBox="0 0 80 80">
      <circle cx={40} cy={40} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={6} />
      <circle
        cx={40}
        cy={40}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 40 40)"
      />
      <text x={40} y={40} textAnchor="middle" dominantBaseline="central" fontSize={18} fontWeight={600} fill="hsl(var(--foreground))">
        {score}
      </text>
      <text x={40} y={56} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">/100</text>
    </svg>
  );
}
