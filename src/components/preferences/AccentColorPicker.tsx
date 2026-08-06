import { Check, Pipette } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_HEX,
  MIN_CONTRAST,
  contrastLevel,
  contrastWithWhite,
  formatContrast,
  normalizeHex,
} from "@/lib/accentColor";

interface Props {
  /** Hex escolhido, ou `null` para o verde padrão da marca. */
  value: string | null;
  onChange: (hex: string | null) => void;
}

const LEVEL_TEXT: Record<ReturnType<typeof contrastLevel>, string> = {
  AAA: "AAA — ótimo",
  AA: "AA — aprovado",
  "AA-large": "Abaixo do AA",
  fail: "Contraste insuficiente",
};

const LEVEL_CLASS: Record<ReturnType<typeof contrastLevel>, string> = {
  AAA: "bg-success/15 text-success border-success/30",
  AA: "bg-success/15 text-success border-success/30",
  "AA-large": "bg-warning/15 text-warning border-warning/30",
  fail: "bg-destructive/15 text-destructive border-destructive/30",
};

function Swatch({
  hex,
  label,
  selected,
  onSelect,
}: {
  hex: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      style={{ backgroundColor: hex }}
      className={cn(
        "relative h-9 w-9 rounded-full border border-black/10 shadow-sm",
        "transition-transform duration-200 hover:scale-110",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
      )}
    >
      {selected && (
        <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" strokeWidth={3} />
      )}
    </button>
  );
}

export function AccentColorPicker({ value, onChange }: Props) {
  const effectiveHex = value ?? DEFAULT_ACCENT_HEX;
  const isPreset = value !== null && ACCENT_PRESETS.some((p) => p.hex.toLowerCase() === value.toLowerCase());
  const isCustom = value !== null && !isPreset;

  const ratio = contrastWithWhite(effectiveHex);
  const level = contrastLevel(ratio);

  return (
    <div className="space-y-3">
      <div>
        <Label>Cor de destaque</Label>
        <p className="text-xs text-muted-foreground">
          Vale só para você, em qualquer dispositivo. Muda balões de mensagem, botões e
          destaques — não muda a cor de ninguém mais.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Swatch
          hex={DEFAULT_ACCENT_HEX}
          label="Padrão DoctorSaaS"
          selected={value === null}
          onSelect={() => onChange(null)}
        />
        <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />
        {ACCENT_PRESETS.map((p) => (
          <Swatch
            key={p.id}
            hex={p.hex}
            label={`${p.label} · contraste ${formatContrast(contrastWithWhite(p.hex))}`}
            selected={value?.toLowerCase() === p.hex.toLowerCase()}
            onSelect={() => onChange(p.hex)}
          />
        ))}

        <label
          title="Cor personalizada"
          className={cn(
            "relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-dashed border-border bg-muted/50",
            "transition-transform duration-200 hover:scale-110",
            isCustom && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
          )}
          style={isCustom ? { backgroundColor: effectiveHex, borderStyle: "solid" } : undefined}
        >
          <Pipette
            className={cn("h-4 w-4", isCustom ? "text-white drop-shadow" : "text-muted-foreground")}
          />
          <input
            type="color"
            value={effectiveHex}
            aria-label="Cor personalizada"
            onChange={(e) => onChange(normalizeHex(e.target.value) ?? DEFAULT_ACCENT_HEX)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>

      {/* Prévia + veredito de contraste, calculado contra o branco que roda em cima. */}
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <div
          className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm px-3 py-2 text-sm shadow-sm"
          style={{ backgroundColor: effectiveHex, color: "#fff" }}
        >
          Bom dia, com quem eu falo?
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            Contraste com o texto branco
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
              LEVEL_CLASS[level],
            )}
          >
            {formatContrast(ratio)} · {LEVEL_TEXT[level]}
          </span>
        </div>
        {value === null && level !== "AA" && level !== "AAA" && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            O padrão da marca fica abaixo do mínimo WCAG AA ({MIN_CONTRAST.toString().replace(".", ",")}:1).
            Escolha outro tom se estiver difícil de ler.
          </p>
        )}
        {isCustom && level !== "AA" && level !== "AAA" && (
          <p className="mt-2 text-[11px] text-destructive">
            Cor muito clara para texto branco. Escureça o tom para poder salvar.
          </p>
        )}
      </div>
    </div>
  );
}
