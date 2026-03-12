import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface FiliaisSectionProps {
  clienteId: string;
}

export default function FiliaisSection({ clienteId }: FiliaisSectionProps) {
  const navigate = useNavigate();
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: filiais } = useQuery({
    queryKey: ["filiais", clienteId, tid],
    queryFn: async () => {
      let q = supabase
        .from("clientes")
        .select("id, codigo_sequencial, nome_fantasia, razao_social, cancelado")
        .eq("matriz_id", clienteId);
      if (tid) q = q.eq("tenant_id", tid);
      q = q.order("codigo_sequencial", { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!clienteId,
  });

  if (!filiais || filiais.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Building2 className="h-5 w-5 text-primary" />
          Filiais vinculadas
          <Badge variant="secondary" className="ml-1">{filiais.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Código</TableHead>
              <TableHead>Nome Fantasia</TableHead>
              <TableHead className="hidden sm:table-cell">Razão Social</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filiais.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-mono text-sm">{f.codigo_sequencial}</TableCell>
                <TableCell>{f.nome_fantasia || "—"}</TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                  {f.razao_social || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={f.cancelado ? "destructive" : "default"} className="text-xs">
                    {f.cancelado ? "Cancelado" : "Ativo"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate(`/clientes/${f.id}`)}
                    title="Abrir filial"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
