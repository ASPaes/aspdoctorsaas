import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Coluna "Mobile" de Configurações › Equipe › Acessos & Permissões. Quem está
 * com Não faz login no mobile.doctorsaas.com.br e para aqui.
 *
 * Pergunta ao banco (`pode_usar_mobile`) e não ao `usePermissions`: em empresa
 * com RBAC desligado o `get_my_permissions` libera tudo, e o Não não valeria.
 *
 * Erro na consulta deixa passar. É portão de tela: bloquear todo mundo porque
 * a função ainda não subiu seria pior do que deixar alguém entrar.
 *
 * Sair daqui encerra só a sessão do telefone (`signOut` local), sem derrubar o
 * app aberto no computador.
 */
export default function MobileAccessGuard({ children }: { children: ReactNode }) {
  const { user, profile, signOut } = useAuth();

  const { data: liberado, isLoading } = useQuery<boolean>({
    queryKey: ["pode-usar-mobile", user?.id],
    enabled: !!user?.id && !profile?.is_super_admin,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("pode_usar_mobile");
      if (error) {
        console.warn("[MobileAccessGuard] pode_usar_mobile falhou, liberando:", error.message);
        return true;
      }
      return data !== false;
    },
  });

  if (profile?.is_super_admin) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (liberado !== false) return <>{children}</>;

  return (
    <div className="flex h-[100dvh] items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Smartphone className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="mb-2 text-xl font-semibold text-foreground">Sem acesso ao mobile</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Seu usuário não tem acesso ao DoctorSaaS pelo telefone. Fale com o gestor da sua área
          para liberar.
        </p>
        <Button className="w-full" onClick={() => signOut()}>
          Sair
        </Button>
      </div>
    </div>
  );
}
