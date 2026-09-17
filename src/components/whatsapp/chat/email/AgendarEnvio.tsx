import { useState } from "react";
import { CalendarClock, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ConfigHorario } from "@/lib/businessHours";
import { EscolherHorario, descreverHorario, lerHorario, problemaDoHorario } from "./EscolherHorario";

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

  // abre vazio: com "Amanhã, 08:00" já preenchido, quem ajustava só o dia e os
  // minutos deixava a hora 08 sem perceber (e-mail de 00:31 saiu marcado 08:31)
  const abrir = (v: boolean) => {
    if (v) setValor("");
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAberto(false)}>
              Voltar
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
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
              {quando && !problemaDoHorario(quando) ? `Agendar para ${descreverHorario(quando)}` : "Agendar"}
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
