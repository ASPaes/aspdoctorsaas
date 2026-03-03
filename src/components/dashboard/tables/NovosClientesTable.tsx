import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import type { NovoClienteListItem } from '../types';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

interface Props {
  items: NovoClienteListItem[];
  tvMode: boolean;
}

export function NovosClientesTable({ items, tvMode }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={tvMode ? 'text-xl' : 'text-base'}>
          Novos Clientes no Período ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nenhum novo cliente no período selecionado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Data Venda</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Vlr Ativação</TableHead>
                <TableHead className="text-right">Vlr MRR</TableHead>
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
                  <TableCell>{c.dataVenda ? format(new Date(c.dataVenda), 'dd/MM/yyyy') : '—'}</TableCell>
                  <TableCell>{c.vendedor}</TableCell>
                  <TableCell className="max-w-[150px] truncate" title={c.origem}>{c.origem}</TableCell>
                  <TableCell className="text-right">{fmt(c.valorAtivacao)}</TableCell>
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
