import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { maskCNPJ } from "@/lib/masks";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";

export default function Onboarding() {
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [domain, setDomain] = useState("");
  const [saving, setSaving] = useState(false);

  const cnpjDigits = cnpj.replace(/\D/g, "");
  const isValid = nome.trim().length >= 2 && cnpjDigits.length === 14 && domain.trim().length >= 3;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || saving) return;

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("create_tenant_for_new_user", {
        p_nome: nome.trim(),
        p_cnpj: cnpjDigits,
        p_allowed_domain: domain.trim().toLowerCase().replace(/^@/, ""),
        p_plano: "trial",
      });

      if (error) {
        const msg = error.message.includes("CNPJ already registered")
          ? "Este CNPJ já está cadastrado em outra empresa."
          : error.message;
        toast({ title: "Erro ao criar empresa", description: msg, variant: "destructive" });
        return;
      }

      await refreshProfile();
      toast({ title: "Empresa criada com sucesso!" });
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({ title: "Erro inesperado", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <Logo className="h-10" />
          </div>
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            <Building2 className="h-5 w-5" />
            Criar Empresa
          </CardTitle>
          <CardDescription>
            Preencha os dados para configurar sua organização.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome da empresa *</Label>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Minha Empresa LTDA"
                maxLength={100}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cnpj">CNPJ *</Label>
              <Input
                id="cnpj"
                value={cnpj}
                onChange={(e) => setCnpj(maskCNPJ(e.target.value))}
                placeholder="00.000.000/0000-00"
                maxLength={18}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="domain">Domínio permitido *</Label>
              <Input
                id="domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value.replace(/\s/g, ""))}
                placeholder="empresa.com.br"
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                Domínio de e-mail autorizado (sem @). Ex: empresa.com.br
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={!isValid || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Empresa
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
