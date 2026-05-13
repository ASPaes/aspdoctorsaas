import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Send, Edit3, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Fragment {
  type: "text" | "tag";
  value: string;
}

interface Props {
  template: string;
  permiteEdicaoLivre: boolean;
  prefillValues?: Record<string, string>;
  onCancel: () => void;
  onEditFreely: () => void;
  onSend: (finalText: string) => void;
  isSending?: boolean;
}

function parseTemplate(template: string): Fragment[] {
  const fragments: Fragment[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(template)) !== null) {
    if (m.index > lastIndex) {
      fragments.push({ type: "text", value: template.substring(lastIndex, m.index) });
    }
    fragments.push({ type: "tag", value: m[1].trim() });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < template.length) {
    fragments.push({ type: "text", value: template.substring(lastIndex) });
  }
  return fragments;
}

function computeInitialValues(template: string, prefillValues?: Record<string, string>): { values: Record<number, string>; prefilled: Set<number> } {
  const values: Record<number, string> = {};
  const prefilled = new Set<number>();
  if (!prefillValues) return { values, prefilled };
  const frags = parseTemplate(template);
  frags.forEach((f, idx) => {
    if (f.type === "tag") {
      const exact = prefillValues[f.value];
      if (exact) {
        values[idx] = exact;
        prefilled.add(idx);
        return;
      }
      const lower = f.value.toLowerCase();
      const key = Object.keys(prefillValues).find((k) => k.toLowerCase() === lower);
      if (key) {
        values[idx] = prefillValues[key];
        prefilled.add(idx);
      }
    }
  });
  return { values, prefilled };
}

export function MacroFillCard({ template, permiteEdicaoLivre, prefillValues, onCancel, onEditFreely, onSend, isSending }: Props) {
  const fragments = useMemo(() => parseTemplate(template), [template]);

  const tagOccurrences = useMemo(() => {
    return fragments
      .map((f, idx) => ({ frag: f, idx }))
      .filter((x) => x.frag.type === "tag");
  }, [fragments]);

  const initial = useMemo(() => computeInitialValues(template, prefillValues), [template, prefillValues]);
  const [values, setValues] = useState<Record<number, string>>(() => initial.values);
  const prefilledSet = initial.prefilled;
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const sendBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setTimeout(() => {
      // Focus first empty input; if none, focus send button
      const firstEmptyPos = tagOccurrences.findIndex(({ idx }) => !(values[idx] || "").trim());
      if (firstEmptyPos >= 0) {
        inputRefs.current[firstEmptyPos]?.focus();
        inputRefs.current[firstEmptyPos]?.select();
      } else {
        sendBtnRef.current?.focus();
      }
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allFilled = tagOccurrences.every(({ idx }) => (values[idx] || "").trim() !== "");

  const finalText = useMemo(() => {
    return fragments
      .map((f, idx) => (f.type === "text" ? f.value : values[idx] || `{{${f.value}}}`))
      .join("");
  }, [fragments, values]);

  const emptyTags = tagOccurrences
    .filter(({ idx }) => !(values[idx] || "").trim())
    .map(({ frag }) => frag.value);

  const handleSend = () => {
    if (!allFilled || isSending) return;
    onSend(finalText);
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentPos: number) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Find next empty input after current position
      const nextEmptyPos = tagOccurrences.findIndex(
        ({ idx }, pos) => pos !== currentPos && !(values[idx] || "").trim()
      );
      if (nextEmptyPos >= 0) {
        inputRefs.current[nextEmptyPos]?.focus();
        inputRefs.current[nextEmptyPos]?.select();
        return;
      }
      // No empty fields left
      if (allFilled) {
        if (currentPos === tagOccurrences.length - 1) {
          handleSend();
        } else {
          sendBtnRef.current?.focus();
        }
      }
    }
  };

  return (
    <Card className="p-3 mb-2 border-primary/40 bg-primary/5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium">📋 Preencher template</p>
        <div className="flex items-center gap-1">
          {permiteEdicaoLivre && (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onEditFreely}>
              <Edit3 className="h-3.5 w-3.5 mr-1" />
              Editar livremente
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel} aria-label="Cancelar">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {tagOccurrences.map(({ frag, idx }, i) => (
          <div key={`${idx}-${i}`} className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{frag.value}</label>
            <Input
              ref={(el) => (inputRefs.current[i] = el)}
              value={values[idx] || ""}
              onChange={(e) => setValues((v) => ({ ...v, [idx]: e.target.value }))}
              onKeyDown={(e) => handleKeyDown(e, i)}
              placeholder={`Digite: ${frag.value.toLowerCase()}`}
              className={cn(
                "h-8 text-sm",
                prefilledSet.has(idx) && "border-emerald-500/30 bg-emerald-500/5"
              )}
            />
          </div>
        ))}
      </div>

      <div className="rounded-md border bg-background p-2 mb-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Preview</p>
        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {fragments.map((f, idx) => {
            if (f.type === "text") return <span key={idx}>{f.value}</span>;
            const value = (values[idx] || "").trim();
            if (value) {
              return (
                <span key={idx} className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {value}
                </span>
              );
            }
            return (
              <span key={idx} className="text-amber-600 dark:text-amber-400 font-mono text-xs">
                {`{{${f.value}}}`}
              </span>
            );
          })}
        </p>
      </div>

      {!allFilled && (
        <div className="flex items-start gap-2 mb-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>
            Preencha {emptyTags.length === 1 ? "o campo" : "os campos"}:{" "}
            {emptyTags.map((t) => `"${t}"`).join(", ")}
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          ref={sendBtnRef}
          type="button"
          size="sm"
          onClick={handleSend}
          disabled={!allFilled || isSending}
          className={cn(!allFilled && "opacity-50")}
        >
          <Send className="h-3.5 w-3.5 mr-1" />
          {isSending ? "Enviando..." : "Enviar"}
        </Button>
      </div>
    </Card>
  );
}
