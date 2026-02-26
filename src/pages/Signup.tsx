import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function Signup() {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<{ email: string; role: string; tenant_id: string } | null>(null);
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken);

  // Load invite info if token is present
  useEffect(() => {
    if (!inviteToken) return;
    (async () => {
      const { data: rows, error } = await supabase
        .rpc("validate_invite_token", { p_token: inviteToken });
      const data = rows && rows.length > 0 ? rows[0] : null;
      setInviteLoading(false);
      if (error || !data) {
        toast.error("Convite inválido ou expirado.");
        return;
      }
      setInviteInfo(data);
      setEmail(data.email);
    })();
  }, [inviteToken]);

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

    // If invite token, accept invite via secure RPC
    if (inviteToken && signUpData.user) {
      const { error: acceptError } = await supabase.rpc("accept_invite", {
        p_token: inviteToken,
      });
      if (acceptError) {
        console.error("Error accepting invite:", acceptError);
      }
    }

    setLoading(false);
    toast.success("Verifique seu email para confirmar o cadastro.");
  };

  if (inviteLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
            {inviteInfo
              ? `Você foi convidado como ${inviteInfo.role}. Crie sua senha para acessar.`
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
                readOnly={!!inviteInfo}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cadastrar
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Já tem conta?{" "}
            <Link to="/login" className="text-primary hover:underline">Entrar</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
