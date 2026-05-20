import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users } from "lucide-react";
import { formatBRPhone } from "@/lib/phoneBR";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupJid: string;
  instanceId: string;
}

interface Participant {
  phone: string;
  name: string | null;
  admin: boolean;
  isLid?: boolean;
}

export default function GroupParticipantsSheet({
  open,
  onOpenChange,
  groupJid,
  instanceId,
}: Props) {
  const { data: groupData } = useQuery({
    queryKey: ["whatsapp-group-participants", groupJid, instanceId],
    enabled: open && !!groupJid && !!instanceId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_groups")
        .select("participants, group_name, participant_count")
        .eq("group_jid", groupJid)
        .eq("instance_id", instanceId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        group_name: string | null;
        participant_count: number | null;
        participants: any;
      } | null;
    },
  });

  const participants: Participant[] = useMemo(() => {
    if (!groupData?.participants) return [];
    try {
      const parsed =
        typeof groupData.participants === "string"
          ? JSON.parse(groupData.participants)
          : groupData.participants;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [groupData?.participants]);

  const groupName = groupData?.group_name || groupJid;
  const count = groupData?.participant_count ?? participants.length;

  const getInitials = (name: string | null, phone: string) => {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
    }
    return phone.slice(-2).toUpperCase();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[320px] sm:w-[340px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-4 border-b border-border shrink-0">
          <SheetTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            {groupName}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            {count} participante{count !== 1 ? "s" : ""}
          </p>
          {participants.some((p) => p.isLid) && (
            <p className="text-[10px] text-amber-500/70 mt-1">
              Alguns participantes usam ID interno do WhatsApp (multi-device)
            </p>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1">
          {participants.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
              <Users className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                Sincronize os grupos nas configurações para ver os participantes
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {participants.map((p, idx) => (
                <div
                  key={`${p.phone}-${idx}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-[10px] bg-muted">
                      {getInitials(p.name, p.phone)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {p.name || (p.isLid ? 'Participante' : p.phone)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.isLid
                        ? `ID: ${p.phone.slice(0, 6)}...`
                        : formatBRPhone(p.phone)
                      }
                    </p>
                  </div>
                  {p.admin && (
                    <Badge variant="secondary" className="text-[10px] h-5 shrink-0">
                      Admin
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
