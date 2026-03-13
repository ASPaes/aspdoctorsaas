import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

/** Support config type (mirrors DB columns + defaults) */
export interface SupportConfig {
  support_reopen_window_minutes: number;
  support_auto_close_inactivity_minutes: number;
  support_send_inactivity_warning: boolean;
  support_inactivity_warning_before_minutes: number;
  support_inactivity_warning_template: string;
  support_csat_enabled: boolean;
  support_csat_prompt_template: string;
  support_csat_timeout_minutes: number;
  support_csat_score_min: number;
  support_csat_score_max: number;
  support_csat_reason_threshold: number;
  support_csat_reason_prompt_template: string;
  support_csat_thanks_template: string;
  support_ura_enabled: boolean;
  support_ura_welcome_template: string;
  support_ura_invalid_option_template: string;
}

const DEFAULTS: SupportConfig = {
  support_reopen_window_minutes: 10,
  support_auto_close_inactivity_minutes: 30,
  support_send_inactivity_warning: true,
  support_inactivity_warning_before_minutes: 5,
  support_inactivity_warning_template:
    '⚠️ Por falta de interação, este atendimento será encerrado em {{minutes}} minutos. Se ainda precisar de ajuda, responda esta mensagem.',
  support_csat_enabled: true,
  support_csat_prompt_template:
    'Oi {{customer_name}}, para encerrar este atendimento é muito importante entender como foi sua experiência. De 0 a 5, como você avalia este atendimento? (Responda apenas a nota)',
  support_csat_timeout_minutes: 5,
  support_csat_score_min: 0,
  support_csat_score_max: 5,
  support_csat_reason_threshold: 3,
  support_csat_reason_prompt_template: 'Entendi. Pode me dizer em poucas palavras o motivo da sua nota?',
  support_csat_thanks_template: 'Obrigado! ✅ Sua avaliação foi registrada.',
  support_ura_enabled: false,
  support_ura_welcome_template: 'Olá {{customer_name}}! 👋 Para te direcionar melhor, escolha uma opção:',
  support_ura_invalid_option_template: 'Não entendi sua resposta 😅. Por favor, envie apenas o número de uma das opções acima.',
};

const SELECT_FIELDS = [
  'support_reopen_window_minutes',
  'support_auto_close_inactivity_minutes',
  'support_send_inactivity_warning',
  'support_inactivity_warning_before_minutes',
  'support_inactivity_warning_template',
  'support_csat_enabled',
  'support_csat_prompt_template',
  'support_csat_timeout_minutes',
  'support_csat_score_min',
  'support_csat_score_max',
  'support_csat_reason_threshold',
  'support_csat_reason_prompt_template',
  'support_csat_thanks_template',
  'support_ura_enabled',
  'support_ura_welcome_template',
  'support_ura_invalid_option_template',
].join(', ');

/**
 * Hook to fetch support configuration for the current tenant.
 * Caches for 60s (staleTime) to avoid redundant fetches.
 */
export function useSupportConfig() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<SupportConfig>({
    queryKey: ['support-config', tid],
    enabled: !!tid,
    staleTime: 60_000, // 60 seconds
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracoes')
        .select(SELECT_FIELDS)
        .eq('tenant_id', tid!)
        .maybeSingle();

      if (error) {
        console.error('[useSupportConfig] fetch error:', error.message);
        return { ...DEFAULTS };
      }

      if (!data) return { ...DEFAULTS };

      // Merge: DB values win over defaults when non-null
      const merged: SupportConfig = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS) as (keyof SupportConfig)[]) {
        if (data[key as keyof typeof data] !== null && data[key as keyof typeof data] !== undefined) {
          (merged as any)[key] = data[key as keyof typeof data];
        }
      }
      return merged;
    },
  });
}
