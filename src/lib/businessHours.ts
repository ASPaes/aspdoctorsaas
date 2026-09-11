// Horário comercial do tenant no navegador.
//
// A fonte é a mesma do banco: `configuracoes.business_hours` (+ `_enabled`,
// `_timezone`) e os feriados de `business_hours_exceptions`. A função
// `fn_is_business_hours` responde só sobre AGORA; aqui a pergunta é sobre uma
// data futura ("o que o operador escolheu cai no expediente?"), e a resposta é
// um aviso de tela, nunca um bloqueio — por isso vive no frontend e não virou
// uma segunda versão da regra dentro do Postgres.
//
// Sem DST no Brasil desde 2019, mas o cálculo de fuso está feito direito
// mesmo assim: o tenant pode configurar outro timezone.
import type { BusinessHours } from "@/components/configuracoes/WeeklyScheduleGrid";

export const DIAS: string[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface ConfigHorario {
  enabled: boolean;
  timezone: string;
  schedule: BusinessHours;
  /** Datas fechadas (feriado), no formato YYYY-MM-DD do fuso do tenant. */
  fechados: Set<string>;
}

/** Quanto o fuso do tenant está deslocado do UTC naquele instante, em ms. */
function deslocamento(tz: string, quando: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const parte of fmt.formatToParts(quando)) p[parte.type] = parte.value;
  const comoUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return comoUtc - quando.getTime();
}

/** Relógio de parede no fuso do tenant: dia da semana, data e minutos do dia. */
export function relogioDoTenant(quando: Date, tz: string) {
  const desloc = deslocamento(tz, quando);
  const local = new Date(quando.getTime() + desloc);
  return {
    diaSemana: DIAS[local.getUTCDay()],
    data: `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`,
    minutos: local.getUTCHours() * 60 + local.getUTCMinutes(),
    ano: local.getUTCFullYear(),
    mes: local.getUTCMonth() + 1,
    dia: local.getUTCDate(),
  };
}

/** Hora de parede do tenant -> instante real. Duas passadas resolvem virada de fuso. */
function instanteDoTenant(ano: number, mes: number, dia: number, minutos: number, tz: string): Date {
  const palpite = Date.UTC(ano, mes - 1, dia, Math.floor(minutos / 60), minutos % 60, 0);
  let d = new Date(palpite - deslocamento(tz, new Date(palpite)));
  d = new Date(palpite - deslocamento(tz, d));
  return d;
}

function minutosDe(hhmm: string): number {
  const [h, m] = String(hhmm || "").split(":");
  return Number(h) * 60 + Number(m || 0);
}

/** Slots válidos do dia, em minutos, ordenados. Dia inativo ou fechado = vazio. */
function slotsDoDia(cfg: ConfigHorario, diaSemana: string, data: string): Array<{ ini: number; fim: number }> {
  if (cfg.fechados.has(data)) return [];
  const dia = cfg.schedule?.[diaSemana];
  if (!dia?.active) return [];
  return (dia.slots || [])
    .filter((s) => s?.start && s?.end)
    .map((s) => ({ ini: minutosDe(s.start), fim: minutosDe(s.end) }))
    .filter((s) => s.fim > s.ini)
    .sort((a, b) => a.ini - b.ini);
}

/**
 * A data escolhida cai dentro do expediente?
 * Sem horário configurado (ou desligado) o tenant é 24/7 — mesma leitura da
 * `fn_is_business_hours`, que devolve `true` nesse caso.
 */
export function dentroDoHorario(quando: Date, cfg: ConfigHorario | null): boolean {
  if (!cfg?.enabled || !cfg.schedule || Object.keys(cfg.schedule).length === 0) return true;
  const r = relogioDoTenant(quando, cfg.timezone);
  return slotsDoDia(cfg, r.diaSemana, r.data).some((s) => r.minutos >= s.ini && r.minutos < s.fim);
}

/**
 * Primeiro instante de expediente a partir de `depois`. Varre 14 dias; se o
 * tenant não abre em nenhum deles (agenda toda inativa), devolve null e a tela
 * simplesmente não oferece o atalho.
 */
export function proximoHorarioUtil(depois: Date, cfg: ConfigHorario | null): Date | null {
  if (!cfg?.enabled) return null;

  for (let salto = 0; salto < 14; salto++) {
    const alvo = new Date(depois.getTime() + salto * 24 * 60 * 60 * 1000);
    const r = relogioDoTenant(alvo, cfg.timezone);
    const slots = slotsDoDia(cfg, r.diaSemana, r.data);

    for (const slot of slots) {
      // No primeiro dia só serve slot que ainda vai começar; nos seguintes,
      // o dia inteiro está à frente.
      const inicio = salto === 0 ? Math.max(slot.ini, r.minutos) : slot.ini;
      if (inicio < slot.fim) {
        return instanteDoTenant(r.ano, r.mes, r.dia, inicio, cfg.timezone);
      }
    }
  }
  return null;
}
