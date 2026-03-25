import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";

interface AccessInviteInfo {
  email: string;
  role: string;
  tenant_id: string;
  funcionario_id: number;
}

export default function Signup() {
  const [searchParams] = useSearchParams();
  const inviteId = searchParams.get("invite");
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Access invite state
  const [accessInvite, setAccessInvite] = useState<AccessInviteInfo | null>(null);
  const [inviteLoading, setInviteLoading] = useState(!!inviteId);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Validate access invite on mount
  useEffect(() => {
    if (!inviteId) return;
    (async () => {
      try {
        const { data: rows, error } = await (supabase.rpc as any)(
          "validate_access_invite",
          { p_invite_id: inviteId }
        );
        setInviteLoading(false);
        if (error || !rows || rows.length === 0) {
          setInviteError("Convite inválido ou expirado.");
          return;
        }
        const info = rows[0] as AccessInviteInfo;
        setAccessInvite(info);
        setEmail(info.email);
      } catch {
        setInviteLoading(false);
        setInviteError("Erro ao validar convite.");
      }
    })();
  }, [inviteId]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data: signUpData, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }

    // If access invite, accept it via secure RPC
    if (inviteId && signUpData.user) {
      const { error: acceptError } = await (supabase.rpc as any)(
        "accept_access_invite",
        { p_invite_id: inviteId }
      );
      if (acceptError) {
        console.error("Error accepting access invite:", acceptError);
        toast.error("Conta criada, mas houve erro ao vincular o convite. Contate o administrador.");
        setLoading(false);
        return;
      }
    }

    setLoading(false);

    if (inviteId && accessInvite) {
      toast.success("Conta criada com sucesso! Verifique seu email para confirmar.");
    } else {
      toast.success("Verifique seu email para confirmar o cadastro.");
    }
  };

  if (inviteLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Invalid invite — show error, no form
  if (inviteId && inviteError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3 pb-2">
            <div className="mx-auto">
              <Logo size="xl" />
            </div>
            <CardTitle className="text-xl">Convite Inválido</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="flex items-center justify-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <p>{inviteError}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              O convite pode ter expirado ou já foi utilizado. Solicite um novo convite ao administrador.
            </p>
            <Link to="/login">
              <Button variant="outline" className="w-full mt-2">Ir para Login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3 pb-2">
          <div className="mx-auto">
            <Logo size="xl" />
          </div>
          <CardTitle className="text-xl">Criar conta</CardTitle>
          <CardDescription>
            {accessInvite
              ? `Você foi convidado como ${accessInvite.role}. Crie sua senha para acessar.`
              : "Preencha os dados para se cadastrar"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                readOnly={!!accessInvite}
                className={accessInvite ? "bg-muted" : ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cadastrar
            </Button>
          </form>
          {!accessInvite && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Já tem conta?{" "}
              <Link to="/login" className="text-primary hover:underline">Entrar</Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
