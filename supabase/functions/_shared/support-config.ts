/**
 * Shared helper to fetch support configuration from public.configuracoes
 * per tenant, with safe defaults matching DB column defaults.
 */

export interface SupportConfig {
  // Atendimento lifecycle
  support_reopen_window_minutes: number;
  support_auto_close_inactivity_minutes: number;
  support_send_inactivity_warning: boolean;
  support_inactivity_warning_before_minutes: number;
  support_inactivity_warning_template: string;

  // CSAT
  support_csat_enabled: boolean;
  support_csat_prompt_template: string;
  support_csat_timeout_minutes: number;
  support_csat_score_min: number;
  support_csat_score_max: number;
  support_csat_reason_threshold: number;
  support_csat_reason_prompt_template: string;
  support_csat_thanks_template: string;

  // Legacy URA (support_areas based — kept for backward compat)
  support_ura_enabled: boolean;
  support_ura_welcome_template: string;
  support_ura_invalid_option_template: string;

  // URA v2 (department-based routing)
  ura_enabled: boolean;
  ura_welcome_template: string;
  ura_invalid_option_template: string;
  ura_timeout_minutes: number;
  ura_default_department_id: string | null;

  // Billing skip URA
  billing_skip_ura_enabled: boolean;
  billing_skip_ura_minutes: number;

  // Business Hours
  business_hours_enabled: boolean;
  business_hours: Record<string, { active: boolean; start: string; end: string }>;
  business_hours_timezone: string;
  business_hours_message: string | null;
  business_hours_ai_enabled: boolean;
  business_hours_ai_prompt: string | null;
  business_hours_outside_prompt: string | null;

  // On-call escalation
  oncall_phone_number: string | null;
  oncall_message_template: string | null;
  oncall_escalation_window_minutes: number;
  oncall_min_customer_messages: number;
  oncall_min_elapsed_seconds: number;
  oncall_repeat_cooldown_minutes: number;
  oncall_urgency_keywords: string[];
}

/** Defaults matching the DB column defaults exactly */
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
  support_ura_welcome_template:
    'Olá {{customer_name}}! 👋 Para te direcionar melhor, escolha uma opção:',
  support_ura_invalid_option_template:
    'Não entendi sua resposta 😅. Por favor, envie apenas o número de uma das opções acima.',

  // URA v2 defaults
  ura_enabled: false,
  ura_welcome_template:
    'Olá! 👋 Para te atender mais rápido, escolha um setor:\n{options}\n\nResponda apenas com o número. 😊',
  ura_invalid_option_template:
    'Não entendi sua opção 😅\nPor favor, responda com um número válido:\n{options}',
  ura_timeout_minutes: 2,
  ura_default_department_id: null,

  // Billing skip URA
  billing_skip_ura_enabled: true,
  billing_skip_ura_minutes: 60,

  // Business Hours
  business_hours_enabled: false,
  business_hours: {},
  business_hours_timezone: 'America/Sao_Paulo',
  business_hours_message: null,
  business_hours_ai_enabled: false,
  business_hours_ai_prompt: null,
  business_hours_outside_prompt: null,

  // On-call
  oncall_phone_number: null,
  oncall_message_template: null,
  oncall_escalation_window_minutes: 30,
  oncall_min_customer_messages: 3,
  oncall_min_elapsed_seconds: 60,
  oncall_repeat_cooldown_minutes: 360,
  oncall_urgency_keywords: [],
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
  // URA v2 fields
  'ura_enabled',
  'ura_welcome_template',
  'ura_invalid_option_template',
  'ura_timeout_minutes',
  'ura_default_department_id',
  // Billing skip URA
  'billing_skip_ura_enabled',
  'billing_skip_ura_minutes',
  // Business Hours
  'business_hours_enabled',
  'business_hours',
  'business_hours_timezone',
  'business_hours_message',
  'business_hours_ai_enabled',
  'business_hours_ai_prompt',
  'business_hours_outside_prompt',
  // On-call
  'oncall_phone_number',
  'oncall_message_template',
  'oncall_escalation_window_minutes',
  'oncall_min_customer_messages',
  'oncall_min_elapsed_seconds',
  'oncall_repeat_cooldown_minutes',
  'oncall_urgency_keywords',
].join(', ');

/**
 * Fetch the support config for a tenant. Returns safe defaults if
 * the row doesn't exist or any field is null.
 */
export async function getSupportConfig(
  supabase: any,
  tenantId: string
): Promise<SupportConfig> {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select(SELECT_FIELDS)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      console.error('[getSupportConfig] Error fetching config:', error.message);
      return { ...DEFAULTS };
    }

    if (!data) {
      console.warn(`[getSupportConfig] No config row for tenant=${tenantId}, using defaults`);
      return { ...DEFAULTS };
    }

    // Merge: use DB value if non-null, else default
    const merged: SupportConfig = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof SupportConfig)[]) {
      if (data[key] !== null && data[key] !== undefined) {
        (merged as any)[key] = data[key];
      }
    }

    // Ensure oncall_urgency_keywords is always an array
    if (!Array.isArray(merged.oncall_urgency_keywords)) {
      try {
        merged.oncall_urgency_keywords = typeof merged.oncall_urgency_keywords === 'string'
          ? JSON.parse(merged.oncall_urgency_keywords)
          : [];
      } catch {
        merged.oncall_urgency_keywords = [];
      }
    }

    return merged;
  } catch (err) {
    console.error('[getSupportConfig] Unexpected error:', err);
    return { ...DEFAULTS };
  }
}
