import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { subscribeSharedChannel } from '@/lib/realtimeChannelPool';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUserDepartment } from '@/hooks/useUserDepartment';


export interface ConversationWithContact {
  id: string;
  contact_id: string;
  instance_id: string | null;
  department_id: string | null;
  status: string;
  category: string | null;
  priority: string | null;
  assigned_to: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any> | null;
  /** Colunas de whatsapp_conversations — o chat inteiro decide grupo por elas. */
  is_group?: boolean;
  group_jid?: string | null;
  tenant_id: string;
  is_last_message_from_me: boolean;
  auto_reply_disabled?: boolean;
  auto_reply_disabled_at?: string | null;
  auto_reply_disabled_by?: string | null;
  auto_reply_disabled_reason?: string | null;
  opened_out_of_hours?: boolean;
  opened_out_of_hours_at?: string | null;
  sender_signature_mode?: string;
  sender_ticket_code?: string | null;
  /** Bucket calculado NO SERVIDOR por wa_conversation_bucket. Não recalcular no cliente. */
  bucket?: string;
  /**
   * DEM-0227: chegada na fila. Só vem preenchido quando a lista foi pedida com
   * queueOrder (pill "Fila") — é a chave da ordenação FIFO e o que a UI mostra
   * como tempo de espera.
   */
  queue_since?: string | null;
  contact: {
    id: string;
    name: string | null;
    phone_number: string;
    profile_picture_url: string | null;
    notes: string | null;
    instance_id: string;
    is_group: boolean;
    tags: string[] | null;
    tenant_id: string;
    created_at: string;
    updated_at: string;
  };
  isLastMessageFromMe?: boolean;
  sentiment?: {
    needs_cs_ticket: boolean | null;
    cs_ticket_created_id: string | null;
    churn_dismissed_at?: string | null;
    churn_dismissed_attendance_id?: string | null;
  } | null;
  /**
   * Linha PARCIAL, vinda da busca por contato (search_conversations_by_contact).
   * Essa RPC não devolve `is_group`, `group_jid` nem `metadata`, então o objeto
   * não serve para abrir o chat: quem seleciona tem de buscar a linha inteira
   * antes. Ver useConversationSearch.
   */
  isPartial?: boolean;
}

