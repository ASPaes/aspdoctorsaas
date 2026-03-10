import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, Loader2 } from 'lucide-react';
import { useWhatsAppConversations } from '../hooks/useWhatsAppConversations';
import { useForwardMessages } from '../hooks/useForwardMessages';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageIds: string[];
  onDone: () => void;
}

export function ForwardMessageDialog({ open, onOpenChange, messageIds, onDone }: Props) {
  const [search, setSearch] = useState('');
  const { conversations, isLoading } = useWhatsAppConversations({ search, pageSize: 50 });
  const forwardMutation = useForwardMessages();

  const handleSelect = async (targetConversationId: string) => {
    await forwardMutation.mutateAsync({ messageIds, targetConversationId });
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">Nenhuma conversa encontrada</p>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => (
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
