import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FAIXAS_NOTA, MIN_ENCERRADOS, type Nota360 } from "./colaborador360Calc";

const corDaNota = (n: number) => (n >= 80 ? "#22C55E" : n >= 60 ? "#0EA5E9" : n >= 40 ? "#F59E0B" : "#EF4444");

/** Anel + fatores no topo escuro da Visão 360° do colaborador. */
export function NotaDoColaborador({ nota, comparacao }: { nota: Nota360; comparacao: string | null }) {
  const R = 47, C = 2 * Math.PI * R;
  const valor = nota.nota ?? 0;
  const ativos = nota.fatores.filter((f) => f.nota != null);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="relative h-[112px] w-[112px] flex-none">
        <svg viewBox="0 0 112 112" className="-rotate-90">
          <defs>
            <linearGradient id="c360-anel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={nota.faixa?.cor ?? "#64748B"} />
              <stop offset="1" stopColor={valor >= 80 ? "#0EA5E9" : nota.faixa?.cor ?? "#64748B"} />
            </linearGradient>
          </defs>
          <circle cx="56" cy="56" r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="10" />
          {nota.nota != null && (
            <circle
              cx="56" cy="56" r={R} fill="none" stroke="url(#c360-anel)" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - valor / 100)}
              className="transition-[stroke-dashoffset] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          {nota.nota != null ? (
            <div>
              <div className="text-[32px] font-extrabold leading-none text-white tabular-nums">{nota.nota}</div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: nota.faixa?.cor }}>{nota.faixa?.rotulo}</div>
            </div>
          ) : (
            <div className="px-3 text-[11px] font-semibold leading-tight text-slate-400">Sem nota no período</div>
          )}
        </div>
      </div>

      <div className="min-w-[210px] flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Nota de desempenho
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
                  Cada fator vai de 0 a 100 e mostra quantos colegas do grupo a pessoa iguala ou supera naquele ponto. 100 é o melhor do grupo.
                  A nota final soma os fatores pelo peso. Fator sem dado sai da conta e o peso dele passa para os outros.
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Grupo: o setor da pessoa. Setor com menos de 3 pessoas com nota compara com a empresa toda.
                  Precisa de pelo menos {MIN_ENCERRADOS} atendimentos encerrados no período.
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Satisfação só conta com 3 avaliações ou mais. Resolução e Qualidade só contam quando a IA analisou
                  pelo menos 10 atendimentos e metade dos encerrados.
                </p>
              </div>
              <ul className="max-h-[50vh] divide-y overflow-y-auto">
                {nota.fatores.map((f) => (
                  <li key={f.chave} className={cn("px-4 py-2.5", f.nota == null && "opacity-60")}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <b>{f.rotulo}</b>
                      <span className="text-xs text-muted-foreground">
                        {f.nota != null
                          ? <>peso {f.pesoEfetivo}% · <b className="tabular-nums" style={{ color: corDaNota(f.nota) }}>{f.nota}</b></>
                          : "fora da conta"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">{f.regra}</p>
                  </li>
                ))}
              </ul>
              <div className="border-t px-4 py-3">
                <div className="flex h-2 overflow-hidden rounded-full">
                  {[...FAIXAS_NOTA].reverse().map((f) => <span key={f.rotulo} style={{ width: `${f.ate - f.de + 1}%`, background: f.cor }} />)}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  {FAIXAS_NOTA.map((f) => <span key={f.rotulo}>{f.de} a {f.ate}: {f.rotulo}</span>)}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {ativos.length ? (
          <div className="grid gap-1.5">
            {ativos.map((f) => (
              <div key={f.chave} className="grid grid-cols-[92px_1fr_26px] items-center gap-2 text-xs text-slate-400" title={f.regra}>
                <span>{f.rotulo}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${f.nota}%`, background: corDaNota(f.nota!) }} />
                </span>
                <b className="text-right tabular-nums text-white">{f.nota}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Menos de {MIN_ENCERRADOS} atendimentos encerrados no período. Amplie o período para ver a nota.</p>
        )}
        {comparacao && <p className="mt-2 text-[11.5px] text-slate-400">{comparacao}</p>}
      </div>
    </div>
  );
}
