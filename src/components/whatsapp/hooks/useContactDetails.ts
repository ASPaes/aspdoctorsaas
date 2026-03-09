import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ContactMetrics {
  totalConversations: number;
  totalMessages: number;
  sentMessages: number;
  receivedMessages: number;
  avgResponseTime: number;
  daysSinceFirstContact: number;
  satisfactionRate: number;
}

interface SentimentHistoryItem {
  id: string;
  created_at: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence_score: number | null;
  summary: string | null;
}

interface TopicDistribution {
  topic: string;
  count: number;
}

export interface ContactDetails {
  contact: any;
  conversations: any[];
  metrics: ContactMetrics;
  sentimentHistory: SentimentHistoryItem[];
  topicsDistribution: TopicDistribution[];
  summaries: any[];
}

export const useContactDetails = (contactId: string | null) => {
  return useQuery({
    queryKey: ['contact-details', contactId],
    queryFn: async (): Promise<ContactDetails | null> => {
      if (!contactId) return null;

      const { data: contact, error: contactError } = await supabase
        .from('whatsapp_contacts').select('*').eq('id', contactId).single();
      if (contactError) throw contactError;

      const { data: conversations } = await supabase
        .from('whatsapp_conversations').select('*').eq('contact_id', contactId).order('created_at', { ascending: false });

      const conversationIds = conversations?.map((c: any) => c.id) || [];

      // Sentiment per conversation
      const conversationsWithSentiment = await Promise.all(
        (conversations || []).map(async (conv: any) => {
          const { data: sentiment } = await supabase
            .from('whatsapp_sentiment_analysis' as any)
            .select('sentiment')
            .eq('conversation_id', conv.id)
            .maybeSingle();
          return { ...conv, sentiment: (sentiment as any)?.sentiment };
        })
      );

      // Messages
      const { data: messages } = conversationIds.length > 0
        ? await supabase.from('whatsapp_messages' as any).select('*').in('conversation_id', conversationIds)
        : { data: [] };

      // Sentiment history
      const { data: currentAnalysis } = conversationIds.length > 0
        ? await supabase.from('whatsapp_sentiment_analysis' as any)
            .select('id, created_at, sentiment, confidence, summary')
            .in('conversation_id', conversationIds)
        : { data: [] };

      const { data: historyAnalysis } = await supabase
        .from('whatsapp_sentiment_history' as any)
        .select('id, created_at, sentiment, confidence, summary')
        .eq('contact_id', contactId);

      const sentimentHistory = [
        ...((historyAnalysis as any[]) || []),
        ...((currentAnalysis as any[]) || []),
      ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(s => ({ ...s, confidence_score: s.confidence }));

      // Summaries
      const { data: summaries } = conversationIds.length > 0
        ? await supabase.from('whatsapp_conversation_summaries')
            .select('*').in('conversation_id', conversationIds).order('created_at', { ascending: false })
        : { data: [] };

      // Metrics
      const msgArr = (messages as any[]) || [];
      const totalMessages = msgArr.length;
      const sentMessages = msgArr.filter((m: any) => m.is_from_me).length;
      const receivedMessages = msgArr.filter((m: any) => !m.is_from_me).length;

      let totalResponseTime = 0;
      let responseCount = 0;
      for (const conv of conversations || []) {
        const convMessages = msgArr
          .filter((m: any) => m.conversation_id === conv.id)
          .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        for (let i = 0; i < convMessages.length - 1; i++) {
          if (!convMessages[i].is_from_me && convMessages[i + 1].is_from_me) {
            const rt = (new Date(convMessages[i + 1].timestamp).getTime() - new Date(convMessages[i].timestamp).getTime()) / 60000;
            if (rt > 0.16 && rt < 1440) { totalResponseTime += rt; responseCount++; }
          }
        }
      }

      const firstMessage = msgArr.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
      const daysSinceFirstContact = firstMessage
        ? Math.floor((Date.now() - new Date(firstMessage.timestamp).getTime()) / 86400000)
        : 0;

      const positiveSentiments = sentimentHistory.filter(s => s.sentiment === 'positive').length;
      const satisfactionRate = sentimentHistory.length > 0 ? (positiveSentiments / sentimentHistory.length) * 100 : 0;

      // Topics
      const topicsMap = new Map<string, number>();
      for (const conv of conversations || []) {
        const meta = typeof conv.metadata === 'string' ? JSON.parse(conv.metadata) : conv.metadata;
        for (const topic of meta?.topics || []) {
          topicsMap.set(topic, (topicsMap.get(topic) || 0) + 1);
        }
      }
      const topicsDistribution = Array.from(topicsMap.entries())
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count);

      return {
        contact,
        conversations: conversationsWithSentiment,
        metrics: {
          totalConversations: conversations?.length || 0,
          totalMessages, sentMessages, receivedMessages,
          avgResponseTime: responseCount > 0 ? totalResponseTime / responseCount : 0,
          daysSinceFirstContact, satisfactionRate,
        },
        sentimentHistory,
        topicsDistribution,
        summaries: summaries || [],
      };
    },
    enabled: !!contactId,
    staleTime: 30000,
  });
};
