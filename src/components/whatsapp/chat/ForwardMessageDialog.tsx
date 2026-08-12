import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, Loader2 } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useWhatsAppConversations } from '../hooks/useWhatsAppConversations';
import { useConversationSearch } from '../hooks/useConversationSearch';
import { useForwardMessages } from '../hooks/useForwardMessages';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageIds: string[];
  onDone: () => void;
}

export function ForwardMessageDialog({ open, onOpenChange, messageIds, onDone }: Props) {
  const [search, setSearch] = useState('');
  const term = search.trim();
  const { conversations, isLoading } = useWhatsAppConversations({ pageSize: 50 });
  const forwardMutation = useForwardMessages();

  // A lista carregada é só a 1ª página (50 conversas). Filtrar apenas no cliente
  // deixaria qualquer contato fora dessa janela inalcançável no encaminhamento,
  // então a busca vai ao servidor — mesma RPC da sidebar do chat.
  const debouncedSearch = useDebouncedValue(term, 300);
  const isSearching = debouncedSearch.length >= 2;
  const { data: searchResults = [], isLoading: isSearchLoading } =
    useConversationSearch(debouncedSearch);

  // Filtro local: responde à tecla na hora (antes do debounce) e cobre a busca de
  // 1 caractere, que a RPC não atende.
  const localMatches = useMemo(() => {
    if (!term) return conversations;
    const q = term.toLowerCase();
    const digits = q.replace(/\D/g, '');
    return conversations.filter((c) => {
      const name = (c.contact?.name ?? '').toLowerCase();
      const phone = c.contact?.phone_number ?? '';
      return name.includes(q) || (digits.length > 0 && phone.includes(digits));
    });
  }, [conversations, term]);

  // Enquanto o servidor não respondeu pelo termo ATUAL, vale o filtro local — sem
  // isso a lista mostraria o resultado do termo anterior. Se a busca do servidor
  // voltar vazia mas houver correspondência na página carregada, mostra a local:
  // a RPC pode simplesmente não existir no banco e o erro chega como lista vazia.
  const serverReady = isSearching && !isSearchLoading && term === debouncedSearch;
  const results = !term
    ? conversations
    : serverReady && searchResults.length > 0
      ? searchResults
      : localMatches;

  const listLoading = term ? isSearchLoading && localMatches.length === 0 : isLoading;

  // O diálogo fica montado o tempo todo no ChatAreaFull — sem limpar aqui, a
  // busca anterior reaparece já filtrada na próxima abertura.
  const handleOpenChange = (next: boolean) => {
    if (!next) setSearch('');
    onOpenChange(next);
  };

  const handleSelect = async (targetConversationId: string) => {
    await forwardMutation.mutateAsync({ messageIds, targetConversationId });
    handleOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar {messageIds.length} mensagem{messageIds.length !== 1 ? 'ns' : ''}</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <ScrollArea className="h-[300px]">
          {listLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">Nenhuma conversa encontrada</p>
          ) : (
            <div className="space-y-1">
              {results.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleSelect(conv.id)}
                  disabled={forwardMutation.isPending}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent text-left transition-colors disabled:opacity-50"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={conv.contact?.profile_picture_url || undefined} />
                    <AvatarFallback className="text-xs">
                      {(conv.contact?.name || conv.contact?.phone_number || '?').slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {conv.contact?.name || conv.contact?.phone_number}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.contact?.phone_number}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
