import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Clientes() {
  const navigate = useNavigate();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="mt-1 text-muted-foreground">Gerencie seus clientes aqui.</p>
        </div>
        <Button onClick={() => navigate("/clientes/novo")}>
          <Plus className="h-4 w-4" />
          Novo Cliente
        </Button>
      </div>
    </div>
  );
}
