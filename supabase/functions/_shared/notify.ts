export async function notifyEvent(supabase: any, tenantId: string, eventType: string, dedupeKey: string, title: string, body: string, metadata: Record<string, unknown> = {}) {
  try {
    const { data, error } = await supabase.rpc("notify_event", { p_tenant_id: tenantId, p_event_type: eventType, p_dedupe_key: dedupeKey, p_title: title, p_body: body, p_metadata: metadata });
    if (error) console.error("[notify] rpc error:", error.message);
    return data ?? null;
  } catch (e) { console.error("[notify] exception:", e); return null; }
}

export async function resolveIncident(supabase: any, tenantId: string, eventType: string, dedupeKey: string) {
  try { await supabase.rpc("resolve_notification_incident", { p_tenant_id: tenantId, p_event_type: eventType, p_dedupe_key: dedupeKey }); } catch (e) { console.error("[notify] resolve exception:", e); }
}
