import { useState } from "react";
import { format } from "date-fns";
import { CalendarClock, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ConfigHorario } from "@/lib/businessHours";
import { EscolherHorario, atalhosDeAgendamento, lerHorario, problemaDoHorario } from "./EscolherHorario";
import { paraInputLocal } from "../input/ScheduleBar";

/**
 * Agendar e Enviar lado a lado (mockup "E-mail etapa 2", aprovado
 * em 16/09/2026). Agendar abre o horário; confirmar guarda o e-mail como está e
 * fecha a tela. Quem confere remetente, destinatário e o resto é a tela, antes.
 */
export function BotaoEnviarComAgenda({
  enviando,
  desabilitado,
  horario,
  onEnviar,
  onAgendar,
}: {
  enviando: boolean;
  desabilitado: boolean;
  horario: ConfigHorario | null;
  onEnviar: () => void;
  onAgendar: (quando: Date) => Promise<boolean>;
}) {
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const quando = lerHorario(valor);
  const problema = valor ? problemaDoHorario(quando) : null;

  const abrir = (v: boolean) => {
    // abre já com o primeiro atalho marcado: um clique a menos no caso comum
    if (v && !valor) setValor(paraInputLocal(atalhosDeAgendamento()[0]?.quando ?? new Date(Date.now() + 3_600_000)));
    setAberto(v);
  };

  // 17/09/2026: a seta colada no Enviar passava despercebida (pedido do
  // Alexandre); virou um botão Agendar visível, antes do Enviar
  return (
    <div className="flex items-center gap-2">
      <Popover open={aberto} onOpenChange={abrir}>
        <PopoverTrigger asChild>
          <Button variant="outline" disabled={desabilitado} className="gap-2">
            <CalendarClock className="h-4 w-4" />
            Agendar
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-[21rem] space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4" />
            Agendar envio
          </p>
          <EscolherHorario id="envio-agendar-para" valor={valor} onChange={setValor} horario={horario} />
          {problema && <p className="text-xs font-medium text-destructive">{problema}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAberto(false)}>
              Voltar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!quando || !!problemaDoHorario(quando) || enviando}
              onClick={async () => {
                if (!quando || problemaDoHorario(quando)) return;
                const ok = await onAgendar(quando);
                if (ok) {
                  setAberto(false);
                  setValor("");
                }
              }}
            >
              {quando ? `Agendar para ${format(quando, "dd/MM 'às' HH:mm")}` : "Agendar"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button onClick={onEnviar} disabled={desabilitado} className="gap-2">
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {enviando ? "Enviando..." : "Enviar"}
      </Button>
    </div>
  );
}
