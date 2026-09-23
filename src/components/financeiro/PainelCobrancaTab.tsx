import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, TrendingDown, Wallet, Clock, UserX } from 'lucide-react';
import {
  useFinTitulosAbertos,
  useFinSyncEstado,
  useFinTitulos,
  FAIXAS_ATRASO,
} from '@/hooks/useFinTitulos';

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtQuando = (iso: string | null) => {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
};

/** Plural simples, para a tela não dizer "1 títulos". */
const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

const ORIGEM_LABEL: Record<string, string> = {
  omie: 'Omie',
  asaas: 'Asaas',
  flyerp: 'FlyERP',
  manual: 'Lançado à mão',
};

function KpiCard({
  label,
  valor,
  detalhe,
  icone,
  tom = 'neutro',
}: {
  label: string;
  valor: string;
  detalhe: string;
  icone: React.ReactNode;
  tom?: 'neutro' | 'bom' | 'alerta' | 'ruim';
}) {
  const cor = {
    neutro: 'text-foreground',
    bom: 'text-primary',
    alerta: 'text-amber-600 dark:text-amber-400',
    ruim: 'text-destructive',
  }[tom];

  return (
    <Card className="p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icone}</span>
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${cor}`}>{valor}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{detalhe}</div>
    </Card>
  );
}

export default function PainelCobrancaTab() {
  const { data: abertos = [], isLoading } = useFinTitulosAbertos();
  const { data: estados = [] } = useFinSyncEstado();
  // Títulos sem vínculo de cliente: enquanto não casam, não podem ser cobrados.
  const { data: semCliente = [] } = useFinTitulos({
    situacoes: ['atrasado', 'vence_hoje', 'a_vencer'],
    busca: '',
    venceDe: null,
    venceAte: null,
    semCliente: true,
  });

  const resumo = useMemo(() => {
    const vencidos = abertos.filter((t) => t.situacao === 'atrasado' || (t.vencido && t.situacao !== 'a_vencer'));
    const aVencer = abertos.filter((t) => !vencidos.includes(t));
    const soma = (arr: typeof abertos) => arr.reduce((s, t) => s + t.valor, 0);

    const faixas = FAIXAS_ATRASO.map((f) => {
      const itens = vencidos.filter((t) => t.dias_atraso >= f.de && t.dias_atraso <= f.ate);
      return { ...f, qtd: itens.length, valor: soma(itens) };
    });
    const maiorFaixa = Math.max(1, ...faixas.map((f) => f.valor));

    const clientesVencidos = new Set(vencidos.map((t) => t.cliente_id ?? 'sem-vinculo'));
    const semBoleto = vencidos.filter((t) => !t.boleto_gerado);

    return {
      vencidoQtd: vencidos.length,
      vencidoValor: soma(vencidos),
      aVencerQtd: aVencer.length,
      aVencerValor: soma(aVencer),
      clientesVencidos: clientesVencidos.size,
      faixas,
      maiorFaixa,
      maisAntigo: vencidos.reduce((max, t) => Math.max(max, t.dias_atraso), 0),
      semBoleto: semBoleto.length,
      risco: faixas.find((f) => f.chave === '60+'),
    };
  }, [abertos]);

  const leituraVelha = estados.some(
    (e) => !e.ultima_leitura_ok || Date.now() - new Date(e.ultima_leitura_ok).getTime() > 12 * 3600 * 1000,
  );

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  if (estados.length === 0) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Nenhuma origem de cobrança conectada para esta empresa. O painel fica vazio até o primeiro
          sincronismo de títulos.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {leituraVelha && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Os títulos não são lidos da origem há mais de 12 horas. Os números abaixo podem estar
            desatualizados, e nenhuma cobrança deve ser disparada assim.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Vencido em aberto"
          valor={fmtBRL(resumo.vencidoValor)}
          detalhe={`${plural(resumo.vencidoQtd, "título", "títulos")} · ${plural(resumo.clientesVencidos, "cliente", "clientes")}`}
          icone={<TrendingDown className="h-4 w-4" />}
          tom="ruim"
        />
        <KpiCard
          label="A vencer"
          valor={fmtBRL(resumo.aVencerValor)}
          detalhe={plural(resumo.aVencerQtd, "título", "títulos")}
          icone={<Wallet className="h-4 w-4" />}
        />
        <KpiCard
          label="Atraso mais antigo"
          valor={plural(resumo.maisAntigo, "dia", "dias")}
          detalhe={
            resumo.risco && resumo.risco.qtd > 0
              ? resumo.risco.qtd === 1
                ? '1 título passou de 60 dias'
                : `${resumo.risco.qtd} títulos passaram de 60 dias`
              : 'nenhum título passou de 60 dias'
          }
          icone={<Clock className="h-4 w-4" />}
          tom={resumo.maisAntigo > 60 ? 'ruim' : resumo.maisAntigo > 30 ? 'alerta' : 'bom'}
        />
        <KpiCard
          label="Sem cliente vinculado"
          valor={String(semCliente.length)}
          detalhe="não podem ser cobrados"
          icone={<UserX className="h-4 w-4" />}
          tom={semCliente.length > 0 ? 'alerta' : 'bom'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Vencidos por faixa de atraso</h3>
            <span className="text-xs text-muted-foreground">valor em aberto</span>
          </div>
          <div className="mt-3 space-y-3">
            {resumo.faixas.map((f) => (
              <div key={f.chave} className="grid grid-cols-[92px_1fr_auto] items-center gap-3 text-xs">
                <span className="text-muted-foreground">{f.label}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive/80 transition-[width] duration-500"
                    style={{ width: `${Math.round((f.valor / resumo.maiorFaixa) * 100)}%` }}
                  />
                </div>
                <span className="tabular-nums font-medium">
                  {fmtBRL(f.valor)}
                  <span className="ml-1 text-muted-foreground">({f.qtd})</span>
                </span>
              </div>
            ))}
            {resumo.vencidoQtd === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum título vencido em aberto.</p>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold">Origem dos títulos</h3>
          <div className="mt-3 space-y-3">
            {estados.map((e) => {
              const velha =
                !e.ultima_leitura_ok ||
                Date.now() - new Date(e.ultima_leitura_ok).getTime() > 12 * 3600 * 1000;
              return (
                <div key={e.origem} className="flex items-start justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{ORIGEM_LABEL[e.origem] ?? e.origem}</span>
                      <Badge variant={velha ? 'destructive' : 'secondary'} className="text-[10px]">
                        {velha ? 'leitura atrasada' : 'em dia'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Última leitura {fmtQuando(e.ultima_leitura_ok)}
                      {e.titulos_lidos ? ` · ${e.titulos_lidos} títulos` : ''}
                    </p>
                    {e.ultimo_erro && (
                      <p className="mt-1 text-xs text-destructive">{e.ultimo_erro}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            O painel só conta título que a origem confirmou na última leitura. Título que o sistema de
            origem deixou de devolver fica de fora, para não cobrar por documento já excluído lá.
            {resumo.semBoleto > 0 && (
              <>
                {' '}
                Hoje, <strong className="text-foreground">{resumo.semBoleto}</strong> títulos vencidos
                não têm boleto gerado na origem.
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
