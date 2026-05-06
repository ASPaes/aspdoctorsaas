import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Search, Loader2, AlertTriangle, ExternalLink, VolumeX } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface UraBattleRow {
  conversation_id: string;
  contact_name: string | null;
  phone_number: string | null;
  instance_id: string | null;
  conversation_status: string;
  is_paused: boolean;
  battle_buckets: number;
  total_battle_msgs: number;
  worst_at: string;
  worst_our: number;
  worst_their: number;
  conversation_updated_at: string;
}

export default function LimpezaUras() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || (profile as any)?.is_super_admin;

  const [days, setDays] = useState("90");
  const [results, setResults] = useState<UraBattleRow[] | null>(null);

  const scanMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("scan_ura_battle_conversations" as any, {
        p_days: parseInt(days, 10),
      });
      if (error) throw error;
      return (data ?? []) as UraBattleRow[];
    },
    onSuccess: (data) => {
      setResults(data);
      if (data.length === 0) {
        toast.success("Nenhuma briga de URA detectada no período.");
      } else {
        toast.success(`${data.length} conversa(s) com possível briga de URA encontrada(s).`);
      }
    },
    onError: (err: any) => {
      const msg = err?.message || "Erro ao executar varredura";
      if (msg.includes("forbidden")) {
        toast.error("Você não tem permissão para acessar esta página");
      } else {
        toast.error(msg);
      }
    },
  });

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm">Acesso restrito a administradores.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleOpenConversation = (row: UraBattleRow) => {
    navigate(`/whatsapp?conversation=${row.conversation_id}&action=cleanup`);
  };

  const formatDateTime = (iso: string) => {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/whatsapp")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Voltar ao chat
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            🧹 Limpeza de Brigas de URA
          </CardTitle>
          <CardDescription>
            Detecta conversas onde a nossa URA e a URA do cliente entraram em loop automático (mensagens repetidas, alternadas, em rajadas). Use para identificar conversas que estão poluindo o banco e fazer a limpeza individualmente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Período</Label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Últimos 7 dias</SelectItem>
                  <SelectItem value="30">Últimos 30 dias</SelectItem>
                  <SelectItem value="90">Últimos 90 dias</SelectItem>
                  <SelectItem value="180">Últimos 180 dias</SelectItem>
                  <SelectItem value="365">Último ano</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
              {scanMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Pesquisando...</>
              ) : (
                <><Search className="h-4 w-4 mr-2" /> Pesquisar</>
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            A varredura analisa mensagens dos últimos {days} dias e identifica buckets de 5 minutos com pelo menos 4 mensagens automáticas nossas + 2 mensagens repetidas do bot do cliente.
          </p>
        </CardContent>
      </Card>

      {results !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Resultados ({results.length})</CardTitle>
            {results.length > 0 && (
              <CardDescription>
                Clique em "Abrir conversa" para revisar e limpar individualmente.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                🎉 Nenhuma briga de URA detectada no período. Banco limpo!
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contato</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Buckets</TableHead>
                    <TableHead>Msgs briga</TableHead>
                    <TableHead>Pior bucket</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((row) => (
                    <TableRow key={row.conversation_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {row.is_paused && <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
                          <span>{row.contact_name || "Sem nome"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.phone_number || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {row.conversation_status === "closed" ? "Encerrada" : row.conversation_status === "active" ? "Ativa" : row.conversation_status}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.battle_buckets}</TableCell>
                      <TableCell>
                        <span className={row.total_battle_msgs >= 100 ? "text-destructive font-semibold" : ""}>
                          {row.total_battle_msgs}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDateTime(row.worst_at)}
                        <span className="text-muted-foreground ml-1">
                          ({row.worst_our}↗/{row.worst_their}↘)
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => handleOpenConversation(row)}>
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          Abrir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
