import type { CatalogEntry } from "./types";

export const atendimento: CatalogEntry[] = [
  {
    id: "at.volume_total",
    area: "atendimento",
    kind: "card",
    label: "Total de atendimentos",
    helpKey: "atendimento_volume_total",
    format: "integer",
    source: { provider: "atendimento.volume", path: "total" },
  },
  {
    id: "at.volume_novos",
    area: "atendimento",
    kind: "card",
    label: "Clientes novos",
    helpKey: "atendimento_novos_recorrentes",
    format: "integer",
    source: { provider: "atendimento.volume", path: "novos" },
  },
  {
    id: "at.volume_recorrentes",
    area: "atendimento",
    kind: "card",
    label: "Clientes recorrentes",
    helpKey: "atendimento_novos_recorrentes",
    format: "integer",
    source: { provider: "atendimento.volume", path: "recorrentes" },
  },
];
