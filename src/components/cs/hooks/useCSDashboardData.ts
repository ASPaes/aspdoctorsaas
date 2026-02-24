import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { differenceInHours, parseISO, isWithinInterval } from 'date-fns';
import type { CSTicket, CSTicketStatus, CSTicketPrioridade, CSIndicacaoStatus } from '../types';

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
  topPrioridades: CSTicket[];
  allTickets: CSTicket[];
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function useCSDashboardData(filters: CSDashboardFilters) {
  return useQuery({
    queryKey: ['cs-dashboard-data', filters.periodoInicio.toISOString(), filters.periodoFim.toISOString(), filters.ownerId],
    queryFn: async (): Promise<CSDashboardData> => {
      const now = new Date();

      let ticketsQuery = supabase
        .from('cs_tickets')
        .select(`
          *,
          cliente:clientes!cs_tickets_cliente_id_fkey (
            id, razao_social, nome_fantasia, mensalidade, cancelado
          ),
          owner:funcionarios!cs_tickets_owner_id_fkey (
            id, nome, cargo, ativo
          )
        `);

      if (filters.ownerId) {
        ticketsQuery = ticketsQuery.eq('owner_id', filters.ownerId);
      }

      const { data: allTicketsRaw, error } = await ticketsQuery;
      if (error) throw error;

      const allTickets = (allTicketsRaw || []) as unknown as CSTicket[];
      const interval = { start: filters.periodoInicio, end: filters.periodoFim };

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

      // Indicações
      const ticketsIndicacao = allTickets.filter((t) => t.tipo === 'indicacao');
      const pipelineIndicacao: Record<CSIndicacaoStatus, number> = {
        recebida: 0, contatada: 0, qualificada: 0, enviada_ao_comercial: 0, fechou: 0, nao_fechou: 0,
      };
      ticketsIndicacao.forEach((t) => { if (t.indicacao_status) pipelineIndicacao[t.indicacao_status]++; });

      const indicacoesNoPeriodo = ticketsIndicacao.filter((t) => isWithinInterval(parseISO(t.criado_em), interval));
      const indicacoesByOwner: Record<number, number> = {};
      indicacoesNoPeriodo.forEach((t) => {
        if (t.owner_id) indicacoesByOwner[t.owner_id] = (indicacoesByOwner[t.owner_id] || 0) + 1;
      });

      const { data: funcData } = await supabase.from('funcionarios').select('id, nome').eq('ativo', true);
      const funcMap = new Map((funcData || []).map((f: any) => [f.id, f.nome]));

      const indicacoesPorOwner = Object.entries(indicacoesByOwner).map(([id, count]) => ({
        owner_id: Number(id),
        nome: funcMap.get(Number(id)) || 'Desconhecido',
        count,
      }));

      const topPrioridades = backlog
        .filter((t) => t.prioridade === 'urgente' || t.prioridade === 'alta')
        .sort((a, b) => {
          if (!a.proximo_followup_em) return 1;
          if (!b.proximo_followup_em) return -1;
          return new Date(a.proximo_followup_em).getTime() - new Date(b.proximo_followup_em).getTime();
        })
        .slice(0, 10);

      return {
        ticketsAbertos: ticketsNoPeriodo.length,
        ticketsFechados: ticketsFechadosNoPeriodo.length,
        backlogPorStatus, backlogPorPrioridade,
        vencendoSlaAcao, vencendoSlaConclusao, vencidosSlaAcao, vencidosSlaConclusao,
        tempoAteAcaoMedia, tempoAteAcaoMediana, tempoAteConclusaoMedia, tempoAteConclusaoMediana,
        percentHigiene, reaberturas, clientesEmRisco,
        ticketsRiscoPorPrioridade, percentRiscoComPlano, mrrEmRisco, mrrRecuperado, resultadoRisco,
        pipelineIndicacao, indicacoesPorOwner, topPrioridades, allTickets,
      };
    },
  });
}
