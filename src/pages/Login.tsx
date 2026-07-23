import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { LoginBackdrop } from "@/components/LoginBackdrop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { signInWithPassword } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signInWithPassword(email, password);
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      navigate("/clientes", { replace: true });
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background">
      <LoginBackdrop />

      <Card className="relative z-10 w-full max-w-[480px] mx-4 rounded-2xl border border-white/10 bg-card/70 shadow-[0_28px_80px_-24px_rgba(0,0,0,0.85)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/5">
        <CardHeader className="space-y-3 pb-2 text-center">
          <div className="mx-auto flex flex-col items-center gap-1.5">
            <Logo size="2xl" />
            <p className="text-[11px] font-light italic tracking-wide text-muted-foreground/70">
              Business Analytics · Measured Success
            </p>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Seja bem-vindo
          </h1>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="pr-10" />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full shadow-[0_10px_34px_-8px_hsl(142_71%_45%/0.65)] transition-shadow hover:shadow-[0_12px_40px_-6px_hsl(142_71%_45%/0.8)]"
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
          </form>

          <div className="mt-4 flex flex-col items-center gap-2 text-sm">
            <Link
              to="/forgot-password"
              className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
              Esqueci minha senha
            </Link>
            <span className="text-muted-foreground">
              Não tem conta?{" "}
              <Link
                to="/signup"
                className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                Cadastre-se
              </Link>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>);

}