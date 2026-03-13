import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Globe } from "lucide-react";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";

const TIMEZONE_OPTIONS = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { value: "America/Recife", label: "Recife (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
  { value: "America/New_York", label: "Nova York (GMT-5)" },
  { value: "Europe/Lisbon", label: "Lisboa (GMT+0)" },
  { value: "UTC", label: "UTC (GMT+0)" },
];

export function ChatTimezoneSelector() {
  const { timezone, updateTimezone } = useAppTimezone();
  const [selected, setSelected] = useState(timezone);
  const { effectiveTenantId: tid } = useTenantFilter();
  const { toast } = useToast();

  const { data: config } = useQuery({
    queryKey: ["configuracoes", tid],
    queryFn: async () => {
      let q = supabase.from("configuracoes").select("id");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q.limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setSelected(timezone);
  }, [timezone]);

  const handleSave = () => {
    if (!config?.id) return;
    updateTimezone.mutate(
      { configId: config.id, tz: selected },
      {
        onSuccess: () => toast({ title: "Fuso horário salvo!", description: `Configurado para ${selected}` }),
        onError: (err: any) => toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" }),
      }
    );
  };

  const isDirty = selected !== timezone;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Fuso Horário do Chat
        </CardTitle>
        <CardDescription>
          Define o fuso horário usado para exibir horários das mensagens e conversas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue placeholder="Selecione o fuso" />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONE_OPTIONS.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleSave} disabled={!isDirty || updateTimezone.isPending || !config?.id} size="sm">
          {updateTimezone.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          <Save className="h-4 w-4 mr-1" />
          Salvar
        </Button>
      </CardContent>
    </Card>
  );
}
