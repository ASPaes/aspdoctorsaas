// Barra de agendamento — aparece no compositor quando a aba "Agendar" está ativa.
//
// Atalhos + data/hora livre + o aviso de fora do expediente. O aviso NUNCA
// bloqueia: o cliente que pediu retorno no domingo é caso legítimo. Ele só
// mostra o que o operador talvez não tenha percebido e oferece o empurrão para
// o próximo horário útil em um clique.
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarClock, MoonStar } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { dentroDoHorario, proximoHorarioUtil, type ConfigHorario } from "@/lib/businessHours";

export const MAX_DIAS = 180;

export function paraInputLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function proximaHoraCheia(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

interface Props {
  valor: string;
  onChangeValor: (v: string) => void;
  cancelarSeResponder: boolean;
  onChangeCancelarSeResponder: (v: boolean) => void;
  horario: ConfigHorario | null;
  erro?: string | null;
}

const ATALHOS: Array<{ label: string; calcular: () => Date }> = [
  { label: "+1h", calcular: () => new Date(Date.now() + 60 * 60 * 1000) },
  {
    label: "Hoje 17h",
    calcular: () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; },
  },
  {
    label: "Amanhã 9h",
    calcular: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; },
  },
  {
    label: "Próx. seg 9h",
    calcular: () => {
      const d = new Date();
      const faltam = ((1 - d.getDay() + 7) % 7) || 7;
      d.setDate(d.getDate() + faltam);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

export function ScheduleBar({
  valor, onChangeValor, cancelarSeResponder, onChangeCancelarSeResponder, horario, erro,
}: Props) {
  const escolhida = useMemo(() => {
    if (!valor) return null;
    const d = new Date(valor);
    return isNaN(d.getTime()) ? null : d;
  }, [valor]);

  const foraDoExpediente = !!escolhida && !dentroDoHorario(escolhida, horario);
  const sugestao = useMemo(
    () => (foraDoExpediente && escolhida ? proximoHorarioUtil(escolhida, horario) : null),
    [foraDoExpediente, escolhida, horario],
  );

  const minLocal = paraInputLocal(new Date(Date.now() + 60_000));
  const maxLocal = paraInputLocal(new Date(Date.now() + MAX_DIAS * 24 * 60 * 60 * 1000));

  // Atalho que já passou não faz sentido (às 18h, "Hoje 17h" é ontem).
  const atalhos = ATALHOS.filter((a) => a.calcular().getTime() > Date.now() + 60_000);

  return (
    <div className="mb-2 rounded-lg border border-violet-500/40 bg-violet-500/5 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
          <CalendarClock className="h-3.5 w-3.5" />
          Enviar em
        </div>

        <Input
          type="datetime-local"
          value={valor}
          onChange={(e) => onChangeValor(e.target.value)}
          min={minLocal}
          max={maxLocal}
          className="h-8 w-[200px] text-sm border-violet-500/40 focus-visible:ring-violet-500/40"
          aria-label="Data e hora do envio"
        />

        <div className="flex flex-wrap gap-1.5">
          {atalhos.map((a) => (
            <Button
              key={a.label}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs border-violet-500/30 hover:bg-violet-500/10"
              onClick={() => onChangeValor(paraInputLocal(a.calcular()))}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      {foraDoExpediente && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
          <MoonStar className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="text-[11px] text-amber-800 dark:text-amber-200">
            {escolhida && format(escolhida, "EEEE, dd/MM 'às' HH:mm", { locale: ptBR })} está fora do
            horário de atendimento.
          </span>
          {sugestao && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] border-amber-500/50 hover:bg-amber-500/20"
              onClick={() => onChangeValor(paraInputLocal(sugestao))}
            >
              Usar {format(sugestao, "dd/MM 'às' HH:mm", { locale: ptBR })}
            </Button>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer w-fit">
        <Checkbox
          checked={cancelarSeResponder}
          onCheckedChange={(c) => onChangeCancelarSeResponder(c === true)}
          className="rounded-[4px] border-violet-500 data-[state=checked]:bg-violet-500 data-[state=checked]:text-white"
        />
        Cancelar se o cliente responder antes
      </label>

      {erro && <p className={cn("text-[11px] text-destructive")}>{erro}</p>}
    </div>
  );
}
