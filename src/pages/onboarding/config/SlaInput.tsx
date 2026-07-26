import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { minutesToParts, partsToMinutes } from "./utils";

interface Props {
  value: number;
  onChange: (minutes: number) => void;
  label?: string;
  hideMinutes?: boolean;
}

export function SlaInput({ value, onChange, label, hideMinutes }: Props) {
  const { dias, horas, minutos } = minutesToParts(value);

  const update = (d: number, h: number, m: number) => {
    onChange(partsToMinutes(d, h, m));
  };

  return (
    <div className="space-y-1.5">
      {label && <Label className="text-xs">{label}</Label>}
      <div className={`grid ${hideMinutes ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
        <div>
          <Input
            type="number"
            min={0}
            value={dias || ""}
            placeholder="0"
            onChange={(e) => update(Number(e.target.value) || 0, horas, minutos)}
          />
          <span className="text-[10px] text-muted-foreground mt-0.5 block">dias úteis</span>
        </div>
        <div>
          <Input
            type="number"
            min={0}
            max={7}
            value={horas || ""}
            placeholder="0"
            onChange={(e) => update(dias, Number(e.target.value) || 0, minutos)}
          />
          <span className="text-[10px] text-muted-foreground mt-0.5 block">horas</span>
        </div>
        {!hideMinutes && (
          <div>
            <Input
              type="number"
              min={0}
              max={59}
              value={minutos || ""}
              placeholder="0"
              onChange={(e) => update(dias, horas, Number(e.target.value) || 0)}
            />
            <span className="text-[10px] text-muted-foreground mt-0.5 block">min</span>
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">Horário útil do setor · 1 dia = 8h</p>
    </div>
  );
}
