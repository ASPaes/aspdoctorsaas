import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for PASSWORD_RECOVERY event from Supabase auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true);
        setChecking(false);
      }
    });

    // Also check URL params for PKCE code
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          toast.error("Link expirado. Solicite um novo.");
          navigate("/login", { replace: true });
        }
        // PASSWORD_RECOVERY event will fire after exchange
      });
      return () => subscription.unsubscribe();
    }

    // Check hash params (implicit flow)
    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("access_token")) {
      // Supabase client will auto-detect and fire PASSWORD_RECOVERY event
      // Wait up to 5 seconds
      const timeout = setTimeout(() => {
        if (!sessionReady) {
          toast.error("Link expirado. Solicite um novo.");
          navigate("/login", { replace: true });
        }
      }, 5000);
      return () => { subscription.unsubscribe(); clearTimeout(timeout); };
    }

    // Check if already in a recovery session (page refresh)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
        setChecking(false);
      } else {
        // No params and no session - check if error in hash
        if (hash.includes("error")) {
          const hashParams = new URLSearchParams(hash.replace("#", ""));
          const errorDesc = hashParams.get("error_description") || "Link inválido";
          toast.error(errorDesc.replace(/\+/g, " "));
          navigate("/login", { replace: true });
        } else {
          toast.error("Acesse esta página pelo link enviado no email.");
          navigate("/login", { replace: true });
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Senha atualizada com sucesso!");
      navigate("/login", { replace: true });
    }
  };

  if (checking && !sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sessionReady) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <Logo size="xl" className="mx-auto mb-2" />
          <CardTitle className="text-xl">Redefinir senha</CardTitle>
          <CardDescription>Digite sua nova senha</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" required minLength={8} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Atualizar senha
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
