import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, Receipt } from 'lucide-react';
import { useFinanceiroAccess } from '@/hooks/useFinanceiroAccess';
import { useFinTitulosDoCliente, FIN_SITUACAO_LABEL, type FinSituacao } from '@/hooks/useFinTitulos';
import BotaoBoleto from './BotaoBoleto';

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtData = (iso: string | null) => {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

const TOM: Record<FinSituacao, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  atrasado: 'destructive',
  vence_hoje: 'default',
  a_vencer: 'secondary',
  pago: 'outline',
  parcial: 'secondary',
  cancelado: 'outline',
  desconhecida: 'destructive',
};

const EM_ABERTO: FinSituacao[] = ['atrasado', 'vence_hoje', 'a_vencer'];

// A ficha abre sempre recolhida: só as primeiras linhas, o resto sob demanda.
const LINHAS_RECOLHIDO = 3;

/**
 * Títulos do cliente dentro da ficha. Some por completo para quem não tem acesso
 * ao módulo, então pode ser montado na aba Financeiro sem nenhum outro cuidado.
 */
export default function TitulosDoClienteCard({ clienteId }: { clienteId?: string }) {
  const { canAccess } = useFinanceiroAccess();
  const { data: titulos = [], isLoading } = useFinTitulosDoCliente(canAccess ? clienteId : null);
  const [expandido, setExpandido] = useState(false);

  const resumo = useMemo(() => {
    const abertos = titulos.filter((t) => EM_ABERTO.includes(t.situacao));
    const vencidos = abertos.filter((t) => t.situacao === 'atrasado');
    return {
      abertoValor: abertos.reduce((s, t) => s + t.valor, 0),
      abertoQtd: abertos.length,
      vencidoValor: vencidos.reduce((s, t) => s + t.valor, 0),
      vencidoQtd: vencidos.length,
    };
  }, [titulos]);

  // O que interessa na ficha é o que está em aberto: vem primeiro, do mais
  // antigo para o mais novo. O histórico já pago vem depois, do mais recente.
  // Sem isso a lista abria com parcelas de 2027 já pagas, que não dizem nada.
  const ordenados = useMemo(() => {
    const abertos = titulos
      .filter((t) => EM_ABERTO.includes(t.situacao))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const resto = titulos
      .filter((t) => !EM_ABERTO.includes(t.situacao))
      .sort((a, b) => b.vencimento.localeCompare(a.vencimento));
    return [...abertos, ...resto];
  }, [titulos]);
  if (!canAccess || !clienteId) return null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          Títulos a receber
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            Em aberto: <strong className="text-foreground tabular-nums">{fmtBRL(resumo.abertoValor)}</strong>
          </span>
          {resumo.vencidoQtd > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {resumo.vencidoQtd} vencido{resumo.vencidoQtd > 1 ? 's' : ''} · {fmtBRL(resumo.vencidoValor)}
            </Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : titulos.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nenhum título deste cliente veio do sistema de cobrança. Pode ser que o título exista lá sem
          vínculo com este cadastro.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="w-[110px] pb-2 font-medium">Vencimento</th>
                <th className="pb-2 font-medium">Documento</th>
                <th className="w-[120px] pb-2 font-medium">Situação</th>
                <th className="w-[110px] pb-2 pr-1 text-right font-medium">Valor</th>
                <th className="w-[90px] pb-2" />
              </tr>
            </thead>
            <tbody>
              {(expandido ? ordenados : ordenados.slice(0, LINHAS_RECOLHIDO)).map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="py-1.5 tabular-nums">{fmtData(t.vencimento)}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">
                    {[t.numero_documento, t.parcela].filter(Boolean).join(' · ') || '-'}
                  </td>
                  <td className="py-1.5">
                    <Badge variant={TOM[t.situacao]} className="text-[10px]">
                      {FIN_SITUACAO_LABEL[t.situacao]}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-1 text-right tabular-nums">{fmtBRL(t.valor)}</td>
                  <td className="py-1.5 text-right">
                    <BotaoBoleto tituloId={t.id} boletoGerado={t.boleto_gerado} compacto />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ordenados.length > LINHAS_RECOLHIDO && (
            <button
              type="button"
              onClick={() => setExpandido((v) => !v)}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandido ? 'rotate-180' : ''}`} />
              {expandido
                ? 'Recolher'
                : `Ver todos os ${ordenados.length} títulos (+${ordenados.length - LINHAS_RECOLHIDO})`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
