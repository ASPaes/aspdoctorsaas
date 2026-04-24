import { useState, KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface SkillsTagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function SkillsTagInput({ value, onChange, disabled }: SkillsTagInputProps) {
  const [draft, setDraft] = useState("");

  const sanitize = (raw: string) =>
    raw.trim().toLowerCase().slice(0, 20);

  const handleAdd = () => {
    const tag = sanitize(draft);
    if (!tag) return;
    if (value.includes(tag)) {
      setDraft("");
      return;
    }
    onChange([...value, tag]);
    setDraft("");
  };

  const handleRemove = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 max-w-xs">
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          <span>{tag}</span>
          <button
            type="button"
            onClick={() => handleRemove(tag)}
            disabled={disabled}
            className="hover:bg-muted-foreground/20 rounded-sm p-0.5 disabled:opacity-50"
            aria-label={`Remover ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="+ tag"
        maxLength={20}
        className="h-7 w-24 text-xs"
      />
    </div>
  );
}
