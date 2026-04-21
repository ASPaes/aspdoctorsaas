export function Sparkline({ values, color = '#3b82f6' }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(2, (v / max) * 100)}%`,
            background: color,
            opacity: 0.6,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}
