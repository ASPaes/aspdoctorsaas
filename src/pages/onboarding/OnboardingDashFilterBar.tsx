import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/atendimento/MultiSelectFilter";
import type { FiltroDash } from "./dashFilters";
import type { OpcaoFiltro } from "./useOnboardingDashFilters";

interface Props {
  filtro: FiltroDash;
  setFiltro: (f: FiltroDash) => void;
  limpar: () => void;
  ativo: boolean;
  opcoes: {
    pipelines: OpcaoFiltro[];
    demandTypes: OpcaoFiltro[];
    responsaveis: OpcaoFiltro[];
    participantes: OpcaoFiltro[];
  };
}

export default function OnboardingDashFilterBar({ filtro, setFiltro, limpar, ativo, opcoes }: Props) {
  const set = (k: keyof FiltroDash) => (ids: string[]) => setFiltro({ ...filtro, [k]: ids });

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <MultiSelectFilter<string>
        label="Pipeline"
        options={opcoes.pipelines}
        selected={filtro.pipelineIds}
        onChange={set("pipelineIds")}
        className="min-w-[150px]"
      />
      <MultiSelectFilter<string>
        label="Responsável"
        options={opcoes.responsaveis}
        selected={filtro.responsavelIds}
        onChange={set("responsavelIds")}
        className="min-w-[150px]"
      />
      <MultiSelectFilter<string>
        label="Participante"
        options={opcoes.participantes}
        selected={filtro.participanteIds}
        onChange={set("participanteIds")}
        className="min-w-[150px]"
      />
      <MultiSelectFilter<string>
        label="Tipo de demanda"
        options={opcoes.demandTypes}
        selected={filtro.demandTypeIds}
        onChange={set("demandTypeIds")}
        className="min-w-[150px]"
      />
      {ativo && (
        <Button variant="ghost" size="sm" onClick={limpar} className="text-muted-foreground gap-1">
          <X className="h-3.5 w-3.5" /> Limpar
        </Button>
      )}
    </div>
  );
}
