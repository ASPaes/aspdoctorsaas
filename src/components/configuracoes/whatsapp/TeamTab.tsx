import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Users } from "lucide-react";

function useConversationCounts() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ["whatsapp-conversation-counts", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("assigned_to")
        .eq("status", "active")
        .not("assigned_to", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        if (row.assigned_to) {
          counts[row.assigned_to] = (counts[row.assigned_to] || 0) + 1;
        }
      }
      return counts;
    },
  });
}

export default function TeamTab() {
  const { data: users, isLoading: usersLoading } = useTenantUsers();
  const { data: counts, isLoading: countsLoading } = useConversationCounts();

  const isLoading = usersLoading || countsLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const activeUsers = users?.filter(u => u.status === "ativo") ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Equipe WhatsApp
        </CardTitle>
        <CardDescription>
          Membros da equipe que podem atender conversas no WhatsApp. Gerencie membros em Configurações &gt; Usuários.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {activeUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum membro ativo encontrado.</p>
        ) : (
          <div className="divide-y divide-border">
            {activeUsers.map(user => {
              const initials = (user.email ?? "?").substring(0, 2).toUpperCase();
              const convCount = counts?.[user.user_id] ?? 0;
              return (
                <div key={user.user_id} className="flex items-center gap-3 py-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user.email}</p>
                    <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="gap-1 text-xs">
                      <MessageSquare className="h-3 w-3" />
                      {convCount}
                    </Badge>
                    <Badge variant={user.status === "ativo" ? "default" : "secondary"} className="text-xs">
                      {user.status === "ativo" ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
