import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { format, eachDayOfInterval } from 'date-fns';

export interface WhatsAppMetricsFilters {
  dateRange: { from: Date; to: Date };
  instanceId?: string | null;
  agentId?: string | null;
  departmentId?: string | null;
}

export interface WhatsAppMetrics {
  total: number;
  active: number;
  closed: number;
  archived: number;
  avgResponseTimeMinutes: number;
  resolutionRate: number;
  avgFirstResponseTimeMinutes: number;
  dailyTrend: { date: string; count: number }[];
  statusDistribution: { status: string; count: number; percentage: number }[];
  topicsDistribution: { topic: string; count: number }[];
  sentimentDistribution: { sentiment: string; count: number; percentage: number }[];
  longestConversations: Array<{ id: string; contactName: string; status: string; durationHours: number; createdAt: string }>;
  agentPerformance: Array<{ agentId: string; agentName: string; totalConversations: number; closedConversations: number; avgResponseTimeMinutes: number }>;
  totalMessages: number;
  sentMessages: number;
  receivedMessages: number;
  uniqueContacts: number;
  avgMessagesPerConversation: number;
  queuedConversations: number;
  avgResolutionTimeMinutes: number;
  engagementRate: number;
  messageTypeDistribution: { type: string; count: number; percentage: number }[];
  hourlyActivity: { hour: number; count: number }[];
  weekdayActivity: { weekday: string; count: number }[];
  topContacts: { contactId: string; contactName: string; messageCount: number }[];
  instanceComparison: { instanceId: string; instanceName: string; conversations: number; messages: number; contacts: number }[];
  dailyMessageTrend: { date: string; sent: number; received: number }[];
  previousPeriod: {
    total: number; active: number; closed: number; archived: number;
    avgResponseTimeMinutes: number; resolutionRate: number; avgFirstResponseTimeMinutes: number;
  };
  sectorTotal: number;
  sectorActive: number;
  sectorClosed: number;
  sectorTotalMessages: number;
  sectorSentMessages: number;
  sectorReceivedMessages: number;
  sectorUniqueContacts: number;
  sectorAvgResponseTimeMinutes: number;
  sectorResolutionRate: number;
  sectorAvgFirstResponseTimeMinutes: number;
  sectorAvgMessagesPerConversation: number;
  sectorEngagementRate: number;
}

function calcResponseTimes(messagesByConv: Record<string, any[]>) {
  const responseTimes: number[] = [];
  const firstResponseTimes: number[] = [];

  Object.values(messagesByConv).forEach((convMessages: any[]) => {
    for (let i = 0; i < convMessages.length; i++) {
      if (!convMessages[i].is_from_me) {
        const next = convMessages.slice(i + 1).find(m => m.is_from_me);
        if (next) {
          const diff = (new Date(next.timestamp).getTime() - new Date(convMessages[i].timestamp).getTime()) / 60000;
          if (diff > 0.16 && diff < 1440) responseTimes.push(diff);
        }
      }
    }
    const firstClient = convMessages.find(m => !m.is_from_me);
    if (firstClient) {
      const firstAgent = convMessages.find(m => m.is_from_me && new Date(m.timestamp) > new Date(firstClient.timestamp));
      if (firstAgent) {
        const diff = (new Date(firstAgent.timestamp).getTime() - new Date(firstClient.timestamp).getTime()) / 60000;
        if (diff > 0 && diff < 1440) firstResponseTimes.push(diff);
      }
    }
  });

  return {
    avgResponse: responseTimes.length > 0 ? responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length : 0,
    avgFirstResponse: firstResponseTimes.length > 0 ? firstResponseTimes.reduce((s, t) => s + t, 0) / firstResponseTimes.length : 0,
    responseTimes,
  };
}

