import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, FileText, X } from 'lucide-react';
import { useFinTitulos, FIN_SITUACAO_LABEL, type FinSituacao } from '@/hooks/useFinTitulos';
import BotaoBoleto from './BotaoBoleto';

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtData = (iso: string | null) => {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

const SITUACOES: FinSituacao[] = ['atrasado', 'vence_hoje', 'a_vencer', 'pago', 'cancelado'];

const TOM_SITUACAO: Record<FinSituacao, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  atrasado: 'destructive',
  vence_hoje: 'default',
  a_vencer: 'secondary',
  pago: 'outline',
  parcial: 'secondary',
  cancelado: 'outline',
  desconhecida: 'destructive',
};

export default function TitulosTab() {
  const [busca, setBusca] = useState('');
  const [situacoes, setSituacoes] = useState<FinSituacao[]>(['atrasado', 'vence_hoje', 'a_vencer']);
  const [semCliente, setSemCliente] = useState(false);

  const { data: titulos = [], isLoading } = useFinTitulos({
    situacoes,
    busca,
    venceDe: null,
    venceAte: null,
    semCliente,
  });

  const total = useMemo(() => titulos.reduce((s, t) => s + t.valor, 0), [titulos]);
  const alternar = (s: FinSituacao) =>
    setSituacoes((atual) => (atual.includes(s) ? atual.filter((x) => x !== s) : [...atual, s]));

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="fin-busca"
              placeholder="Cliente, documento ou CNPJ"
              className="pl-8"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {busca && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0.5 top-0.5 h-8 w-8"
                onClick={() => setBusca('')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {SITUACOES.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={situacoes.includes(s) ? 'default' : 'outline'}
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => alternar(s)}
              >
                {FIN_SITUACAO_LABEL[s]}
              </Button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              id="fin-sem-cliente"
              checked={semCliente}
              onCheckedChange={(v) => setSemCliente(v === true)}
            />
            Só sem cliente vinculado
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b p-3">
          <h3 className="text-sm font-semibold">
            {isLoading ? 'Carregando títulos' : `${titulos.length} títulos`}
          </h3>
          <span className="text-sm tabular-nums text-muted-foreground">
            Soma do que está na lista: <strong className="text-foreground">{fmtBRL(total)}</strong>
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : titulos.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nenhum título com esses filtros.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Cobrança</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {titulos.slice(0, 300).map((t) => {
                  const nome = t.clientes?.nome_fantasia || t.clientes?.razao_social;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {fmtData(t.vencimento)}
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        {nome ? (
                          <span className="block truncate">{nome}</span>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            sem vínculo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {[t.numero_documento, t.parcela].filter(Boolean).join(' · ') || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {fmtBRL(t.valor)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={TOM_SITUACAO[t.situacao]} className="text-[10px]">
                          {FIN_SITUACAO_LABEL[t.situacao]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {t.boleto_gerado ? (
                            <BotaoBoleto tituloId={t.id} boletoGerado compacto />
                          ) : (
                            <span>sem boleto</span>
                          )}
                          {t.link_nfse && (
                            <span className="flex items-center gap-1">
                              <FileText className="h-3.5 w-3.5" />
                              nota
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {titulos.length > 300 && (
              <p className="border-t p-3 text-center text-xs text-muted-foreground">
                Mostrando os 300 primeiros. Use a busca ou os filtros para chegar no que procura.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
