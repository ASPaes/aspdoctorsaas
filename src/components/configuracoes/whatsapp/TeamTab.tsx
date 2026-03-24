import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Users } from "lucide-react";

interface TeamMember {
  user_id: string;
  funcionario_id: number;
  nome: string;
  cargo: string | null;
}

function useTeamMembers() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<TeamMember[]>({
    queryKey: ["whatsapp-team-members", tid],
    enabled: !!tid,
    queryFn: async () => {
      // Query profiles joined with funcionarios — accessible to all tenant members via RLS
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .eq("status", "ativo")
        .not("funcionario_id", "is", null);
      if (pErr) throw pErr;
      if (!profiles || profiles.length === 0) return [];

      const funcIds = profiles
        .map((p: any) => p.funcionario_id)
        .filter(Boolean);

      const { data: funcs, error: fErr } = await supabase
        .from("funcionarios")
        .select("id, nome, cargo")
        .eq("ativo", true)
        .in("id", funcIds);
      if (fErr) throw fErr;

      const funcMap = new Map((funcs ?? []).map((f: any) => [f.id, f]));

      return profiles
        .filter((p: any) => p.funcionario_id && funcMap.has(p.funcionario_id))
        .map((p: any) => {
          const f = funcMap.get(p.funcionario_id)!;
          return {
            user_id: p.user_id,
            funcionario_id: p.funcionario_id,
            nome: f.nome,
            cargo: f.cargo,
          };
        })
        .sort((a: TeamMember, b: TeamMember) => a.nome.localeCompare(b.nome));
    },
  });
}

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
  const { data: members, isLoading: membersLoading } = useTeamMembers();
  const { data: counts, isLoading: countsLoading } = useConversationCounts();

  const isLoading = membersLoading || countsLoading;

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

  const teamMembers = members ?? [];

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
        {teamMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum membro ativo encontrado.</p>
        ) : (
          <div className="divide-y divide-border">
            {teamMembers.map(member => {
              const initials = member.nome.substring(0, 2).toUpperCase();
              const convCount = counts?.[member.user_id] ?? 0;
              return (
                <div key={member.user_id} className="flex items-center gap-3 py-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{member.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {member.cargo ?? "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="gap-1 text-xs">
                      <MessageSquare className="h-3 w-3" />
                      {convCount}
                    </Badge>
                    <Badge variant="default" className="text-xs">
                      Ativo
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