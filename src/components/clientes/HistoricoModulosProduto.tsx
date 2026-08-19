import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, ChevronDown, ChevronRight } from "lucide-react";

// ============================================================================
// O histórico de módulos de UM produto do cliente.
//
// Fechado por padrão e só busca quando abre: é informação de auditoria, olhada
// de vez em quando, e uma query por produto em toda ficha aberta sairia cara
// para quem nunca vai clicar.
// ============================================================================

type Evento = {
  id: string;
  modulo_nome: string;
  acao: string;
  quantidade: number | null;
  origem: string;
  usuario_nome: string | null;
  created_at: string;
};

// Rótulo e cor por ação. "cancelado" e "removido" são coisas diferentes e a
// tela não pode juntar: o primeiro saiu de circulação e continua na ficha, o
// segundo deixou de existir.
const ACOES: Record<string, { texto: string; classe: string }> = {
  adicionado: { texto: "Adicionado", classe: "bg-green-500/15 text-green-500 hover:bg-green-500/20" },
  reativado:  { texto: "Reativado",  classe: "bg-green-500/15 text-green-500 hover:bg-green-500/20" },
  cancelado:  { texto: "Cancelado",  classe: "bg-amber-500/15 text-amber-500 hover:bg-amber-500/20" },
  removido:   { texto: "Removido",   classe: "bg-red-500/15 text-red-500 hover:bg-red-500/20" },
  quantidade: { texto: "Quantidade", classe: "bg-sky-500/15 text-sky-500 hover:bg-sky-500/20" },
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

export default function HistoricoModulosProduto({ clienteProdutoId }: { clienteProdutoId: string }) {
  const [aberto, setAberto] = useState(false);

  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ["cliente_produto_modulo_eventos", clienteProdutoId],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cliente_produto_modulo_eventos" as any) as any)
        .select("id, modulo_nome, acao, quantidade, origem, usuario_nome, created_at")
        .eq("cliente_produto_id", clienteProdutoId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Evento[];
    },
  });

  return (
    <div className="space-y-2">
      <Button
        type="button" variant="ghost" size="sm"
        className="gap-1.5 px-2 text-muted-foreground"
        onClick={() => setAberto((v) => !v)}
      >
        {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <History className="h-4 w-4" />
        Histórico
      </Button>

      {aberto && (
        <div className="rounded border bg-background/50 overflow-x-auto">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : eventos.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Nenhuma movimentação registrada para este produto.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Ação</TableHead>
                  <TableHead>Módulo</TableHead>
                  <TableHead className="w-16 text-center">Qtd</TableHead>
                  <TableHead className="w-44">Quando</TableHead>
                  <TableHead className="w-52">Quem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventos.map((e) => {
                  const a = ACOES[e.acao] ?? { texto: e.acao, classe: "" };
                  return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Badge className={a.classe} variant={a.classe ? undefined : "secondary"}>
                          {a.texto}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{e.modulo_nome}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {e.quantidade ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {quando(e.created_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {/* Sem usuário e origem OEM não é lacuna: foi a
                            sincronização, e dizer "—" faria parecer que alguém
                            mexeu sem deixar rastro. */}
                        {e.usuario_nome
                          ? e.usuario_nome
                          : e.origem === "oem"
                            ? "Sincronização OEM"
                            : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
