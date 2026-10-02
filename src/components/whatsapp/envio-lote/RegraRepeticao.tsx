// Campos da regra de envio recorrente (F4): todo dia X do mês, dias da semana
// ou todo dia útil, a hora e o que fazer quando cai em fim de semana/feriado.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { descreverRegra, type RegraRecorrencia } from "./useEnvioLoteExtras";

const DIAS = [
  { v: 1, r: "Seg" }, { v: 2, r: "Ter" }, { v: 3, r: "Qua" }, { v: 4, r: "Qui" },
  { v: 5, r: "Sex" }, { v: 6, r: "Sáb" }, { v: 0, r: "Dom" },
];

export const REGRA_PADRAO: RegraRecorrencia = { frequencia: "mensal", diaMes: 10, diasSemana: [1], hora: "09:00", ajuste: "proximo" };

export function regraValida(r: RegraRecorrencia) {
  if (!/^\d{2}:\d{2}$/.test(r.hora)) return false;
  if (r.frequencia === "mensal") return r.diaMes >= 1 && r.diaMes <= 31;
  if (r.frequencia === "semanal") return r.diasSemana.length > 0;
  return true;
}

export function RegraRepeticao({ regra, onChange }: { regra: RegraRecorrencia; onChange: (r: RegraRecorrencia) => void }) {
  const set = (p: Partial<RegraRecorrencia>) => onChange({ ...regra, ...p });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="block text-xs">Repetir</Label>
          <Select value={regra.frequencia} onValueChange={(v) => set({ frequencia: v as any })}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mensal">Todo mês</SelectItem>
              <SelectItem value="semanal">Toda semana</SelectItem>
              <SelectItem value="diaria">Todo dia útil</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {regra.frequencia === "mensal" && (
          <div className="space-y-1.5">
            <Label className="block text-xs">No dia</Label>
            <Select value={String(regra.diaMes)} onValueChange={(v) => set({ diaMes: Number(v) })}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <SelectItem key={d} value={String(d)}>Dia {d}</SelectItem>)}
                <SelectItem value="31">Último dia do mês</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {regra.frequencia === "semanal" && (
          <div className="space-y-1.5">
            <Label className="block text-xs">Nos dias</Label>
            <div className="flex gap-1">
              {DIAS.map((d) => {
                const on = regra.diasSemana.includes(d.v);
                return (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => set({ diasSemana: on ? regra.diasSemana.filter((x) => x !== d.v) : [...regra.diasSemana, d.v] })}
                    className={`h-9 w-11 rounded-md border text-xs font-semibold ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}
                    aria-pressed={on}
                  >
                    {d.r}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="block text-xs" htmlFor="rec-hora">Às</Label>
          <Input id="rec-hora" type="time" className="h-9 w-28" value={regra.hora} onChange={(e) => set({ hora: e.target.value })} />
        </div>
        {regra.frequencia !== "diaria" && (
          <div className="space-y-1.5">
            <Label className="block text-xs">Se cair em fim de semana ou feriado</Label>
            <Select value={regra.ajuste} onValueChange={(v) => set({ ajuste: v as any })}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="proximo">Vai para o próximo dia útil</SelectItem>
                <SelectItem value="anterior">Volta para o dia útil anterior</SelectItem>
                <SelectItem value="manter">Sai assim mesmo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {descreverRegra({ frequencia: regra.frequencia, dia_mes: regra.diaMes, dias_semana: regra.diasSemana, hora: regra.hora, ajuste_dia_util: regra.ajuste })}
        {" "}Feriado conta pela tela de Feriados (os gerais, marcados como fechado).
      </p>
    </div>
  );
}
