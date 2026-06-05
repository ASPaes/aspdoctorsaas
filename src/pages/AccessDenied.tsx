import { ShieldOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function AccessDenied() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-background px-4 text-center text-foreground">
      <ShieldOff className="mb-6 h-16 w-16 text-muted-foreground" />
      <h1 className="mb-2 text-2xl font-semibold">Sem acesso</h1>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">
        Você não tem permissão para acessar esta área. Entre em contato com o administrador.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => navigate(-1)}>Voltar</Button>
        <Button variant="outline" onClick={() => navigate("/")}>
          Ir para o início
        </Button>
      </div>
    </div>
  );
}
