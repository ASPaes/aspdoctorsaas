import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Clock, LogOut, User, Building2, Mail } from "lucide-react";

export default function AccessPending() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  const { data: context } = useQuery({
    queryKey: ["my-access-context", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_my_access_context");
      if (error) return null;
      return (data as any[])?.[0] ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-4">
            <Logo className="h-10" />
          </div>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/15">
            <Clock className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
          </div>
          <CardTitle>Acesso Pendente</CardTitle>
          <CardDescription>
            Seu acesso está aguardando aprovação do administrador da empresa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* User info */}
          {(context || user) && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-left space-y-2 text-sm">
              {context?.funcionario_nome && (
                <div className="flex items-center gap-2 text-foreground">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{context.funcionario_nome}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" />
                <span>{user?.email ?? "—"}</span>
              </div>
              {context?.department_name && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Building2 className="h-4 w-4 shrink-0" />
                  <span>{context.department_name}</span>
                </div>
              )}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Você receberá acesso assim que o administrador aprovar sua conta. Tente novamente mais tarde.
          </p>
          <Button variant="outline" className="w-full" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
