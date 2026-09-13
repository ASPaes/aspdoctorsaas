import { cn } from '@/lib/utils';

interface Props {
  /** `clientes.data_cancelamento` (date, "YYYY-MM-DD"). */
  dataCancelamento?: string | null;
  className?: string;
}

/**
 * Selo de cliente sem contrato ativo (`clientes.cancelado`).
 * DEM-0394: a busca de vínculo do chat passou a trazer esses clientes, e o
 * operador precisa ver que está vinculando alguém que saiu. Vincular não reativa.
 */
export function ClienteEncerradoBadge({ dataCancelamento, className }: Props) {
  // Data sem hora: formata pela string para não andar um dia com o fuso.
  const desde = dataCancelamento?.slice(0, 10).split('-').reverse().join('/');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400 whitespace-nowrap',
        className,
      )}
      title={desde ? `Contrato encerrado em ${desde}. Vincular não reativa o cliente.` : 'Vincular não reativa o cliente.'}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
      Contrato encerrado
    </span>
  );
}
