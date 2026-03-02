import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { TechBackground } from "@/components/TechBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      <TechBackground />

      {/* Glow behind card */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
          "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(142 71% 45% / 0.05) 0%, transparent 70%)"
        }}
        aria-hidden="true" />

      <Card className="relative z-10 w-full max-w-[440px] mx-4 border-border/60 bg-card/95 shadow-xl backdrop-blur-sm">
        <CardHeader className="space-y-4 pb-2 text-center">
          <div className="mx-auto">
            <Logo size="xl" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Bem-vindo ao DoctorSaaS
            </h1>
            <p className="text-sm font-light italic text-muted-foreground">Business Analytics
Measured Success
            </p>
          </div>
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
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
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