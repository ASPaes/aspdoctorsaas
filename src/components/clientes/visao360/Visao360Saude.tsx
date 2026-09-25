import { useNavigate } from "react-router-dom";
import { HelpCircle, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FAIXAS_SAUDE, FATORES_SAUDE, type calcularSaude } from "./visao360Calc";

type Saude = ReturnType<typeof calcularSaude>;

const corDaNota = (n: number) => (n >= 70 ? "#22C55E" : n >= 50 ? "#F59E0B" : "#EF4444");

/** Anel + fatores no topo escuro da Visão 360°. */
export function SaudeDoCliente({ saude, podeAjustar, personalizado }: { saude: Saude; podeAjustar: boolean; personalizado: boolean }) {
  const navigate = useNavigate();
  const R = 44, C = 2 * Math.PI * R;
  const ativos = saude.fatores.filter((f) => f.aplica);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="relative h-[104px] w-[104px] flex-none">
        <svg viewBox="0 0 104 104" className="-rotate-90">
          <defs>
            <linearGradient id="v360-anel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={saude.faixa.cor} />
              <stop offset="1" stopColor={saude.nota >= 70 ? "#0EA5E9" : saude.faixa.cor} />
            </linearGradient>
          </defs>
          <circle cx="52" cy="52" r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="10" />
          <circle
            cx="52" cy="52" r={R} fill="none" stroke="url(#v360-anel)" strokeWidth="10" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - saude.nota / 100)}
            className="transition-[stroke-dashoffset] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-3xl font-extrabold leading-none text-white tabular-nums">{saude.nota}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: saude.faixa.cor }}>{saude.faixa.rotulo}</div>
          </div>
        </div>
      </div>

      <div className="min-w-[200px] flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Saúde do cliente
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Como a nota é calculada" className="rounded-full text-slate-400 transition-colors hover:text-white">
                <HelpCircle className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(440px,calc(100vw-32px))] p-0">
              <div className="border-b px-4 py-3">
                <div className="text-sm font-bold">Como a nota é calculada</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cada fator vale de 0 a 100 e pesa uma parte da nota final. A conta usa sempre os últimos 90 dias e 12 meses, não o período escolhido na tela.
                </p>
              </div>
              <ul className="max-h-[50vh] divide-y overflow-y-auto">
                {saude.fatores.map((f) => {
                  const regra = FATORES_SAUDE.find((x) => x.chave === f.chave)?.regra;
                  return (
                    <li key={f.chave} className={cn("px-4 py-2.5", !f.aplica && "opacity-60")}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <b>{f.rotulo}</b>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {f.aplica ? <>peso {f.pesoEfetivo}% · <b className="tabular-nums text-foreground" style={{ color: corDaNota(f.nota) }}>{f.nota}</b></> : "fora da conta"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs font-medium">{f.detalhe}</p>
                      {regra && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{regra}</p>}
                    </li>
                  );
                })}
              </ul>
              <div className="border-t px-4 py-3">
                <div className="flex h-2 overflow-hidden rounded-full">
                  {FAIXAS_SAUDE.map((f) => <span key={f.rotulo} style={{ width: `${f.ate - f.de + 1}%`, background: f.cor }} />)}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  {FAIXAS_SAUDE.map((f) => <span key={f.rotulo}>{f.de} a {f.ate}: {f.rotulo}</span>)}
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{personalizado ? "Pesos definidos pela sua empresa." : "Pesos padrão da plataforma."}</span>
                  {podeAjustar && (
                    <button type="button" onClick={() => navigate("/configuracoes?section=saude-cliente")} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                      <Settings2 className="h-3.5 w-3.5" />Ajustar pesos
                    </button>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="grid gap-1.5">
          {ativos.map((f) => (
            <div key={f.chave} className="grid grid-cols-[84px_1fr_26px] items-center gap-2 text-xs text-slate-400" title={f.detalhe}>
              <span>{f.rotulo}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <span className="block h-full rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${f.nota}%`, background: corDaNota(f.nota) }} />
              </span>
              <b className="text-right tabular-nums text-white">{f.nota}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
