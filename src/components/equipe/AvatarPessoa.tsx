import { cn } from "@/lib/utils";
import { COR_PRESENCA, corDoUsuario, iniciais, presencaDe } from "./equipeUtils";
import type { Pessoa } from "./tipos";

interface Props {
  userId: string | null;
  nome?: string | null;
  pessoa?: Pessoa;
  tamanho?: "xs" | "sm" | "md";
  comPresenca?: boolean;
  /** cor do anel da bolinha: o fundo por trás do avatar */
  anel?: string;
  className?: string;
}

const TAM = { xs: "h-5 w-5 text-[9px] rounded", sm: "h-7 w-7 text-[10px] rounded-md", md: "h-9 w-9 text-xs rounded-lg" };
const PONTO = { xs: "h-2 w-2", sm: "h-2.5 w-2.5", md: "h-3 w-3" };

export function AvatarPessoa({ userId, nome, pessoa, tamanho = "md", comPresenca, anel = "ring-background", className }: Props) {
  const n = nome ?? pessoa?.nome ?? "";
  const { tom, texto } = presencaDe(pessoa);
  return (
    <span className={cn("relative inline-flex shrink-0", className)} title={comPresenca ? `${n} · ${texto}` : n}>
      <span
        className={cn("grid place-items-center font-semibold text-white select-none", TAM[tamanho])}
        style={{ backgroundColor: corDoUsuario(userId) }}
      >
        {/* no tamanho mínimo duas letras não cabem */}
        {tamanho === "xs" ? iniciais(n).slice(0, 1) : iniciais(n)}
      </span>
      {comPresenca && (
        <span className={cn("absolute -bottom-0.5 -right-0.5 rounded-full ring-2", PONTO[tamanho], COR_PRESENCA[tom], anel)} />
      )}
    </span>
  );
}
