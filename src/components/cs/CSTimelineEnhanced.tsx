import { useState, useRef } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CS_UPDATE_TIPO_LABELS, type CSTicketUpdate, type CSUpdateTipo } from './types';
import { MessageSquare, ArrowUpDown, UserCheck, AlertTriangle, Sparkles, CheckCircle, Send, Loader2, Lock, Eye, ArrowDown, Filter, ChevronDown, MessageCircle } from 'lucide-react';

interface CSTimelineEnhancedProps {
  ticketId: string;
  clientePhone?: string | null;
  isStickyMode?: boolean;
}

type FilterType = 'all' | 'comentario' | 'mudanca_status';

const TIPO_ICONS: Record<CSUpdateTipo, React.ReactNode> = {
  comentario: <MessageSquare className="h-4 w-4" />, mudanca_status: <ArrowUpDown className="h-4 w-4" />,
  mudanca_prioridade: <AlertTriangle className="h-4 w-4" />, mudanca_owner: <UserCheck className="h-4 w-4" />,
  nota_ia: <Sparkles className="h-4 w-4" />, registro_acao: <CheckCircle className="h-4 w-4" />,
};

const TIPO_COLORS: Record<CSUpdateTipo, string> = {
  comentario: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  mudanca_status: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300',
  mudanca_prioridade: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  mudanca_owner: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  nota_ia: 'bg-primary/10 text-primary', registro_acao: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
};

const PAGE_SIZE = 50;

export function CSTimelineEnhanced({ ticketId, isStickyMode = false }: CSTimelineEnhancedProps) {
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['cs-ticket-updates-paginated', ticketId, filter],
    queryFn: async ({ pageParam = 0 }) => {
      let query = supabase.from('cs_ticket_updates')
        .select(`*, criado_por:funcionarios!cs_ticket_updates_criado_por_id_fkey (id, nome, cargo)`)
        .eq('ticket_id', ticketId)
        .order('criado_em', { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (filter === 'comentario') query = query.eq('tipo', 'comentario');
      else if (filter === 'mudanca_status') query = query.in('tipo', ['mudanca_status', 'mudanca_prioridade', 'mudanca_owner']);

      const { data, error } = await query;
      if (error) throw error;
      return { updates: data as unknown as CSTicketUpdate[], nextPage: data.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
    enabled: !!ticketId,
  });

  const allUpdates = data?.pages.flatMap(page => page.updates) || [];

  const addUpdate = useMutation({
    mutationFn: async (d: { conteudo: string; tipo: CSUpdateTipo; privado: boolean }) => {
      const { error } = await supabase.from('cs_ticket_updates').insert({ ticket_id: ticketId, tipo: d.tipo, conteudo: d.conteudo, privado: d.privado } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['cs-ticket-updates-paginated', ticketId] }); setNewComment(''); toast.success('Comentário adicionado'); },
    onError: () => { toast.error('Erro ao adicionar comentário'); },
  });

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    addUpdate.mutate({ conteudo: newComment.trim(), tipo: 'comentario', privado: isPrivate });
  };

  if (isLoading) return <div className="space-y-4 p-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-16 w-full" /></div>;

  return (
    <div className={`flex flex-col h-full ${isStickyMode ? 'min-h-0' : ''}`}>
      <div className="flex items-center justify-between gap-2 p-3 border-b bg-background shrink-0">
        <h4 className="font-medium text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4" />Timeline</h4>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
            <SelectTrigger className="h-8 w-[140px] text-xs"><Filter className="h-3 w-3 mr-1" /><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="comentario">Comentários</SelectItem><SelectItem value="mudanca_status">Mudanças</SelectItem></SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}><ArrowDown className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="space-y-2 p-3 border-b bg-muted/30 shrink-0">
        <Textarea placeholder="Adicionar comentário..." value={newComment} onChange={(e) => setNewComment(e.target.value)} rows={2} className="resize-none text-sm" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch id="private" checked={isPrivate} onCheckedChange={setIsPrivate} />
            <Label htmlFor="private" className="text-xs flex items-center gap-1">{isPrivate ? <Lock className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{isPrivate ? 'Privado' : 'Visível'}</Label>
          </div>
          <Button size="sm" onClick={handleAddComment} disabled={!newComment.trim() || addUpdate.isPending} className="h-8">
            {addUpdate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-3 w-3 mr-1" />Enviar</>}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-1">
          {allUpdates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma atualização registrada</p>
          ) : (
            <>
              {allUpdates.map((update, index) => (
                <div key={update.id} className="relative flex gap-3 pb-3">
                  {index < allUpdates.length - 1 && <div className="absolute left-[17px] top-10 w-0.5 h-[calc(100%-24px)] bg-border" />}
                  <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${TIPO_COLORS[update.tipo]}`}>{TIPO_ICONS[update.tipo]}</div>
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-xs">{update.criado_por?.nome || 'Sistema'}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 h-5">{CS_UPDATE_TIPO_LABELS[update.tipo]}</Badge>
                      {update.privado && <Badge variant="secondary" className="text-[10px] px-1.5 h-5 gap-0.5"><Lock className="h-2.5 w-2.5" />Privado</Badge>}
                      <span className="text-[10px] text-muted-foreground ml-auto">{format(new Date(update.criado_em), "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{update.conteudo}</p>
                  </div>
                </div>
              ))}
              {hasNextPage && (
                <div className="flex justify-center pt-2">
                  <Button variant="ghost" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="text-xs">
                    {isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}Carregar mais
                  </Button>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
