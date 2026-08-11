import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DemandTypeLite = { id: string; nome: string; cor: string };

/**
 * Rótulo do badge. Cabe em ~110px: vazio = "Todas"; um tipo mostra o nome;
 * dois ou mais viram contagem — concatenar nomes de 21 caracteres truncaria os dois.
 * O detalhe completo fica no tooltip e dentro do popover.
 */
export function resumoDemandas(nomes: string[]): string {
  if (nomes.length === 0) return "Todas";
  if (nomes.length === 1) return nomes[0];
  return `${nomes.length} demandas`;
}

export function ChecklistGroupDemandPicker({
  demandTypes, selectedIds, onToggle,
}: {
  demandTypes: DemandTypeLite[];
  selectedIds: string[];
  onToggle: (demandTypeId: string, on: boolean) => void;
}) {
  const selecionados = demandTypes.filter((d) => selectedIds.includes(d.id));
  const vinculado = selecionados.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={vinculado
            ? `Aparece só nestas demandas: ${selecionados.map((d) => d.nome).join(", ")}`
            : "Aparece em qualquer tipo de demanda"}
          className="shrink-0 min-w-0"
        >
          <Badge
            variant="outline"
            className={`h-4 px-1.5 text-[10px] font-normal max-w-[110px] truncate block ${
              vinculado ? "" : "border-dashed text-muted-foreground"
            }`}
            style={vinculado
              ? { borderColor: selecionados[0].cor, color: selecionados[0].cor }
              : undefined}
          >
            {resumoDemandas(selecionados.map((d) => d.nome))}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide px-1 pb-1.5">
          Tipos de demanda
        </p>
        {demandTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 py-2">Nenhum tipo cadastrado.</p>
        ) : (
          <div className="space-y-0.5">
            {demandTypes.map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.includes(d.id)}
                  onCheckedChange={(v) => onToggle(d.id, v === true)}
                />
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.cor }} />
                <span className="text-xs truncate">{d.nome}</span>
              </label>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground px-1 pt-2 mt-1 border-t border-border">
          Sem nenhum marcado, o checklist aparece em qualquer demanda.
        </p>
      </PopoverContent>
    </Popover>
  );
}
