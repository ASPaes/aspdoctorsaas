import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import type { DownsellListItem } from '../types';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface Props {
  items: DownsellListItem[];
  tvMode: boolean;
}

export function DownsellTable({ items, tvMode }: Props) {
  const total = items.reduce((s, d) => s + d.valor, 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={tvMode ? 'text-xl' : 'text-base'}>
          Downsells no Período ({items.length}) · {fmt(total)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nenhum downsell no período selecionado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Valor Reduzido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d, i) => (
                <TableRow key={`${d.clienteId}-${i}`}>
                  <TableCell className="font-medium text-foreground">{d.cliente}</TableCell>
                  <TableCell>
                    {d.data ? format(parseISO(d.data), 'dd/MM/yyyy') : '—'}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate" title={d.descricao}>{d.descricao}</TableCell>
                  <TableCell className="text-right font-medium text-orange-600 dark:text-orange-400">
                    −{fmt(d.valor)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
