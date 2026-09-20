import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Lock, MapPin, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ACAO_LABEL, RECURSOS_SEM_PORTAO,
  type Acao, type RbacRecurso,
} from "@/hooks/useRbacConfig";

const LETRA: Record<Acao, string> = { view: "V", insert: "I", update: "E", delete: "X" };

interface ChipProps {
  acao: Acao;
  ligado: boolean;
  /** A ação existe neste recurso? Se não, o chip aparece apagado — a linha fica alinhada. */
  existe: boolean;
  travado?: boolean;
  desabilitado?: boolean;
  rotulo: string;
  onChange: (valor: boolean) => void;
}

/** Chip V / I / E / X do desenho aprovado. Excluir liga em vermelho. */
export function ChipAcao({ acao, ligado, existe, travado, desabilitado, rotulo, onChange }: ChipProps) {
  const inativo = !existe || travado || desabilitado;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={existe && ligado}
          aria-label={`${ACAO_LABEL[acao]} — ${rotulo}`}
          disabled={inativo}
          onClick={() => onChange(!ligado)}
          className={cn(
            "relative inline-flex h-6 w-[26px] items-center justify-center rounded-md border text-[10.5px] font-bold transition-colors",
            !existe && "cursor-not-allowed border-border bg-transparent text-muted-foreground/25",
            existe && !ligado && "border-border bg-background text-muted-foreground hover:border-foreground/40",
            existe && ligado && acao !== "delete" && "border-emerald-500 bg-emerald-500 text-white",
            existe && ligado && acao === "delete" && "border-red-500 bg-red-500 text-white",
            existe && (travado || desabilitado) && "cursor-not-allowed opacity-70",
          )}
        >
          {LETRA[acao]}
          {travado && <Lock className="absolute -right-1 -top-1 h-2.5 w-2.5 text-muted-foreground" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {existe ? ACAO_LABEL[acao] : `${ACAO_LABEL[acao]} não existe neste item`}
        {travado && " · anti-lockout: o perfil de administração nunca perde isto"}
      </TooltipContent>
    </Tooltip>
  );
}

interface Props {
  r: RbacRecurso;
  estado?: Record<Acao, boolean>;
  acoesVisiveis: Acao[];
  /** A entrada do módulo está ligada? Se não, nada aqui dentro é alcançável. */
  alcancavel: boolean;
  travada: (acao: Acao) => boolean;
  mostrarChave: boolean;
  onAcao: (acao: Acao, valor: boolean) => void;
}

export default function LinhaRecurso({
  r, estado, acoesVisiveis, alcancavel, travada, mostrarChave, onAcao,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const semPortao = RECURSOS_SEM_PORTAO.has(r.key);

  return (
    <div className={cn(
      "flex items-center gap-3 border-t px-3 py-2 transition-colors hover:bg-muted/40",
      !alcancavel && "pointer-events-none opacity-40",
    )}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="shrink-0 self-start rounded p-0.5 pt-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`O que faz: ${r.label}`}
        aria-expanded={aberto}
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
          {r.label}
          {semPortao && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 rounded border border-dashed border-amber-500 px-1.5 py-px text-[10px] font-normal text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> ainda não aplicado
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Este item já está no catálogo, mas nenhuma tela o consulta ainda.
                Mexer aqui não muda o acesso de ninguém até a entrega que o liga.
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        {/* O caminho responde "onde eu acho isso?" — a chave técnica não. */}
        {r.caminho && (
          <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0 opacity-60" />
            {r.caminho}
          </span>
        )}
        {aberto && r.descricao && (
          <p className="mt-1 max-w-prose text-[11.5px] leading-snug text-muted-foreground">{r.descricao}</p>
        )}
        {mostrarChave && <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground/70">{r.key}</span>}
      </div>

      <div className="flex shrink-0 items-center gap-[3px]">
        {acoesVisiveis.map((acao) => (
          <ChipAcao
            key={acao}
            acao={acao}
            existe={r.acoes.includes(acao)}
            ligado={!!estado?.[acao]}
            travado={travada(acao)}
            desabilitado={!alcancavel}
            rotulo={r.label}
            onChange={(v) => onAcao(acao, v)}
          />
        ))}
      </div>
    </div>
  );
}
