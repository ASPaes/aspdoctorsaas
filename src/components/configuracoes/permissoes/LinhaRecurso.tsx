import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Lock, MapPin, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ACAO_LABEL, ESCOPO_LABEL, RECURSOS_SEM_PORTAO,
  type Acao, type Escopo, type RbacRecurso,
} from "@/hooks/useRbacConfig";

interface Props {
  r: RbacRecurso;
  estado?: Record<Acao, boolean> & { escopo: Escopo };
  acoesVisiveis: Acao[];
  mostraEscopo: boolean;
  /** A entrada do módulo está ligada? Se não, nada aqui dentro é alcançável. */
  alcancavel: boolean;
  travada: (acao: Acao) => boolean;
  mostrarChave: boolean;
  onAcao: (acao: Acao, valor: boolean) => void;
  onEscopo: (escopo: Escopo) => void;
}

export default function LinhaRecurso({
  r, estado, acoesVisiveis, mostraEscopo, alcancavel, travada, mostrarChave, onAcao, onEscopo,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const semPortao = RECURSOS_SEM_PORTAO.has(r.key);

  return (
    <div className={cn("flex items-start gap-3 border-t px-3 py-2", !alcancavel && "opacity-40")}>
      <button
        onClick={() => setAberto((v) => !v)}
        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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

      <div className="flex shrink-0 items-center gap-1">
        {acoesVisiveis.map((acao) => {
          const existe = r.acoes.includes(acao);
          const lock = travada(acao);
          if (!existe) {
            return <span key={acao} className="inline-flex h-6 w-7 items-center justify-center text-[10px] text-muted-foreground/30">–</span>;
          }
          return (
            <Tooltip key={acao}>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <Switch
                    checked={!!estado?.[acao]}
                    disabled={lock || !alcancavel}
                    onCheckedChange={(v) => onAcao(acao, v)}
                    aria-label={`${ACAO_LABEL[acao]} — ${r.label}`}
                    className="scale-[.8]"
                  />
                  {lock && <Lock className="ml-0.5 h-3 w-3 text-muted-foreground" />}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {ACAO_LABEL[acao]}
                {lock && " · anti-lockout: o grupo de administração nunca perde isto"}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {mostraEscopo && (
        <div className="w-44 shrink-0">
          {r.escopo_aplicavel ? (
            <Select
              value={estado?.escopo ?? "todos"}
              disabled={!estado?.view || !alcancavel}
              onValueChange={(v) => onEscopo(v as Escopo)}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {r.escopos_validos.map((e) => (
                  <SelectItem key={e} value={e} className="text-xs">{ESCOPO_LABEL[e]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block text-center text-xs text-muted-foreground/50">—</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Este item não tem linhas para filtrar: ou é uma ação única, ou é um
                ajuste que vale para a empresa inteira.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
