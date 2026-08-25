import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type KpiTone = "default" | "success" | "warning" | "danger" | "info";
export type KpiSubTone = "success" | "warning" | "danger" | "muted";

export default function KpiCard({
  icon: Icon, label, value, sub, tone = "default", subTone, onClick,
}: {
  icon: any; label: string; value: string; sub?: string;
  tone?: KpiTone;
  subTone?: KpiSubTone;
  /** Quando presente, o card vira botão e abre o drill-down. */
  onClick?: () => void;
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
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 flex flex-col gap-1.5 transition-colors",
        onClick &&
          "cursor-pointer hover:border-foreground/30 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      {...(onClick
        ? {
            role: "button",
            tabIndex: 0,
            onClick,
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            },
          }
        : {})}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
        <Icon className={`h-4 w-4 ${toneClass[tone]}`} />
      </div>
      <div className={`text-2xl font-semibold ${toneClass[tone]}`}>{value}</div>
      {sub && <div className={`text-[11px] ${subToneClass[subTone ?? "muted"]}`}>{sub}</div>}
    </div>
  );
}
