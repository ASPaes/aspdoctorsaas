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
  const [checking, setChecking] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const hashParams = new URLSearchParams(window.location.hash.replace("#", ""));
    const hashType = hashParams.get("type");
    const hashAccessToken = hashParams.get("access_token");

    if (code) {
      // PKCE flow: exchange code for session
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (error) {
          console.error("Code exchange failed:", error);
          toast.error("Link de redefinição inválido ou expirado.");
          navigate("/login", { replace: true });
        } else {
          setSessionReady(true);
          setChecking(false);
          window.history.replaceState({}, "", "/reset-password");
        }
      });
    } else if (hashType === "recovery" && hashAccessToken) {
      // Implicit flow: token is in the hash, supabase-js handles it automatically
      const checkSession = () => {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            setSessionReady(true);
            setChecking(false);
          } else {
            setTimeout(() => {
              supabase.auth.getSession().then(({ data: { session: s2 } }) => {
                if (s2) {
                  setSessionReady(true);
                } else {
                  toast.error("Link de redefinição inválido ou expirado.");
                  navigate("/login", { replace: true });
                }
                setChecking(false);
              });
            }, 2000);
          }
        });
      };
      checkSession();
    } else {
      toast.error("Link de redefinição inválido.");
      navigate("/login", { replace: true });
    }
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

  if (checking) {
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
