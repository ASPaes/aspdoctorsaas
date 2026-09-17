import { useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MoonStar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dentroDoHorario, proximoHorarioUtil, type ConfigHorario } from "@/lib/businessHours";
import { paraInputLocal } from "../input/ScheduleBar";

/**
 * Data e hora do e-mail agendado (mockup "E-mail etapa 2", 16/09/2026). Mesmo
 * comportamento da mensagem agendada do chat: atalhos, campo livre e o aviso de
 * fora do horário, que NUNCA bloqueia. Usado no Agendar envio e no Mudar horário.
 */

export const MAX_DIAS_AGENDAR = 180;

/** atalhos do mockup; o que já passou não aparece */
export function atalhosDeAgendamento(agora = new Date()): { rotulo: string; quando: Date }[] {
  const amanha8 = new Date(agora);
  amanha8.setDate(amanha8.getDate() + 1);
  amanha8.setHours(8, 0, 0, 0);

  const segunda8 = new Date(agora);
  const faltam = ((1 - segunda8.getDay() + 7) % 7) || 7;
  segunda8.setDate(segunda8.getDate() + faltam);
  segunda8.setHours(8, 0, 0, 0);

  const duasHoras = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
  duasHoras.setSeconds(0, 0);

  const lista = [
    { rotulo: "Amanhã, 08:00", quando: amanha8 },
    { rotulo: "Segunda, 08:00", quando: segunda8 },
    { rotulo: "Daqui a 2 horas", quando: duasHoras },
  ];
  // amanhã já é segunda: o segundo atalho repetiria o primeiro
  return lista.filter((a, i) => a.quando.getTime() > agora.getTime() + 60_000 && !(i === 1 && a.quando.getTime() === amanha8.getTime()));
}

export function lerHorario(valor: string): Date | null {
  if (!valor) return null;
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

export function problemaDoHorario(quando: Date | null, agora = new Date()): string | null {
  if (!quando) return "Escolha o dia e a hora.";
  if (quando.getTime() < agora.getTime() + 60_000) return "Escolha um horário a partir de daqui a 1 minuto.";
  if (quando.getTime() > agora.getTime() + MAX_DIAS_AGENDAR * 24 * 60 * 60 * 1000) return "Dá para agendar até 180 dias à frente.";
  return null;
}

export function EscolherHorario({
  id,
  valor,
  onChange,
  horario,
}: {
  id: string;
  valor: string;
  onChange: (v: string) => void;
  horario: ConfigHorario | null;
}) {
  const escolhida = lerHorario(valor);
  const foraDoExpediente = !!escolhida && !dentroDoHorario(escolhida, horario);
  const sugestao = useMemo(
    () => (foraDoExpediente && escolhida ? proximoHorarioUtil(escolhida, horario) : null),
    [foraDoExpediente, escolhida, horario],
  );
  const atalhos = atalhosDeAgendamento();

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {atalhos.map((a) => {
          const marcado = valor === paraInputLocal(a.quando);
          return (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => onChange(paraInputLocal(a.quando))}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                marcado ? "border-sky-500 font-semibold text-sky-700 dark:text-sky-400" : "border-border hover:bg-muted",
              )}
            >
              {a.rotulo}
            </button>
          );
        })}
      </div>
      <Input
        id={id}
        type="datetime-local"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        min={paraInputLocal(new Date(Date.now() + 60_000))}
        max={paraInputLocal(new Date(Date.now() + MAX_DIAS_AGENDAR * 24 * 60 * 60 * 1000))}
        className="h-9"
        aria-label="Dia e hora do envio"
      />
      {foraDoExpediente && escolhida && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
          <MoonStar className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="text-[11px] text-amber-800 dark:text-amber-200">
            {format(escolhida, "EEEE, dd/MM 'às' HH:mm", { locale: ptBR })} está fora do horário de atendimento. O e-mail
            sai assim mesmo.
          </span>
          {sugestao && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 border-amber-500/50 px-2 text-[11px] hover:bg-amber-500/20"
              onClick={() => onChange(paraInputLocal(sugestao))}
            >
              Usar {format(sugestao, "dd/MM 'às' HH:mm", { locale: ptBR })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
