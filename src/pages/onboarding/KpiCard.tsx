export type KpiTone = "default" | "success" | "warning" | "danger" | "info";
export type KpiSubTone = "success" | "warning" | "danger" | "muted";

export default function KpiCard({
  icon: Icon, label, value, sub, tone = "default", subTone,
}: {
  icon: any; label: string; value: string; sub?: string;
  tone?: KpiTone;
  subTone?: KpiSubTone;
}) {
  const toneClass: Record<string, string> = {
    default: "text-foreground",
    success: "text-[hsl(142_71%_45%)]",
    warning: "text-[hsl(38_92%_50%)]",
    danger: "text-destructive",
    info: "text-[hsl(199_89%_48%)]",
  };
  const subToneClass: Record<string, string> = {
    success: "text-[hsl(142_71%_45%)]",
    warning: "text-[hsl(38_92%_50%)]",
    danger: "text-destructive",
    muted: "text-muted-foreground",
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
        <Icon className={`h-4 w-4 ${toneClass[tone]}`} />
      </div>
      <div className={`text-2xl font-semibold ${toneClass[tone]}`}>{value}</div>
      {sub && <div className={`text-[11px] ${subToneClass[subTone ?? "muted"]}`}>{sub}</div>}
    </div>
  );
}
