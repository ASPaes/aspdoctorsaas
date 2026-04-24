import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Inbox } from 'lucide-react';
import { useConversationQueue } from '@/hooks/useConversationQueue';

interface SectorQueueBadgeProps {
  departmentId: string | null | undefined;
  departmentName?: string | null;
}

export function SectorQueueBadge({
  departmentId,
  departmentName,
}: SectorQueueBadgeProps) {
  const { count, isLoading } = useConversationQueue(departmentId);

  if (isLoading || count === 0) return null;

  const tooltipText = departmentName
    ? `${count} conversa(s) aguardando atendimento no setor ${departmentName}`
    : `${count} conversa(s) aguardando atendimento`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="text-[10px] h-4 gap-1 shrink-0 whitespace-nowrap border-amber-500/50 text-amber-600 dark:text-amber-400"
        >
          <Inbox className="h-2.5 w-2.5" />
          {count} na fila
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}
