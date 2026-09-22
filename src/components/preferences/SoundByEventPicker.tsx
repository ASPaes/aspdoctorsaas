import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play } from "lucide-react";
import {
  DEFAULT_TONE,
  SOUND_EVENTS,
  TONES,
  playTone,
  resolveTone,
  toneLabel,
  type SoundEvent,
} from "@/lib/tones";

interface Props {
  /** Só o que o usuário personalizou; chave ausente = toque padrão do evento. */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** Volume do preview de cada evento, de 0 a 1. */
  volumeFor: (event: SoundEvent) => number;
}

export function SoundByEventPicker({ value, onChange, volumeFor }: Props) {
  const set = (event: SoundEvent, tone: string) => {
    const next = { ...value };
    // Escolher o padrão é APAGAR a personalização, não gravar o id do padrão:
    // assim, se um dia o toque padrão de um evento mudar, quem nunca mexeu
    // acompanha a mudança.
    if (tone === DEFAULT_TONE[event]) delete next[event];
    else next[event] = tone;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>Toque por tipo de aviso</Label>
        <p className="text-xs text-muted-foreground">
          Cada aviso pode ter um som diferente. Deixe no padrão o que não quiser
          personalizar.
        </p>
      </div>

      <div className="space-y-2.5">
        {SOUND_EVENTS.map((evt) => {
          const atual = resolveTone(evt.id, value);
          return (
            <div key={evt.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0 pr-1">
                <p className="text-sm leading-tight">{evt.label}</p>
                <p className="text-xs text-muted-foreground leading-tight">{evt.hint}</p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Select value={atual} onValueChange={(v) => set(evt.id, v)}>
                  <SelectTrigger className="h-8 w-[118px] text-xs">
                    <SelectValue>{toneLabel(atual)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TONES.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">
                        {t.label}
                        {/* O toque "Padrão" já se anuncia pelo nome; o sufixo só
                            faz falta quando o padrão do evento é outro toque. */}
                        {t.id === DEFAULT_TONE[evt.id] && t.id !== "padrao"
                          ? " (padrão)"
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  title={`Ouvir ${toneLabel(atual)}`}
                  onClick={() => playTone(atual, volumeFor(evt.id))}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
