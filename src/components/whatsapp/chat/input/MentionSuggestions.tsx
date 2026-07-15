import { useEffect, useRef } from "react";
import { Megaphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { GroupParticipant } from "../../hooks/useGroupParticipants";

interface MentionSuggestionsProps {
  participants: GroupParticipant[];
  onSelect: (p: GroupParticipant) => void;
  selectedIndex?: number;
}

function formatPhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length >= 12) {
    // 55 11 91234-5678
    const cc = digits.slice(0, 2);
    const area = digits.slice(2, 4);
    const rest = digits.slice(4);
    const mid = rest.length > 4 ? rest.slice(0, rest.length - 4) : rest;
    const tail = rest.slice(-4);
    return `+${cc} ${area} ${mid}-${tail}`;
  }
  return phone;
}

export function displayFor(p: GroupParticipant): string {
  return p.name?.trim() || formatPhone(p.phone || "");
}

export function initialsFor(p: GroupParticipant): string {
  const src = p.name?.trim() || p.phone || "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (src.slice(0, 2) || "?").toUpperCase();
}

export const MentionSuggestions = ({ participants, onSelect, selectedIndex = 0 }: MentionSuggestionsProps) => {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (participants.length === 0) return null;

  return (
    <Card className="absolute bottom-full left-0 right-0 mb-2 border border-border/50 shadow-xl bg-card rounded-lg overflow-hidden z-20">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
        Mencionar participante
      </div>
      <div className="p-1 max-h-[240px] overflow-y-auto">
        {participants.map((p, idx) => {
          const isSelected = idx === selectedIndex;
          const display = displayFor(p);
          const initials = initialsFor(p);
          const subtitle = p.name?.trim() ? formatPhone(p.phone || "") : null;
          return (
            <button
              key={`${p.phone || p.lid || idx}`}
              ref={(el) => (itemRefs.current[idx] = el)}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(p)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors border-l-2",
                isSelected ? "bg-accent border-primary" : "border-transparent hover:bg-accent/50"
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {initials}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{display}</span>
                {subtitle && (
                  <span className="block text-[11px] text-muted-foreground truncate">{subtitle}</span>
                )}
              </span>
              {p.admin && (
                <span className="text-[10px] opacity-60 shrink-0 uppercase tracking-wide">admin</span>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
};
