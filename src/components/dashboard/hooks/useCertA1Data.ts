import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, subDays } from 'date-fns';

interface CertA1Metrics {
  vendasQtd: number;
  faturamento: number;
  oportunidadesJanela: number;
  oportunidadesVencendo: number;
  oportunidadesVencidas: number;
}

export function useCertA1Data(periodoInicio: Date | null, periodoFim: Date | null) {
  const periodoInicioStr = periodoInicio ? format(periodoInicio, 'yyyy-MM-dd') : null;
  const periodoFimStr = periodoFim ? format(periodoFim, 'yyyy-MM-dd') : null;

  return useQuery({
    queryKey: ['cert-a1-metrics', periodoInicioStr, periodoFimStr],
    queryFn: async (): Promise<CertA1Metrics> => {
      // 1. Vendas no período
      let vendasQuery = supabase.from('certificado_a1_vendas').select('valor_venda');
      if (periodoInicioStr && periodoFimStr) {
        vendasQuery = vendasQuery.gte('data_venda', periodoInicioStr).lte('data_venda', periodoFimStr);
      }
      const { data: vendas } = await vendasQuery;
      const vendasQtd = vendas?.length || 0;
      const faturamento = vendas?.reduce((sum, v) => sum + (Number(v.valor_venda) || 0), 0) || 0;

      // 2. Oportunidades rolling (based on TODAY)
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const minus20Str = format(subDays(today, 20), 'yyyy-MM-dd');
      const plus30Str = format(addDays(today, 30), 'yyyy-MM-dd');

      const { data: certClientes } = await supabase
        .from('clientes')
        .select('id, cert_a1_vencimento')
        .eq('cancelado', false)
        .not('cert_a1_vencimento', 'is', null)
        .gte('cert_a1_vencimento', minus20Str)
        .lte('cert_a1_vencimento', plus30Str);

      const oportunidadesJanela = certClientes?.length || 0;
      const oportunidadesVencendo = certClientes?.filter(c => c.cert_a1_vencimento! >= todayStr && c.cert_a1_vencimento! <= plus30Str).length || 0;
      const oportunidadesVencidas = certClientes?.filter(c => c.cert_a1_vencimento! >= minus20Str && c.cert_a1_vencimento! < todayStr).length || 0;

      return { vendasQtd, faturamento, oportunidadesJanela, oportunidadesVencendo, oportunidadesVencidas };
    },
    staleTime: 5 * 60 * 1000,
  });
}
