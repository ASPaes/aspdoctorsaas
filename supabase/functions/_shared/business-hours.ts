// _shared/business-hours.ts
// Fonte única da regra "estamos DENTRO do horário comercial AGORA?".
//
// Os helpers tzDayKey / tzDateStr / getBusinessHoursExceptions /
// resolveDepartmentBusinessHours são cópias fiéis (mesma lógica) das versões que
// já existem em message-processor.ts. Nesta FASE 1 do rollout a duplicação é
// intencional: message-processor segue com suas próprias cópias.
// FASE 2 (depois, testada à parte): message-processor passa a importar daqui e
// remove as duplicatas — aí vira fonte realmente única.

// ─── TZ helpers ───────────────────────────────────────────────────────────────

const WEEKDAY_KEYS: Record<string, string> = {
  Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat",
};

export function tzDateStr(date: Date, tz: string): string {
  // en-CA produz YYYY-MM-DD respeitando o timezone
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function tzDayKey(date: Date, tz: string): string {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return WEEKDAY_KEYS[wd] || "";
}

// ─── Exceções / feriados ──────────────────────────────────────────────────────

export interface HolidayTemplate {
  open_at: string;
  close_at: string;
  has_break: boolean;
  break_start: string | null;
  break_end: string | null;
}

export interface BusinessHoursExceptionsLookup {
  today: { name: string | null; is_closed: boolean; use_template: boolean } | null;
  closedDates: Set<string>;
  template: HolidayTemplate | null;
}

export async function getBusinessHoursExceptions(
  supabase: any,
  tenantId: string,
  msgDate: Date,
  tz: string,
  daysAhead: number = 14,
  departmentId: string | null = null,
): Promise<BusinessHoursExceptionsLookup> {
  try {
    const startStr = tzDateStr(msgDate, tz);
    const endStr = tzDateStr(new Date(msgDate.getTime() + daysAhead * 86400000), tz);

    let query = supabase
      .from("business_hours_exceptions")
      .select("date, name, is_closed, use_template, department_id")
      .eq("tenant_id", tenantId)
      .gte("date", startStr)
      .lte("date", endStr);

    // department-specific vence tenant-wide (department_id IS NULL)
    if (departmentId) {
      query = query.or(`department_id.is.null,department_id.eq.${departmentId}`);
    } else {
      query = query.is("department_id", null);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[business-hours] getBusinessHoursExceptions error:", error.message);
      return { today: null, closedDates: new Set(), template: null };
    }

    const closedDates = new Set<string>();
    let today: { name: string | null; is_closed: boolean; use_template: boolean } | null = null;

    // Agrupa por data. Para cada data, exceção do setor vence a tenant-wide.
    const byDate = new Map<string, any>();
    for (const row of (data || [])) {
      const existing = byDate.get(row.date);
      if (!existing || (row.department_id && !existing.department_id)) {
        byDate.set(row.date, row);
      }
    }

    for (const [dateKey, row] of byDate) {
      if (row.is_closed && !row.use_template) closedDates.add(dateKey);
      if (dateKey === startStr) {
        today = {
          name: row.name ?? null,
          is_closed: !!row.is_closed,
          use_template: !!row.use_template,
        };
      }
    }

    let template: HolidayTemplate | null = null;
    if (today?.use_template) {
      const { data: tpl, error: tplErr } = await supabase
        .from("tenant_holiday_template")
        .select("open_at, close_at, has_break, break_start, break_end")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (tplErr) {
        console.error("[business-hours] tenant_holiday_template error:", tplErr.message);
      } else if (tpl?.open_at && tpl?.close_at) {
        template = tpl as HolidayTemplate;
      }
    }

    return { today, closedDates, template };
  } catch (err) {
    console.error("[business-hours] getBusinessHoursExceptions unexpected:", err);
    return { today: null, closedDates: new Set(), template: null };
  }
}

// ─── Resolução de horário por setor (fallback global) ───────────────────────────

export interface DepartmentBusinessHoursResult {
  departmentId: string | null;
  departmentName: string | null;
  businessHoursEnabled: boolean;
  businessHours: Record<string, any>;
  businessHoursMessage: string | null;
}

export async function resolveDepartmentBusinessHours(
  supabase: any,
  conversationId: string | null,
  instanceId: string,
  tenantId: string,
  globalBusinessHours: Record<string, any>,
  globalMessage: string | null,
): Promise<DepartmentBusinessHoursResult> {
  try {
    let departmentId: string | null = null;
    let departmentName: string | null = null;

    // 1. department_id da conversa
    if (conversationId) {
      const { data: conv } = await supabase
        .from("whatsapp_conversations")
        .select("department_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (conv?.department_id) departmentId = conv.department_id;
    }

    // 2. Fallback: resolve via instância → setor padrão
    if (!departmentId) {
      const { data: dept } = await supabase
        .from("support_departments")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("default_instance_id", instanceId)
        .eq("is_active", true)
        .maybeSingle();
      if (dept?.id) departmentId = dept.id;
    }

    // 3. Achou setor → busca horário próprio
    if (departmentId) {
      const { data: deptData } = await supabase
        .from("support_departments")
        .select("name, business_hours_enabled, business_hours, business_hours_message")
        .eq("id", departmentId)
        .maybeSingle();

      if (deptData) {
        departmentName = deptData.name;
        if (deptData.business_hours_enabled) {
          return {
            departmentId,
            departmentName,
            businessHoursEnabled: true,
            businessHours: deptData.business_hours || {},
            businessHoursMessage: deptData.business_hours_message || globalMessage,
          };
        }
      }
    }

    // 4. Fallback: horário global do tenant
    return {
      departmentId,
      departmentName,
      businessHoursEnabled: false,
      businessHours: globalBusinessHours,
      businessHoursMessage: globalMessage,
    };
  } catch (err) {
    console.error("[business-hours] resolveDepartmentBusinessHours error:", err);
    return {
      departmentId: null,
      departmentName: null,
      businessHoursEnabled: false,
      businessHours: globalBusinessHours,
      businessHoursMessage: globalMessage,
    };
  }
}

// ─── Orquestrador: estamos dentro do horário AGORA? ─────────────────────────────

/**
 * Decide se, no instante `atDate`, o atendimento está DENTRO do horário comercial.
 * Respeita: horário por setor (fallback global), feriado fechado o dia todo,
 * feriado com template de horário reduzido (com intervalo), e timezone do tenant.
 *
 * NÃO captura exceções de propósito: quem chama decide a direção do fail-safe
 * (na inatividade, falha → "fora", para não fechar e punir o cliente).
 */
export async function isWithinBusinessHours(
  supabase: any,
  conversationId: string,
  instanceId: string,
  tenantId: string,
  supportConfig: any,
  atDate: Date = new Date(),
): Promise<boolean> {
  const tz = supportConfig.business_hours_timezone || "America/Sao_Paulo";

  const deptBH = await resolveDepartmentBusinessHours(
    supabase,
    conversationId,
    instanceId,
    tenantId,
    supportConfig.business_hours || {},
    supportConfig.business_hours_message || null,
  );
  const businessHours = deptBH.businessHours;

  const exc = await getBusinessHoursExceptions(supabase, tenantId, atDate, tz, 14, deptBH.departmentId);

  const dayKey = tzDayKey(atDate, tz);
  const tp = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(atDate);
  const currentTime =
    `${(tp.find((p) => p.type === "hour")?.value || "00").padStart(2, "0")}:` +
    `${(tp.find((p) => p.type === "minute")?.value || "00").padStart(2, "0")}`;

  // Feriado com horário reduzido (template): dentro da janela e fora do intervalo?
  if (exc.today?.use_template && exc.template) {
    const t = exc.template;
    const open = t.open_at.slice(0, 5);
    const close = t.close_at.slice(0, 5);
    const inTurn = currentTime >= open && currentTime < close;
    const inBreak = !!(
      t.has_break && t.break_start && t.break_end &&
      currentTime >= t.break_start.slice(0, 5) &&
      currentTime < t.break_end.slice(0, 5)
    );
    return inTurn && !inBreak;
  }

  // Feriado fechado o dia inteiro
  if (exc.today?.is_closed && !exc.today?.use_template) return false;

  // Dia normal: dentro de algum slot ativo?
  const dayConfig = businessHours[dayKey];
  const slots: { start: string; end: string }[] = (dayConfig?.slots || []).slice();
  if (dayConfig?.start && dayConfig?.end && slots.length === 0) {
    slots.push({ start: dayConfig.start, end: dayConfig.end });
  }
  return !!dayConfig?.active && slots.some((s) => currentTime >= s.start && currentTime <= s.end);
}
