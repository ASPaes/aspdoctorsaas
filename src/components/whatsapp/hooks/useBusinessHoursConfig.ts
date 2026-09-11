// Horário comercial do tenant, para o aviso de agendamento fora do expediente.
// Só leitura; a regra de verdade continua em `fn_is_business_hours` no banco,
// que decide distribuição. Aqui é aviso de tela.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { parseBusinessHours } from "@/components/configuracoes/WeeklyScheduleGrid";
import type { ConfigHorario } from "@/lib/businessHours";

export function useBusinessHoursConfig() {
  const { effectiveTenantId } = useTenantFilter();

  const { data } = useQuery<ConfigHorario | null>({
    queryKey: ["business-hours-config", effectiveTenantId],
    enabled: !!effectiveTenantId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: cfg, error } = await supabase
        .from("configuracoes")
        .select("business_hours_enabled, business_hours, business_hours_timezone")
        .eq("tenant_id", effectiveTenantId!)
        .maybeSingle();

      if (error || !cfg) return null;

      // Feriados dos próximos 60 dias. Só os fechados interessam: o dia com
      // horário diferente continua sendo tratado pela agenda semanal.
      const hoje = new Date().toISOString().slice(0, 10);
      const limite = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: excecoes } = await supabase
        .from("business_hours_exceptions")
        .select("date, is_closed")
        .eq("tenant_id", effectiveTenantId!)
        .gte("date", hoje)
        .lte("date", limite);

      const fechados = new Set<string>(
        (excecoes || []).filter((e: any) => e.is_closed).map((e: any) => String(e.date)),
      );

      return {
        enabled: !!(cfg as any).business_hours_enabled,
        timezone: (cfg as any).business_hours_timezone || "America/Sao_Paulo",
        schedule: parseBusinessHours((cfg as any).business_hours),
        fechados,
      };
    },
  });

  return data ?? null;
}
