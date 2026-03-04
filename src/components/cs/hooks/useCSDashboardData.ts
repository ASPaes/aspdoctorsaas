import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { differenceInHours, differenceInDays, parseISO, isWithinInterval, endOfDay, subDays } from 'date-fns';
import type { CSTicket, CSTicketStatus, CSTicketPrioridade, CSIndicacaoStatus } from '../types';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

export interface CSDashboardFilters {
  periodoInicio: Date;
  periodoFim: Date;
  ownerId?: number;
}

export interface CSDashboardData {
  ticketsAbertos: number;
  ticketsFechados: number;
  backlogPorStatus: Record<CSTicketStatus, number>;
  backlogPorPrioridade: Record<CSTicketPrioridade, number>;
  vencendoSlaAcao: CSTicket[];
  vencendoSlaConclusao: CSTicket[];
  vencidosSlaAcao: CSTicket[];
  vencidosSlaConclusao: CSTicket[];
  tempoAteAcaoMedia: number;
  tempoAteAcaoMediana: number;
  tempoAteConclusaoMedia: number;
  tempoAteConclusaoMediana: number;
  percentHigiene: number;
  reaberturas: number;
  clientesEmRisco: number;
  ticketsRiscoPorPrioridade: Record<CSTicketPrioridade, number>;
  percentRiscoComPlano: number;
  mrrEmRisco: number;
  mrrRecuperado: number;
  resultadoRisco: { retido: number; naoRetido: number; monitoramento: number };
  pipelineIndicacao: Record<CSIndicacaoStatus, number>;
  indicacoesPorOwner: { owner_id: number; nome: string; count: number }[];
  indicacoesGanhas: number;
  indicacoesPerdidas: number;
  indicacoesConversaoPercent: number;
  indicacoesTotalMovimentados: number;
  topPrioridades: CSTicket[];
  allTickets: CSTicket[];
  ticketsIndicacaoDetalhados: CSTicket[];
  // Oportunidades
  oportunidadesAbertas: number;
  oportunidadesGanhas: number;
  oportunidadesPerdidas: number;
  oportunidadesConversaoPercent: number;
  oportunidadesValorPrevistoAtivacao: number;
  oportunidadesValorPrevistoMrr: number;
  oportunidadesValorGanhoAtivacao: number;
  oportunidadesValorGanhoMrr: number;
  oportunidadesAbertasLista: CSTicket[];
  // Cobertura 90D
  cobertura90d: {
    totalAtivos: number;
    cobertos: number;
    descobertos: number;
    percentCoberto: number;
    clientesDescobertos: {
      id: string;
      razao_social: string | null;
      nome_fantasia: string | null;
      mensalidade: number | null;
      ultimoContato: string | null;
      diasSemContato: number | null;
      data_cadastro: string | null;
      cnpj: string | null;
      fornecedor_nome: string | null;
    }[];
  };
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function useCSDashboardData(filters: CSDashboardFilters) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq('tenant_id', tid) : q;
  return useQuery({
    queryKey: ['cs-dashboard-data', filters.periodoInicio.toISOString(), filters.periodoFim.toISOString(), filters.ownerId, tid],
    queryFn: async (): Promise<CSDashboardData> => {
      const now = new Date();

      let ticketsQuery = tf(supabase
        .from('cs_tickets')
        .select(`
          *,
          cliente:clientes!cs_tickets_cliente_id_fkey (
            id, razao_social, nome_fantasia, mensalidade, cancelado
          ),
          owner:funcionarios!cs_tickets_owner_id_fkey (
            id, nome, cargo, ativo
          )
        `));

      if (filters.ownerId) {
        ticketsQuery = ticketsQuery.eq('owner_id', filters.ownerId);
      }

      // Parallel queries: tickets + active clients + last contact per client
      const clientesAtivosQuery = tf(supabase
        .from('clientes')
        .select('id, razao_social, nome_fantasia, mensalidade, data_cadastro, cnpj, fornecedor_id')
        .eq('cancelado', false));

      const fornecedoresQuery = tf(supabase
        .from('fornecedores')
        .select('id, nome'));

      const [ticketsResult, clientesResult, fornecedoresResult] = await Promise.all([
        ticketsQuery,
        clientesAtivosQuery,
        fornecedoresQuery,
      ]);

      if (ticketsResult.error) throw ticketsResult.error;
      if (clientesResult.error) throw clientesResult.error;
      if (fornecedoresResult.error) throw fornecedoresResult.error;

      const allTicketsRaw = ticketsResult.data || [];
      const clientesAtivos = clientesResult.data || [];
      const fornecedoresMap = new Map((fornecedoresResult.data || []).map((f: any) => [f.id, f.nome]));

      const allTickets = (allTicketsRaw || []) as unknown as CSTicket[];
      const interval = { start: filters.periodoInicio, end: endOfDay(filters.periodoFim) };

      const ticketsNoPeriodo = allTickets.filter((t) =>
        isWithinInterval(parseISO(t.criado_em), interval)
      );

      const ticketsFechadosNoPeriodo = allTickets.filter(
        (t) => t.concluido_em && isWithinInterval(parseISO(t.concluido_em), interval)
      );

      const backlog = allTickets.filter(
        (t) => !['concluido', 'cancelado'].includes(t.status)
      );

      const backlogPorStatus: Record<CSTicketStatus, number> = {
        aberto: 0, em_andamento: 0, aguardando_cliente: 0, aguardando_interno: 0,
        em_monitoramento: 0, concluido: 0, cancelado: 0,
      };
      backlog.forEach((t) => { backlogPorStatus[t.status]++; });

      const backlogPorPrioridade: Record<CSTicketPrioridade, number> = {
        baixa: 0, media: 0, alta: 0, urgente: 0,
      };
      backlog.forEach((t) => { backlogPorPrioridade[t.prioridade]++; });

      // SLA
      const vencendoSlaAcao: CSTicket[] = [];
      const vencendoSlaConclusao: CSTicket[] = [];
      const vencidosSlaAcao: CSTicket[] = [];
      const vencidosSlaConclusao: CSTicket[] = [];

      backlog.forEach((t) => {
        if (t.sla_primeira_acao_ate && !t.primeira_acao_em) {
          const slaDate = parseISO(t.sla_primeira_acao_ate);
          if (slaDate < now) vencidosSlaAcao.push(t);
          else if (differenceInHours(slaDate, now) <= 24) vencendoSlaAcao.push(t);
        }
        if (t.sla_conclusao_ate) {
          const slaConcDate = parseISO(t.sla_conclusao_ate);
          if (slaConcDate < now) vencidosSlaConclusao.push(t);
          else if (differenceInHours(slaConcDate, now) <= 48) vencendoSlaConclusao.push(t);
        }
      });

      // Tempos
      const temposAcao = ticketsFechadosNoPeriodo
        .filter((t) => t.primeira_acao_em)
        .map((t) => differenceInHours(parseISO(t.primeira_acao_em!), parseISO(t.criado_em)));

      const tempoAteAcaoMedia = temposAcao.length > 0 ? temposAcao.reduce((a, b) => a + b, 0) / temposAcao.length : 0;
      const tempoAteAcaoMediana = calculateMedian(temposAcao);

      const temposConclusao = ticketsFechadosNoPeriodo
        .filter((t) => t.concluido_em)
        .map((t) => differenceInHours(parseISO(t.concluido_em!), parseISO(t.criado_em)));

      const tempoAteConclusaoMedia = temposConclusao.length > 0 ? temposConclusao.reduce((a, b) => a + b, 0) / temposConclusao.length : 0;
      const tempoAteConclusaoMediana = calculateMedian(temposConclusao);

      // Higiene
      const ticketsComHigiene = backlog.filter((t) => t.proxima_acao && t.proxima_acao.trim() && t.proximo_followup_em);
      const percentHigiene = backlog.length > 0 ? (ticketsComHigiene.length / backlog.length) * 100 : 100;

      const reaberturas = allTickets.filter(
        (t) => t.concluido_em && !['concluido', 'cancelado'].includes(t.status)
      ).length;

      // Risco
      const ticketsRisco = backlog.filter((t) => t.tipo === 'risco_churn');
      const clientesEmRisco = new Set(ticketsRisco.map((t) => t.cliente_id).filter(Boolean)).size;

      const ticketsRiscoPorPrioridade: Record<CSTicketPrioridade, number> = { baixa: 0, media: 0, alta: 0, urgente: 0 };
      ticketsRisco.forEach((t) => { ticketsRiscoPorPrioridade[t.prioridade]++; });

      const ticketsRiscoComPlano = ticketsRisco.filter((t) => t.proxima_acao && t.proxima_acao.trim() && t.proximo_followup_em);
      const percentRiscoComPlano = ticketsRisco.length > 0 ? (ticketsRiscoComPlano.length / ticketsRisco.length) * 100 : 100;

      const mrrEmRisco = ticketsRisco.reduce((sum, t) => sum + (t.mrr_em_risco || 0), 0);
      const mrrRecuperado = ticketsFechadosNoPeriodo
        .filter((t) => t.tipo === 'risco_churn')
        .reduce((sum, t) => sum + (t.mrr_recuperado || 0), 0);

      const ticketsRiscoFechados = ticketsFechadosNoPeriodo.filter((t) => t.tipo === 'risco_churn');
      const resultadoRisco = {
        retido: ticketsRiscoFechados.filter((t) => t.mrr_recuperado && t.mrr_recuperado > 0).length,
        naoRetido: ticketsRiscoFechados.filter((t) => !t.mrr_recuperado || t.mrr_recuperado === 0).length,
        monitoramento: backlog.filter((t) => t.tipo === 'risco_churn' && t.status === 'em_monitoramento').length,
      };

      // Indicações — baseadas em movimentos (atualizado_em) dentro do período
      const ticketsIndicacao = allTickets.filter((t) => t.tipo === 'indicacao');

      // Tickets de indicação que tiveram movimentação no período (criados OU atualizados)
      const ticketsIndicacaoMovimentados = ticketsIndicacao.filter((t) =>
        isWithinInterval(parseISO(t.criado_em), interval) ||
        isWithinInterval(parseISO(t.atualizado_em), interval)
      );

      // Pipeline: conta o status atual de todos os tickets movimentados no período
      // Tickets sem indicacao_status são tratados como 'recebida' (estágio inicial)
      const pipelineIndicacao: Record<CSIndicacaoStatus, number> = {
        recebida: 0, contatada: 0, qualificada: 0, enviada_ao_comercial: 0, fechou: 0, nao_fechou: 0,
      };
      ticketsIndicacaoMovimentados.forEach((t) => {
        const status = t.indicacao_status || 'recebida';
        pipelineIndicacao[status]++;
      });

      // Indicações por owner (movimentados no período)
      const indicacoesByOwner: Record<number, number> = {};
      ticketsIndicacaoMovimentados.forEach((t) => {
        if (t.owner_id) indicacoesByOwner[t.owner_id] = (indicacoesByOwner[t.owner_id] || 0) + 1;
      });

      const { data: funcData } = await tf(supabase.from('funcionarios').select('id, nome')).eq('ativo', true);
      const funcMap = new Map<number, string>((funcData || []).map((f: any) => [f.id, f.nome]));

      const indicacoesPorOwner = Object.entries(indicacoesByOwner).map(([id, count]) => ({
        owner_id: Number(id),
        nome: funcMap.get(Number(id)) || 'Desconhecido',
        count,
      }));

      // Indicações — conversão baseada em atualizado_em no período
      const indicacoesGanhas = ticketsIndicacaoMovimentados.filter((t) => t.indicacao_status === 'fechou').length;
      const indicacoesPerdidas = ticketsIndicacaoMovimentados.filter((t) => t.indicacao_status === 'nao_fechou').length;
      const indicacoesTotalMovimentados = ticketsIndicacaoMovimentados.length;
      const indicacoesConversaoPercent = indicacoesTotalMovimentados > 0
        ? (indicacoesGanhas / indicacoesTotalMovimentados) * 100 : 0;

      // Oportunidades
      const oportunidadesBacklog = backlog.filter((t) => t.tipo === 'oportunidade');
      const oportunidadesFechadasNoPeriodo = ticketsFechadosNoPeriodo.filter((t) => t.tipo === 'oportunidade');
      const oportunidadesGanhas = oportunidadesFechadasNoPeriodo.filter((t) => t.oport_resultado === 'ganho').length;
      const oportunidadesPerdidas = oportunidadesFechadasNoPeriodo.filter((t) => t.oport_resultado === 'perdido').length;
      const oportunidadesConversaoPercent = (oportunidadesGanhas + oportunidadesPerdidas) > 0
        ? (oportunidadesGanhas / (oportunidadesGanhas + oportunidadesPerdidas)) * 100 : 0;
      const oportunidadesValorPrevistoAtivacao = oportunidadesBacklog.reduce((s, t) => s + (t.oport_valor_previsto_ativacao || 0), 0);
      const oportunidadesValorPrevistoMrr = oportunidadesBacklog.reduce((s, t) => s + (t.oport_valor_previsto_mrr || 0), 0);
      const oportunidadesGanhasLista = oportunidadesFechadasNoPeriodo.filter((t) => t.oport_resultado === 'ganho');
      const oportunidadesValorGanhoAtivacao = oportunidadesGanhasLista.reduce((s, t) => s + (t.oport_valor_previsto_ativacao || 0), 0);
      const oportunidadesValorGanhoMrr = oportunidadesGanhasLista.reduce((s, t) => s + (t.oport_valor_previsto_mrr || 0), 0);

      const topPrioridades = backlog
        .filter((t) => t.prioridade === 'urgente' || t.prioridade === 'alta')
        .sort((a, b) => {
          if (!a.proximo_followup_em) return 1;
          if (!b.proximo_followup_em) return -1;
          return new Date(a.proximo_followup_em).getTime() - new Date(b.proximo_followup_em).getTime();
        })
        .slice(0, 10);

      // ── Cobertura 90D ──
      const limite90d = subDays(now, 90);
      const tiposCob = ['relacionamento_90d', 'adocao_engajamento'];

      // Clients covered: have at least 1 ticket of these types created in last 90 days
      const clientesCobertosSet = new Set<string>();
      allTickets.forEach((t) => {
        if (t.cliente_id && tiposCob.includes(t.tipo) && parseISO(t.criado_em) >= limite90d) {
          clientesCobertosSet.add(t.cliente_id);
        }
      });

      // Last contact per client (any ticket type)
      const ultimoContatoMap = new Map<string, string>();
      allTickets.forEach((t) => {
        if (!t.cliente_id) return;
        const current = ultimoContatoMap.get(t.cliente_id);
        if (!current || t.criado_em > current) {
          ultimoContatoMap.set(t.cliente_id, t.criado_em);
        }
      });

      const totalAtivos = clientesAtivos.length;
      const clientesDescobertos = clientesAtivos
        .filter((c) => !clientesCobertosSet.has(c.id))
        .map((c) => {
          const uc = ultimoContatoMap.get(c.id) || null;
          return {
            id: c.id,
            razao_social: c.razao_social,
            nome_fantasia: c.nome_fantasia,
            mensalidade: c.mensalidade,
            ultimoContato: uc,
            diasSemContato: uc ? differenceInDays(now, parseISO(uc)) : null,
            data_cadastro: c.data_cadastro || null,
            cnpj: c.cnpj || null,
            fornecedor_nome: c.fornecedor_id ? (fornecedoresMap.get(c.fornecedor_id) || null) : null,
          };
        })
        .sort((a, b) => {
          if (a.diasSemContato === null && b.diasSemContato === null) return 0;
          if (a.diasSemContato === null) return -1;
          if (b.diasSemContato === null) return 1;
          return b.diasSemContato - a.diasSemContato;
        });

      const cobertos = totalAtivos - clientesDescobertos.length;
      const percentCoberto = totalAtivos > 0 ? (cobertos / totalAtivos) * 100 : 100;

      return {
        ticketsAbertos: ticketsNoPeriodo.length,
        ticketsFechados: ticketsFechadosNoPeriodo.length,
        backlogPorStatus, backlogPorPrioridade,
        vencendoSlaAcao, vencendoSlaConclusao, vencidosSlaAcao, vencidosSlaConclusao,
        tempoAteAcaoMedia, tempoAteAcaoMediana, tempoAteConclusaoMedia, tempoAteConclusaoMediana,
        percentHigiene, reaberturas, clientesEmRisco,
        ticketsRiscoPorPrioridade, percentRiscoComPlano, mrrEmRisco, mrrRecuperado, resultadoRisco,
        pipelineIndicacao, indicacoesPorOwner,
        indicacoesGanhas, indicacoesPerdidas, indicacoesConversaoPercent, indicacoesTotalMovimentados,
        topPrioridades, allTickets,
        ticketsIndicacaoDetalhados: ticketsIndicacaoMovimentados,
        oportunidadesAbertas: oportunidadesBacklog.length,
        oportunidadesGanhas, oportunidadesPerdidas, oportunidadesConversaoPercent,
        oportunidadesValorPrevistoAtivacao, oportunidadesValorPrevistoMrr,
        oportunidadesValorGanhoAtivacao, oportunidadesValorGanhoMrr,
        oportunidadesAbertasLista: oportunidadesBacklog,
        cobertura90d: {
          totalAtivos,
          cobertos,
          descobertos: clientesDescobertos.length,
          percentCoberto,
          clientesDescobertos,
        },
      };
    },
  });
}
