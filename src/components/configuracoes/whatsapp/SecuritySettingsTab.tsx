import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, ExternalLink, Globe, UserCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function SecuritySettingsTab() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const allowedDomain = (profile as any)?.allowed_domain ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Domínio Permitido
          </CardTitle>
          <CardDescription>
            Usuários com e-mail neste domínio são aprovados automaticamente ao aceitar um convite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {allowedDomain ? (
            <Badge variant="outline" className="text-sm px-3 py-1">@{allowedDomain}</Badge>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum domínio configurado. Todos os novos acessos precisarão de aprovação manual.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Aprovação de Acessos
          </CardTitle>
          <CardDescription>
            Gerencie solicitações de acesso pendentes e usuários bloqueados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate("/configuracoes?tab=aprovacoes")}>
            <Shield className="h-4 w-4 mr-2" />
            Ir para Aprovação de Acessos
            <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