export const useWhatsAppMetrics = (filters: WhatsAppMetricsFilters) => {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ['whatsapp-metrics', filters.dateRange.from.toISOString(), filters.dateRange.to.toISOString(), filters.instanceId, filters.agentId, filters.departmentId, tid],
    queryFn: async () => {
      const { from, to } = filters.dateRange;

      let cq = supabase.from('whatsapp_conversations')
        .select('id, status, last_message_at, created_at, contact_id, metadata, instance_id, assigned_to')
        .gte('last_message_at', from.toISOString())
        .lte('last_message_at', to.toISOString());
      if (tid) cq = cq.eq('tenant_id', tid);
      if (filters.instanceId) cq = cq.eq('instance_id', filters.instanceId);
      if (filters.departmentId) cq = cq.eq('department_id', filters.departmentId);
      if (filters.agentId) cq = cq.eq('assigned_to', filters.agentId);

      const { data: conversations, error: convError } = await cq;
      if (convError) throw convError;

      const total = conversations?.length || 0;
      const active = conversations?.filter(c => c.status === 'active').length || 0;
      const closed = conversations?.filter(c => c.status === 'closed').length || 0;
      const archived = conversations?.filter(c => c.status === 'archived').length || 0;
      const conversationIds = conversations?.map(c => c.id) || [];

      let messagesByConv: Record<string, any[]> = {};
      if (conversationIds.length > 0) {
        const { data: msgs } = await (supabase.from('whatsapp_messages' as any))
          .select('conversation_id, is_from_me, timestamp, message_type')
          .in('conversation_id', conversationIds)
          .order('timestamp', { ascending: true });
        (msgs as any[] || []).forEach((m: any) => {
          if (!messagesByConv[m.conversation_id]) messagesByConv[m.conversation_id] = [];
          messagesByConv[m.conversation_id].push(m);
        });
      }

      const { avgResponse, avgFirstResponse } = calcResponseTimes(messagesByConv);
      const resolutionRate = total > 0 ? (closed / total) * 100 : 0;

      // Daily trend
      const days = eachDayOfInterval({ start: from, end: to });
      const convByDate = conversations?.reduce((acc: Record<string, number>, c: any) => {
        const d = format(new Date(c.last_message_at), 'dd/MM');
        acc[d] = (acc[d] || 0) + 1;
        return acc;
      }, {}) || {};
      const dailyTrend = days.map(d => ({ date: format(d, 'dd/MM'), count: convByDate[format(d, 'dd/MM')] || 0 }));

      const statusDistribution = [
        { status: 'active', count: active, percentage: total > 0 ? (active / total) * 100 : 0 },
        { status: 'closed', count: closed, percentage: total > 0 ? (closed / total) * 100 : 0 },
        { status: 'archived', count: archived, percentage: total > 0 ? (archived / total) * 100 : 0 },
      ];

      // Topics
      const topicCounts: Record<string, number> = {};
      conversations?.forEach((c: any) => {
        const meta = c.metadata as any;
        if (meta?.topics && Array.isArray(meta.topics)) {
          meta.topics.forEach((t: string) => { topicCounts[t] = (topicCounts[t] || 0) + 1; });
        }
      });
      const topicsDistribution = Object.entries(topicCounts).map(([topic, count]) => ({ topic, count }));

      // Sentiment
      const { data: sentimentData } = conversationIds.length > 0
        ? await (supabase.from('whatsapp_sentiment_analysis' as any)).select('sentiment, conversation_id').in('conversation_id', conversationIds)
        : { data: [] };
      const sentCounts = (sentimentData as any[] || []).reduce((acc: Record<string, number>, i: any) => {
        acc[i.sentiment] = (acc[i.sentiment] || 0) + 1; return acc;
      }, {});
      const totalSent = Object.values(sentCounts).reduce((s: number, c) => s + (c as number), 0) as number;
      const sentimentDistribution = Object.entries(sentCounts).map(([sentiment, count]) => ({
        sentiment, count: count as number, percentage: totalSent > 0 ? ((count as number) / totalSent) * 100 : 0,
      }));

      // All messages for additional metrics
      const allMessages = Object.values(messagesByConv).flat();
      const totalMessages = allMessages.length;
      const sentMessages = allMessages.filter(m => m.is_from_me).length;
      const receivedMessages = allMessages.filter(m => !m.is_from_me).length;
      const uniqueContacts = new Set(conversations?.map(c => c.contact_id)).size;
      const avgMessagesPerConversation = conversationIds.length > 0 ? totalMessages / conversationIds.length : 0;
      const engagementRate = sentMessages > 0 ? (receivedMessages / sentMessages) * 100 : 0;

      // Message type distribution
      const mtCounts: Record<string, number> = {};
      allMessages.forEach(m => { const t = m.message_type || 'text'; mtCounts[t] = (mtCounts[t] || 0) + 1; });
      const messageTypeDistribution = Object.entries(mtCounts).map(([type, count]) => ({
        type, count, percentage: totalMessages > 0 ? (count / totalMessages) * 100 : 0,
      }));

      // Hourly activity
      const hCounts = new Array(24).fill(0);
      allMessages.forEach(m => { hCounts[new Date(m.timestamp).getHours()]++; });
      const hourlyActivity = hCounts.map((count, hour) => ({ hour, count }));

      // Weekday activity
      const wNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const wCounts = new Array(7).fill(0);
      allMessages.forEach(m => { wCounts[new Date(m.timestamp).getDay()]++; });
      const weekdayActivity = wCounts.map((count, i) => ({ weekday: wNames[i], count }));

      // Daily message trend
      const dmByDate = allMessages.reduce((acc: Record<string, { sent: number; received: number }>, m: any) => {
        const d = format(new Date(m.timestamp), 'dd/MM');
        if (!acc[d]) acc[d] = { sent: 0, received: 0 };
        if (m.is_from_me) acc[d].sent++; else acc[d].received++;
        return acc;
      }, {});
      const dailyMessageTrend = days.map(d => {
        const k = format(d, 'dd/MM');
        return { date: k, sent: dmByDate[k]?.sent || 0, received: dmByDate[k]?.received || 0 };
      });

      // Previous period
      const periodDuration = to.getTime() - from.getTime();
      const prevFrom = new Date(from.getTime() - periodDuration);
      let pq = supabase.from('whatsapp_conversations')
        .select('id, status, last_message_at')
        .gte('last_message_at', prevFrom.toISOString())
        .lt('last_message_at', from.toISOString());
      if (tid) pq = pq.eq('tenant_id', tid);
      if (filters.instanceId) pq = pq.eq('instance_id', filters.instanceId);
      if (filters.departmentId) pq = pq.eq('department_id', filters.departmentId);
      if (filters.agentId) pq = pq.eq('assigned_to', filters.agentId);
      const { data: prevConvs } = await pq;
      const pTotal = prevConvs?.length || 0;
      const pActive = prevConvs?.filter(c => c.status === 'active').length || 0;
      const pClosed = prevConvs?.filter(c => c.status === 'closed').length || 0;
      const pArchived = prevConvs?.filter(c => c.status === 'archived').length || 0;

      // Busca dados do setor inteiro para calcular percentuais
      let sectorMetrics = {
        sectorTotal: 0, sectorActive: 0, sectorClosed: 0,
        sectorTotalMessages: 0, sectorSentMessages: 0, sectorReceivedMessages: 0,
        sectorUniqueContacts: 0, sectorAvgResponseTimeMinutes: 0,
        sectorResolutionRate: 0, sectorAvgFirstResponseTimeMinutes: 0,
        sectorAvgMessagesPerConversation: 0, sectorEngagementRate: 0,
      };

      if (filters.agentId) {
        let sq = supabase.from('whatsapp_conversations')
          .select('id, status, last_message_at, contact_id, assigned_to')
          .gte('last_message_at', from.toISOString())
          .lte('last_message_at', to.toISOString());
        if (tid) sq = sq.eq('tenant_id', tid);
        if (filters.departmentId) sq = sq.eq('department_id', filters.departmentId);
        if (filters.instanceId) sq = sq.eq('instance_id', filters.instanceId);

        const { data: sectorConvs } = await sq;
        const sTotal = sectorConvs?.length || 0;
        const sClosed = sectorConvs?.filter(c => c.status === 'closed').length || 0;
        const sUniqueContacts = new Set(sectorConvs?.map(c => c.contact_id)).size;
        const sConvIds = sectorConvs?.map(c => c.id) || [];

        let sMsgsByConv: Record<string, any[]> = {};
        if (sConvIds.length > 0) {
          const { data: sMsgs } = await (supabase.from('whatsapp_messages' as any))
            .select('conversation_id, is_from_me, timestamp, message_type')
            .in('conversation_id', sConvIds)
            .order('timestamp', { ascending: true });
          (sMsgs as any[] || []).forEach((m: any) => {
            if (!sMsgsByConv[m.conversation_id]) sMsgsByConv[m.conversation_id] = [];
            sMsgsByConv[m.conversation_id].push(m);
          });
        }

        const sAllMsgs = Object.values(sMsgsByConv).flat();
        const sSent = sAllMsgs.filter(m => m.is_from_me).length;
        const sReceived = sAllMsgs.filter(m => !m.is_from_me).length;
        const { avgResponse: sAvgResp, avgFirstResponse: sAvgFirst } = calcResponseTimes(sMsgsByConv);

        sectorMetrics = {
          sectorTotal: sTotal,
          sectorActive: sectorConvs?.filter(c => c.status === 'active').length || 0,
          sectorClosed: sClosed,
          sectorTotalMessages: sAllMsgs.length,
          sectorSentMessages: sSent,
          sectorReceivedMessages: sReceived,
          sectorUniqueContacts: sUniqueContacts,
          sectorAvgResponseTimeMinutes: sAvgResp,
          sectorResolutionRate: sTotal > 0 ? (sClosed / sTotal) * 100 : 0,
          sectorAvgFirstResponseTimeMinutes: sAvgFirst,
          sectorAvgMessagesPerConversation: sConvIds.length > 0 ? sAllMsgs.length / sConvIds.length : 0,
          sectorEngagementRate: sSent > 0 ? (sReceived / sSent) * 100 : 0,
        };
      }

      return {
        total, active, closed, archived,
        avgResponseTimeMinutes: avgResponse,
        resolutionRate,
        avgFirstResponseTimeMinutes: avgFirstResponse,
        dailyTrend, statusDistribution, topicsDistribution, sentimentDistribution,
        longestConversations: [], agentPerformance: [],
        totalMessages, sentMessages, receivedMessages, uniqueContacts,
        avgMessagesPerConversation, queuedConversations: 0,
        avgResolutionTimeMinutes: 0, engagementRate,
        messageTypeDistribution, hourlyActivity, weekdayActivity,
        topContacts: [], instanceComparison: [], dailyMessageTrend,
        previousPeriod: {
          total: pTotal, active: pActive, closed: pClosed, archived: pArchived,
          avgResponseTimeMinutes: 0, resolutionRate: pTotal > 0 ? (pClosed / pTotal) * 100 : 0,
          avgFirstResponseTimeMinutes: 0,
        },
        ...sectorMetrics,
      } as WhatsAppMetrics;
    },
    refetchInterval: 60000,
  });
};
