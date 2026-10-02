import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  MUTABLE_EVENTS,
  REPEAT_LABEL,
  SILENT_TONE,
  SOUND_EVENTS,
  TONES,
  playTone,
  resolveRepeat,
  resolveTone,
  toneLabel,
  type SoundEvent,
  type ToneChoice,
} from "@/lib/tones";

interface Props {
  /** Só o que o usuário personalizou; chave ausente = tudo no padrão do evento. */
  value: Record<string, ToneChoice>;
  onChange: (next: Record<string, ToneChoice>) => void;
  /** Volume do preview de cada evento, de 0 a 1. */
  volumeFor: (event: SoundEvent) => number;
}

export function SoundByEventPicker({ value, onChange, volumeFor }: Props) {
  const gravar = (event: SoundEvent, tone: string, repetir: boolean) => {
    const next = { ...value };
    // Sem som não repete: não sobra nada para repetir.
    if (tone === SILENT_TONE) repetir = false;
    const noPadrao = tone === DEFAULT_TONE[event];
    // Voltar ao padrão é APAGAR a personalização, não gravar o id do padrão:
    // assim, se um dia o toque padrão de um evento mudar, quem nunca mexeu
    // acompanha a mudança.
    if (noPadrao && !repetir) delete next[event];
    // Sem repetição, o formato curto (só o toque) basta e é o que já está salvo
    // nas preferências de quem configurou antes do contínuo existir.
    else if (!repetir) next[event] = tone;
    else next[event] = { toque: tone, repetir: true };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>Toque por tipo de aviso</Label>
        <p className="text-xs text-muted-foreground">
          Cada aviso pode ter um som diferente, e pode repetir até você atender.
          Deixe no padrão o que não quiser personalizar.
        </p>
      </div>

      <div className="space-y-3.5">
        {SOUND_EVENTS.map((evt) => {
          const atual = resolveTone(evt.id, value);
          const mudo = atual === SILENT_TONE;
          const repetir = resolveRepeat(evt.id, value);
          return (
            <div key={evt.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 pr-1">
                  <p className="text-sm leading-tight">{evt.label}</p>
                  <p className="text-xs text-muted-foreground leading-tight">{evt.hint}</p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Select
                    value={atual}
                    onValueChange={(v) => gravar(evt.id, v, repetir)}
                  >
                    <SelectTrigger className="h-8 w-[118px] text-xs">
                      <SelectValue>{toneLabel(atual)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TONES.filter(
                        (t) => t.id !== SILENT_TONE || MUTABLE_EVENTS.has(evt.id)
                      ).map((t) => (
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
                    title={mudo ? "Sem som" : `Ouvir ${toneLabel(atual)}`}
                    disabled={mudo}
                    onClick={() => playTone(atual, volumeFor(evt.id))}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2 pl-0.5">
                <Checkbox
                  id={`repetir-${evt.id}`}
                  checked={repetir}
                  disabled={mudo}
                  onCheckedChange={(c) => gravar(evt.id, atual, c === true)}
                />
                <label
                  htmlFor={`repetir-${evt.id}`}
                  className={`text-xs leading-none ${
                    mudo
                      ? "text-muted-foreground/50 cursor-not-allowed"
                      : repetir
                        ? "text-foreground cursor-pointer"
                        : "text-muted-foreground cursor-pointer"
                  }`}
                >
                  {REPEAT_LABEL[evt.id]}
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        No modo repetir, o som volta a cada 8 segundos e para sozinho depois de 10
        minutos. Ele só toca com o DoctorSaaS aberto em alguma aba do navegador.
      </p>
    </div>
  );
}
