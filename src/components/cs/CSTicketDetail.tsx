import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, MessageSquare } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCSTicket } from './hooks/useCSTickets';
import { CSTicketDetailContent } from './CSTicketDetailContent';
import { CSTimelineEnhanced } from './CSTimelineEnhanced';
import type { CSTicket } from './types';

interface CSTicketDetailProps {
  ticket: CSTicket | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'view' | 'edit';
}

export function CSTicketDetail({ ticket, open, onOpenChange, mode }: CSTicketDetailProps) {
  const isMobile = useIsMobile();
  const { data: ticketData, isLoading } = useCSTicket(ticket?.id || null);
  const [showMobileTimeline, setShowMobileTimeline] = useState(false);
  const currentTicket = ticketData || ticket;

  useEffect(() => { if (open) setShowMobileTimeline(false); }, [open]);

  const desktopContent = (
    <div className="flex h-[calc(90vh-80px)] gap-4">
      <ScrollArea className="flex-1 min-w-0">
        <div className="pr-4 pb-4">
          {isLoading ? <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div> :
            currentTicket ? <CSTicketDetailContent ticket={currentTicket} mode={mode} onClose={() => onOpenChange(false)} /> : null}
        </div>
      </ScrollArea>
      <div className="w-[380px] shrink-0 border-l flex flex-col min-h-0">
        {currentTicket && <CSTimelineEnhanced ticketId={currentTicket.id} clientePhone={currentTicket.cliente?.telefone_whatsapp} isStickyMode />}
      </div>
    </div>
  );

  const mobileContent = (
    <div className="flex flex-col h-[calc(95vh-60px)]">
      <div className="flex gap-2 p-2 border-b shrink-0">
        <Button variant={!showMobileTimeline ? 'default' : 'outline'} size="sm" className="flex-1" onClick={() => setShowMobileTimeline(false)}>Detalhes</Button>
        <Button variant={showMobileTimeline ? 'default' : 'outline'} size="sm" className="flex-1 gap-1" onClick={() => setShowMobileTimeline(true)}>
          <MessageSquare className="h-4 w-4" />Timeline
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        {isLoading ? <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div> :
          currentTicket ? (showMobileTimeline ? <CSTimelineEnhanced ticketId={currentTicket.id} isStickyMode /> :
            <ScrollArea className="h-full"><div className="p-4"><CSTicketDetailContent ticket={currentTicket} mode={mode} onClose={() => onOpenChange(false)} /></div></ScrollArea>
          ) : null}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] p-0">
          <SheetHeader className="px-4 py-3 border-b"><SheetTitle>{mode === 'edit' ? 'Editar Ticket' : 'Detalhes do Ticket'}</SheetTitle></SheetHeader>
          {mobileContent}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0"><DialogTitle>{mode === 'edit' ? 'Editar Ticket' : 'Detalhes do Ticket'}</DialogTitle></DialogHeader>
        <div className="px-6 py-4">{desktopContent}</div>
      </DialogContent>
    </Dialog>
  );
}