export interface ConversationsFilters {
  instanceId?: string;
  instanceIds?: string[];
  departmentId?: string;
  isGroup?: boolean;
  /**
   * Pill ativa: 'waiting' | 'in_progress' | 'after_hours' | 'closed'.
   * undefined = todos os buckets. O filtro é aplicado no SERVIDOR — não refazer
   * no cliente, senão a página volta a encolher depois de paginada (DEM-0234).
   */
  bucket?: string;
  status?: string;
  assignedTo?: string;
  unassigned?: boolean;
  unreadOnly?: boolean;
  pageSize?: number;
  includeIds?: string[];
  /**
   * Operador comum: restringe encerradas às que foram dele. Passar undefined
   * para admin/head/super admin. Mesma regra vale na contagem das pills.
   */
  closedVisibleTo?: string;
  autoReplyDisabledOnly?: boolean;
  rulesDisabledOnly?: boolean;
  /**
   * DEM-0227: pill "Fila". Troca a listagem por whatsapp_list_queue, que ordena
   * por chegada (FIFO) NO SERVIDOR. Ordenar só no cliente não resolveria: a
   * página é cortada por last_message_at DESC, então quem espera há mais tempo
   * é justamente quem fica fora dela.
   */
  queueOrder?: boolean;
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// useWhatsAppConversations — lista paginada, filtrada por bucket no servidor
// ---------------------------------------------------------------------------
//
// Antes desta versão a lista carregava uma janela fixa das 100 conversas mais
// recentes e a pill era aplicada no navegador. Conversa encerrada fora dessa
// janela virava inalcançável — nenhuma ação da UI trazia ela de volta — enquanto
// a contagem da pill, vinda do servidor sobre o tenant inteiro, seguia mostrando
// o número cheio. Era o DEM-0234 (WAYRA SURF BAR / ADEGA FG, posições 128 e 166).
//
// Agora o bucket e a paginação são do servidor, via whatsapp_list_conversations,
// que compartilha wa_conversation_bucket com whatsapp_pill_counts. Lista e
// contagem saem da mesma expressão e não têm como divergir.
export const useWhatsAppConversations = (filters?: ConversationsFilters) => {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { data: meuSetorId } = useUserDepartment();
  const pageSize = filters?.pageSize ?? DEFAULT_PAGE_SIZE;

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['whatsapp', 'conversations', filters, tid],
    initialPageParam: 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
    // Volta para a aba = busca de novo. É a ÚNICA recuperação que a lista tem
    // para a janela em que o operador está em outro app: ali o refetchInterval
    // acima não corre (refetchIntervalInBackground é false por padrão) e o
    // postgres_changes não tem replay, então o que entrou na fila nesse intervalo
    // não chega por Realtime nunca. A pill já fazia isto (usePillCounts) e por
    // isso o contador acertava enquanto a lista ficava velha — era o "Fila 2 com
    // 1 cartão". Medido em 13/08: 3min28s entre a Lê entrar na fila e a primeira
    // chamada de whatsapp_list_queue no projeto inteiro.
    //
    // O custo fica preso ao staleTime de 30s acima: voltar para a aba duas vezes
    // no mesmo meio minuto não gera duas buscas.
    refetchOnWindowFocus: true,
    // O offset conta só as conversas com `last_message_at` — são as que a RPC
    // pagina. Conversa recém-aberta (sem mensagem ainda) vem por fora, forçada
    // por id na primeira página, e NÃO ocupa lugar na janela do servidor:
    // somá-la aqui faria a página 2 pular uma conversa em silêncio.
    getNextPageParam: (lastPage: ConversationWithContact[], allPages) =>
      lastPage.length < pageSize
        ? undefined
        : allPages.reduce(
            (n, p) => n + p.filter((c) => c.last_message_at != null).length,
            0
          ),
    queryFn: async ({ pageParam }): Promise<ConversationWithContact[]> => {
      // DEM-0227: a fila tem RPC própria — mesma forma de retorno, ordem FIFO.
      //
      // Se ela ainda não existir no banco (frontend publicado antes do SQL), o
      // PostgREST devolve PGRST202 e a pill PADRÃO do chat ficaria vazia. Cair
      // para a listagem antiga degrada a ORDEM; não cair degrada o CHAT.
      let queueRes: any = null;
      if (filters?.queueOrder) {
        queueRes = await (supabase as any).rpc('whatsapp_list_queue', {
          p_tenant_id: tid,
          p_department_id: filters?.departmentId ?? null,
          p_instance_id: filters?.instanceId ?? null,
          p_instance_ids: filters?.instanceIds?.length ? filters.instanceIds : null,
          p_status: filters?.status ?? null,
          p_unread_only: filters?.unreadOnly ?? false,
          p_limit: pageSize,
          p_offset: pageParam as number,
        });
        if (queueRes.error?.code === 'PGRST202') {
          console.warn('[DEM-0227] whatsapp_list_queue ausente no banco — fila sem ordem FIFO até a migration ser aplicada');
          queueRes = null;
        }
      }

      const { data: rows, error: rpcError } = queueRes ?? await (supabase as any).rpc(
        'whatsapp_list_conversations',
        {
          p_tenant_id: tid,
          p_bucket: filters?.bucket ?? null,
          p_department_id: filters?.departmentId ?? null,
          p_instance_id: filters?.instanceId ?? null,
          p_instance_ids: filters?.instanceIds?.length ? filters.instanceIds : null,
          p_status: filters?.status ?? null,
          p_assigned_to: filters?.assignedTo ?? null,
          p_unassigned: filters?.unassigned ?? false,
          p_unread_only: filters?.unreadOnly ?? false,
          // undefined = grupos e 1:1 juntos (pill "Todos"); false = só 1:1; true = só grupos
          p_is_group: filters?.isGroup === undefined ? null : filters.isGroup,
          p_include_ids: filters?.includeIds?.length ? filters.includeIds : null,
          p_closed_visible_to: filters?.closedVisibleTo ?? null,
          p_auto_reply_disabled_only: filters?.autoReplyDisabledOnly ?? false,
          p_rules_disabled_only: filters?.rulesDisabledOnly ?? false,
          p_limit: pageSize,
          p_offset: pageParam as number,
        }
      );
      if (rpcError) throw rpcError;

      const result = ((rows ?? []) as any[]).map((row) => ({
        ...row.conversation,
        contact: row.contact,
        bucket: row.bucket,
        queue_since: row.queue_since ?? null,
        unread_count: parseInt(String(row.conversation?.unread_count ?? 0), 10) || 0,
        last_message_at: row.conversation?.last_message_at || null,
        isLastMessageFromMe: row.conversation?.is_last_message_from_me ?? false,
      })) as ConversationWithContact[];

      const ids = result.map((c) => c.id);
      if (ids.length === 0) return result;

      const { data: sData } = await (supabase.from('whatsapp_sentiment_analysis' as any) as any)
        .select('conversation_id, needs_cs_ticket, cs_ticket_created_id, churn_dismissed_at, churn_dismissed_attendance_id')
        .in('conversation_id', ids);
      const sentimentMap = new Map((sData ?? []).map((s: any) => [s.conversation_id, s]));
      return result.map((c) => ({ ...c, sentiment: (sentimentMap.get(c.id) as any) ?? null }));
    },
    enabled: !!tid,
  });

  const conversations = useMemo(
    () => (data?.pages ?? []).flat() as ConversationWithContact[],
    [data]
  );

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Reconexão do canal: `postgres_changes` NÃO tem replay. O que acontece
  // enquanto o socket está caído não chega por Realtime nunca, e a lista só se
  // recuperava no poll de 60s ou no F5 — o contador, não, porque tem caminho
  // próprio e staleTime menor. Medido em 18/08: atendimento criado às
  // 13:18:17,9, `whatsapp_pill_counts` em 2,9s, `whatsapp_list_conversations`
  // só 68,7s depois.
  //
  // E não é caso raro: em produção NENHUMA assinatura de `realtime.subscription`
  // vive mais de 56 min e a mediana é 15 — o canal é refeito o tempo todo.
  //
  // O primeiro SUBSCRIBED da sessão só calibra: a query acabou de buscar e um
  // refetch aqui seria puro desperdício em toda montagem. Do segundo em diante
  // é rejoin, e aí a lista vai buscar a janela que perdeu.
  const jaAssinouRef = useRef(false);
  const onChannelStatus = useCallback((status: string) => {
    if (status !== 'SUBSCRIBED') return;
    if (!jaAssinouRef.current) {
      jaAssinouRef.current = true;
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
  }, [queryClient]);

  // Realtime: canal compartilhado com ref-count para não colidir entre montagens
  useEffect(() => {
    const channelName = `conversations-rt-${tid ?? 'none'}`;
    return subscribeSharedChannel(channelName, (channel) => {
      let pillCountsTimer: ReturnType<typeof setTimeout> | null = null;
      const invalidatePillCounts = () => {
        if (pillCountsTimer) clearTimeout(pillCountsTimer);
        pillCountsTimer = setTimeout(() => {
          pillCountsTimer = null;
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'pill-counts'] });
        }, 1000);
      };

      // Refetch da lista coalescido. Com paginação no servidor um refetch refaz
      // todas as páginas carregadas, então a janela de coalescing importa mais
      // do que antes — nada de invalidar por evento.
      let listRefetchTimer: ReturnType<typeof setTimeout> | null = null;
      const invalidateList = () => {
        if (listRefetchTimer) return;
        listRefetchTimer = setTimeout(() => {
          listRefetchTimer = null;
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
        }, 2000);
      };

      channel.on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      }, (payload) => {
        const updated = payload.new as any;
        // DEM-0258: grupo também é uma linha de whatsapp_pill_counts agora —
        // invalidatePillCounts() cobre os dois casos, sem query separada.
        invalidatePillCounts();

        queryClient.setQueriesData({ queryKey: ['whatsapp', 'conversations'] }, (old: any) => {
          if (!old?.pages) return old;

          let existing: any = null;
          for (const page of old.pages) {
            const hit = page.find((c: any) => c.id === updated.id);
            if (hit) { existing = hit; break; }
          }

          // Fora das páginas carregadas: pode ter entrado no bucket ativo agora.
          if (!existing) { invalidateList(); return old; }

          // assigned_to / department_id / status mudaram → o bucket ou a
          // elegibilidade podem ter mudado, e isso é decisão do servidor.
          if (
            existing.assigned_to !== updated.assigned_to ||
            existing.department_id !== updated.department_id ||
            existing.status !== updated.status
          ) {
            invalidateList();
            return old;
          }

          // Patch normal. A ordenação final é do consumidor (sortBy da sidebar).
          return {
            ...old,
            pages: old.pages.map((page: any[]) => {
              const idx = page.findIndex((c: any) => c.id === updated.id);
              if (idx === -1) return page;
              const patched = [...page];
              patched[idx] = {
                ...patched[idx],
                ...updated,
                unread_count:
                  parseInt(String(updated.unread_count ?? patched[idx].unread_count ?? 0), 10) || 0,
              };
              return patched;
            }),
          };
        });
      });

      channel.on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      }, (payload) => {
        invalidatePillCounts();
        invalidateList();
      });

      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_sentiment_analysis',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      } as any, () => {
        invalidateList();
      });

      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'support_attendances',
        filter: tid ? `tenant_id=eq.${tid}` : undefined,
      } as any, () => {
        invalidatePillCounts();
        // Abrir/fechar/assumir atendimento move a conversa de bucket, e o bucket
        // agora é filtro do servidor — sem isto ela ficaria na pill errada até o
        // refetch de 60s.
        invalidateList();
      });
    }, onChannelStatus);
  }, [queryClient, tid, onChannelStatus]);

  // ---------------------------------------------------------------------------
  // Canal do OPERADOR — o chat transferido tem que estar na tela dele
  // ---------------------------------------------------------------------------
  //
  // O canal acima é do TENANT INTEIRO, e é o único aviso que a lista tinha de
  // que um chat mudou de dono. Quando ele falha, a lista só se conserta no
  // refetchInterval de 60s — que NÃO corre com a aba em segundo plano. Foi o
  // caso medido em 25/08: transferência às 09:07:42 e o cartão só apareceu
  // quando o cliente escreveu, 32 min depois. Em três transferências do mesmo
  // dia com o destinatário logado (11:47:18, 11:58:00, 12:17:42) nenhuma
  // produziu busca dentro dos 2s do canal do tenant — todas esperaram a batida
  // do poll. E naquele momento 4 dos 39 operadores com o Chat aberto nem tinham
  // o canal do tenant registrado no servidor (realtime.subscription).
  //
  // Este canal é estreito de propósito: assina só o que é MEU (o atendimento
  // atribuído a mim) e o que é do MEU SETOR (a fila). É a mesma forma da
  // assinatura do sino (`notification_recipients` por user_id), que é a que
  // sobrevive hoje. Um caminho não cobre o outro — são independentes.
  //
  // O setor entra no NOME do topic porque `subscribeSharedChannel` roda o
  // `configure` uma vez só, no primeiro assinante: se o setor chegasse depois
  // (a query é assíncrona) o `.on` dele nunca seria registrado no canal já
  // montado. Topic novo = canal novo com os dois handlers.
  useEffect(() => {
    if (!tid || !uid) return;
    const topic = `minhas-atribuicoes-${uid}-${meuSetorId ?? 'sem-setor'}`;
    return subscribeSharedChannel(topic, (channel) => {
      // Coalescing de 1s: a transferência escreve conversa e atendimento na
      // mesma transação, então os dois handlers podem cair juntos.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const recarregar = () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
          queryClient.invalidateQueries({ queryKey: ['whatsapp', 'pill-counts'] });
          queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
        }, 1000);
      };

      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'support_attendances',
        filter: `assigned_to=eq.${uid}`,
      } as any, recarregar);

      if (meuSetorId) {
        channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'support_attendances',
          filter: `department_id=eq.${meuSetorId}`,
        } as any, recarregar);
      }
    });
  }, [queryClient, tid, uid, meuSetorId]);

  return {
    conversations,
    isLoading,
    error,
    loadMore,
    hasMore: !!hasNextPage,
    isLoadingMore: isFetchingNextPage,
  };
};
