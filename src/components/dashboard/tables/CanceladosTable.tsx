import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { CanceladoListItem } from '../types';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

interface Props {
  items: CanceladoListItem[];
  tvMode: boolean;
}

export function CanceladosTable({ items, tvMode }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={tvMode ? 'text-xl' : 'text-base'}>
          Clientes Cancelados no Período ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nenhum cancelamento no período selecionado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="text-center">Dias Ativo</TableHead>
                <TableHead>Data Cancel.</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Vlr Mensal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div>
                      <span className="font-medium text-foreground">{c.razaoSocial}</span>
                      {c.nomeFantasia && (
                        <span className="block text-xs text-muted-foreground">{c.nomeFantasia}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span>{c.diasAtivo !== null ? c.diasAtivo : '—'}</span>
                      {c.earlyChurn && (
                        <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30 text-[10px] px-1.5 py-0">
                          Early
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{format(new Date(c.dataCancelamento), 'dd/MM/yyyy')}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={c.motivo}>{c.motivo}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(c.mensalidade)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
