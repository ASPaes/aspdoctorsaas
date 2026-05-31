import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ConselhoAbaTemplate {
  tab_key: string;
  display_label: string;
  prompt_principal: string;
  output_format_prompt: string;
  custo_estimado_brl: number;
  max_tokens: number;
  contexto_objetivo: string | null;
  personas_sugeridas_default: string[];
}

export function useConselhoAbaTemplate(tenantId: string | null, tabKey: string, enabled = true) {
  return useQuery({
    queryKey: ['conselho-aba-template', tenantId, tabKey],
    enabled: !!tenantId && !!tabKey && enabled,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_conselho_aba_template', {
        p_tenant_id: tenantId!,
        p_tab_key: tabKey,
      });
      if (error) throw error;
      return (data?.[0] as ConselhoAbaTemplate) ?? null;
    },
  });
}
