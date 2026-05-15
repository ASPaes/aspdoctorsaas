// Helper: verifica se um contato/telefone está com "regras do sistema" desabilitadas.
// Quando true, qualquer automação (URA, CSAT, inatividade, lembretes, auto-reply, finalização)
// deve ser ignorada para esse número, em qualquer instância do mesmo tenant.

const FN = "[rules-disabled]";

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return String(phone).replace(/\D/g, "");
}

/**
 * Retorna true se o contato (por phone_number + tenant_id) tiver rules_disabled=true.
 * Em caso de erro, retorna false (fail-open) e loga — para não travar o fluxo principal.
 */
export async function isRulesDisabled(
  supabase: any,
  params: {
    tenantId?: string | null;
    phoneNumber?: string | null;
    contactId?: string | null;
  },
): Promise<boolean> {
  try {
    const { tenantId, phoneNumber, contactId } = params;

    // Caminho 1: lookup direto por contact_id
    if (contactId) {
      const { data, error } = await supabase
        .from("whatsapp_contacts")
        .select("rules_disabled")
        .eq("id", contactId)
        .maybeSingle();
      if (!error && data?.rules_disabled === true) return true;
      if (!error && data?.rules_disabled === false && !phoneNumber) return false;
    }

    if (!tenantId || !phoneNumber) return false;

    const normalized = normalizePhone(phoneNumber);
    if (!normalized) return false;

    // Caminho 2: por tenant + phone (qualquer instância). Trigger propaga, basta achar 1.
    const { data, error } = await supabase
      .from("whatsapp_contacts")
      .select("rules_disabled, phone_number")
      .eq("tenant_id", tenantId)
      .eq("rules_disabled", true)
      .limit(50);

    if (error) {
      console.warn(`${FN} lookup error:`, error.message);
      return false;
    }

    if (!data || data.length === 0) return false;

    return data.some((c: any) => normalizePhone(c.phone_number) === normalized);
  } catch (e: any) {
    console.warn(`${FN} unexpected error:`, e?.message ?? e);
    return false;
  }
}
