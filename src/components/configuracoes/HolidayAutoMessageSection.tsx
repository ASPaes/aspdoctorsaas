import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MessageSquare, Save } from "lucide-react";

type HolidayMessageMode = "auto" | "off_hours" | "custom";

interface HolidayMessageConfig {
  mode: HolidayMessageMode;
  message: string;
  offHoursMessage: string;
}

/** Espelha o defaultHolidayMessage da edge function (_shared/message-processor.ts). */
const EXEMPLO_PADRAO =
  "Boa tarde! 📅 Hoje é feriado (Independência do Brasil) e nosso atendimento está pausado.\n" +
  "Retornamos amanhã a partir das 07:30. Sua mensagem foi registrada e responderemos assim que voltarmos. 🙏";

const EXEMPLO_VARS: Record<string, string> = {
  greeting: "Boa tarde",
  holiday_name: "Independência do Brasil",
  next_start: "07:30",
  next_when: "amanhã a partir das 07:30",
  start: "08:00",
  end: "18:00",
  slot1_start: "08:00",
  slot1_end: "12:00",
  slot2_start: "13:00",
  slot2_end: "18:00",
};

function preencherExemplo(texto: string): string {
  return texto.replace(/\{\{(\w+)\}\}/g, (achado, chave: string) => EXEMPLO_VARS[chave] ?? achado);
}

/**
 * DEM-0370: qual mensagem automática sai quando o cliente escreve num feriado
 * fechado o dia todo.
 *
 * Query própria, fora do select da aba: se as colunas ainda não existirem no
 * banco, só este bloco some, em vez de derrubar a lista de feriados junto.
 */
function useHolidayMessageConfig() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<HolidayMessageConfig>({
    queryKey: ["business-hours-exceptions", tid, "holiday-message"],
    enabled: !!tid,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes") as any)
        .select("business_hours_holiday_message_mode, business_hours_holiday_message, business_hours_message")
        .eq("tenant_id", tid!)
        .maybeSingle();
      if (error) throw error;
      const bruto = data?.business_hours_holiday_message_mode;
      return {
        mode: bruto === "off_hours" || bruto === "custom" ? bruto : "auto",
        message: (data?.business_hours_holiday_message as string | null) ?? "",
        offHoursMessage: (data?.business_hours_message as string | null) ?? "",
      };
    },
  });
}

export default function HolidayAutoMessageSection() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useHolidayMessageConfig();

  const [mode, setMode] = useState<HolidayMessageMode>("auto");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!data) return;
    setMode(data.mode);
    setMessage(data.message);
  }, [data]);

  const salvar = useMutation({
    mutationFn: async () => {
      const texto = message.trim();
      if (mode === "custom" && !texto) throw new Error("Escreva a mensagem de feriado.");
      const { error } = await (supabase.from("configuracoes") as any)
        .update({
          business_hours_holiday_message_mode: mode,
          business_hours_holiday_message: texto || null,
        })
        .eq("tenant_id", tid!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-hours-exceptions", tid, "holiday-message"] });
      qc.invalidateQueries({ queryKey: ["support-config", tid] });
      toast({ title: "Mensagem de feriado salva!" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  const previa = useMemo(() => {
    if (mode === "custom") return message.trim() ? preencherExemplo(message) : "";
    if (mode === "off_hours") return data?.offHoursMessage ? preencherExemplo(data.offHoursMessage) : "";
    return EXEMPLO_PADRAO;
  }, [mode, message, data?.offHoursMessage]);

  const semTextoDeForaDoHorario = mode === "off_hours" && !data?.offHoursMessage;

  // Coluna ainda não existe no banco: esconder é melhor que mostrar um campo
  // que não salva. O resto da seção de feriados continua funcionando.
  if (isError) return null;

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary shrink-0" />
        <span className="font-medium text-sm">Mensagem automática em feriados</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Texto enviado ao cliente que escreve num dia marcado como "Fechado o dia todo", e também
        no "Horário reduzido" quando ele escreve fora da janela do dia. Dia "Aberto normalmente"
        segue a grade semanal e a mensagem de fora do horário.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="holiday-msg-mode">Qual mensagem enviar</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as HolidayMessageMode)}>
              <SelectTrigger id="holiday-msg-mode" className="w-full sm:w-[320px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Padrão da plataforma</SelectItem>
                <SelectItem value="off_hours">A mesma de "Fora do horário"</SelectItem>
                <SelectItem value="custom">Mensagem própria de feriado</SelectItem>
              </SelectContent>
            </Select>
            {mode === "auto" && (
              <p className="text-xs text-muted-foreground">
                Avisa que o atendimento está pausado e informa o horário de retorno. Com IA de
                atendimento configurada, o texto sai reescrito a cada contato.
              </p>
            )}
            {mode === "off_hours" && (
              <p className="text-xs text-muted-foreground">
                Usa o mesmo texto da "Mensagem fora do horário", inclusive a do setor quando ele
                tem uma própria. Atenção: se ela cita o horário de funcionamento, o cliente lê o
                horário de um dia em que não há atendimento.
              </p>
            )}
          </div>

          {semTextoDeForaDoHorario && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
              <span className="text-amber-400 text-base leading-none mt-0.5">⚠️</span>
              <p className="text-xs text-amber-300">
                A mensagem de fora do horário está vazia. Enquanto estiver assim, o feriado
                continua usando o texto padrão da plataforma. Preencha em Disponibilidade de
                atendimento.
              </p>
            </div>
          )}

          {mode === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="holiday-msg-text">Mensagem de feriado</Label>
              <Textarea
                id="holiday-msg-text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Bom dia! Hoje é {{holiday_name}} e estamos de sobreaviso. Se for urgente, é só responder aqui que um técnico atende."
              />
              <p className="text-xs text-muted-foreground">
                Campos que a plataforma preenche:{" "}
                <code className="text-xs">{"{{greeting}}"}</code>{" "}
                <code className="text-xs">{"{{holiday_name}}"}</code>{" "}
                <code className="text-xs">{"{{next_start}}"}</code>{" "}
                <code className="text-xs">{"{{next_when}}"}</code>
              </p>
            </div>
          )}

          {previa && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Prévia</Label>
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap">
                {previa}
              </div>
            </div>
          )}

          <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar mensagem
          </Button>
        </>
      )}
    </div>
  );
}
