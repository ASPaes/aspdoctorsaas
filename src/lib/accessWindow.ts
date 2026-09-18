import { supabase } from "@/integrations/supabase/client";

/**
 * DEM-0415: horário de acesso. A regra e o cálculo moram no banco
 * (`get_my_access_window`); aqui só lemos e formatamos.
 */

export interface AccessInterval {
  start: string; // "07:20"
  end: string; // "20:15" ou "24:00"
  days: number[]; // 0=dom ... 6=sáb
}

export interface AccessWindow {
  restricted: boolean;
  origin?: "exempt" | "user" | "department" | "none";
  /** dentro de um intervalo agora (o login usa só isto) */
  allowed?: boolean;
  /** fora do intervalo, mas dentro da tolerância do que acabou */
  in_grace?: boolean;
  ends_at?: string | null;
  /** quando a sessão aberta cai: fim do intervalo + tolerância */
  kick_at?: string | null;
  next_start_at?: string | null;
  server_now: string;
  schedule_name?: string;
  timezone?: string;
  intervals?: AccessInterval[];
  warn_before_minutes?: number | null;
  grace_minutes?: number;
  release_queue_on_end?: boolean;
}

export async function fetchMyAccessWindow(): Promise<AccessWindow | null> {
  const { data, error } = await (supabase.rpc as any)("get_my_access_window");
  if (error) {
    // Falha de leitura não tranca ninguém para fora: o padrão é permissivo.
    console.error("[access-window]", error);
    return null;
  }
  return data as AccessWindow;
}

/** Bloqueia o login? Só quando há regra e a pessoa está fora do intervalo. */
export function isOutsideWindow(w: AccessWindow | null): boolean {
  return !!w && w.restricted && w.allowed === false;
}

export const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LONGOS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export const FUSOS_BR: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "São Paulo / Brasília (UTC−3)" },
  { value: "America/Manaus", label: "Manaus (UTC−4)" },
  { value: "America/Cuiaba", label: "Cuiabá (UTC−4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (UTC−5)" },
  { value: "America/Noronha", label: "Fernando de Noronha (UTC−2)" },
];

/** "Seg–Sex", "Sáb", "Seg, Qua, Sex" */
export function resumirDias(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return "Todos os dias";
  const contiguo = d.length >= 3 && d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  if (contiguo) return `${DIAS_CURTOS[d[0]]}–${DIAS_CURTOS[d[d.length - 1]]}`;
  return d.map((x) => DIAS_CURTOS[x]).join(", ");
}

/** Uma linha por intervalo: "Seg–Sex 07:20–20:15" */
export function resumirIntervalos(intervals: AccessInterval[] | undefined): string[] {
  return (intervals ?? []).map((iv) => `${resumirDias(iv.days)} ${iv.start}–${iv.end}`);
}

/** "sexta, 19/09 às 07:20", no fuso da regra */
export function formatarProximoAcesso(iso: string | null | undefined, tz = "America/Sao_Paulo"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const dowEn = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dowEn);
  return `${DIAS_LONGOS[dow]}, ${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

/** "20:15", no fuso da regra */
export function formatarHora(iso: string | null | undefined, tz = "America/Sao_Paulo"): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/**
 * Recado para a tela de login depois que a sessão caiu por horário. Passa por
 * sessionStorage porque o signOut desmonta tudo e o AuthGuard redireciona
 * sozinho para /login.
 */
export const ACCESS_ENDED_KEY = "access-window-ended";

export interface AccessEndedNotice {
  released: number;
  next_start_at: string | null;
  timezone: string;
  intervals: AccessInterval[];
}
