import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, KeyRound, Loader2, Plug, RefreshCw, Save, Store } from "lucide-react";
import { Explica } from "./ui";
import type { Integracao } from "./useHiperDados";

export default function HiperConexaoTab({
  tid, integracao, refetch,
}: { tid: string | null; integracao: Integracao | null; refetch: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [trocando, setTrocando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const configurado = !!integracao?.ativo;
  const mostrarInput = !configurado || trocando;

  const { data: fornecedores } = useQuery({
    queryKey: ["hiper_fornecedores", tid],
    enabled: !!tid && configurado,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fornecedores").select("id, nome")
        .eq("tenant_id", tid as string).order("nome");
      if (error) throw error;
      return (data ?? []) as { id: number; nome: string }[];
    },
  });

  const salvarFornecedor = useMutation({
    mutationFn: async (fornecedorId: number) => {
      const { error } = await (supabase.from("hiper_integration" as any) as any)
        .update({ fornecedor_id: fornecedorId }).eq("tenant_id", tid as string);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hiper_integration"] });
      toast({ title: "Fornecedor do escopo salvo" });
    },
    onError: (e: any) =>
      toast({ title: "Erro ao salvar fornecedor", description: e.message, variant: "destructive" }),
  });

  const handleSave = async () => {
    if (!token.trim()) {
      toast({ title: "Informe o token", description: "Cole o token gerado no PortalHiper.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("hiper-integration-save", {
        body: { token: token.trim(), tenant_id: tid },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Não foi possível conectar.");
      setToken(""); setTrocando(false);
      toast({
        title: data.portal_tenant_nome ? `Conectado a ${data.portal_tenant_nome}` : "Integração conectada",
        description: data.aviso ?? undefined,
      });
      refetch();
    } catch (e: any) {
      toast({ title: "Erro ao conectar", description: e.message || "Erro de rede.", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("hiper-integration-call", {
        body: { acao: "testar", tenant_id: tid },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao testar conexão.");
      const r = data.resultado ?? {};
      toast({
        title: r.portal_tenant_nome ? `Conexão OK — ${r.portal_tenant_nome}` : "Conexão OK",
        description: r.portal_atualizado === false
          ? "O portal respondeu, mas ainda é a versão sem módulos e filiais."
          : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["hiper_integration"] });
    } catch (e: any) {
      toast({ title: "Erro no teste", description: e.message || "Erro de rede.", variant: "destructive" });
    } finally { setTesting(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plug className="h-5 w-5" />Status da conexão</CardTitle>
          <CardDescription>Estado da integração com o PortalHiper para esta empresa.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              {integracao?.ultimo_status === "erro"
                ? <Badge variant="destructive" className="w-fit">Erro na última verificação</Badge>
                : configurado
                ? <Badge className="w-fit bg-emerald-600 hover:bg-emerald-600 text-white">Conectado</Badge>
                : <Badge variant="secondary" className="w-fit">Não conectado</Badge>}

              {/* De QUAL empresa do portal é este token. Sem isso ninguém na tela
                  sabe qual carteira está sendo espelhada — e um token colado no
                  lugar errado espelharia a de outra revenda. */}
              {configurado && (
                integracao?.portal_tenant_nome ? (
                  <span className="flex items-center gap-1.5 text-sm">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Carteira de <strong>{integracao.portal_tenant_nome}</strong> no PortalHiper
                  </span>
                ) : (
                  <span className="text-xs text-amber-600 dark:text-amber-500">
                    Não dá para provar de qual empresa este token é: o portal ainda não expõe
                    <code className="mx-1">/api/integ/v1/me</code>. Atualize o portal e salve o token de novo.
                  </span>
                )
              )}

              {integracao?.ultimo_teste_at && (
                <span className="text-xs text-muted-foreground">
                  Último teste: {new Date(integracao.ultimo_teste_at).toLocaleString("pt-BR")}
                </span>
              )}
              {integracao?.ultimo_pull_at && (
                <span className="text-xs text-muted-foreground">
                  Último espelho: {new Date(integracao.ultimo_pull_at).toLocaleString("pt-BR")}
                </span>
              )}
            </div>
            {configurado && (
              <Button variant="outline" size="sm" onClick={handleTest} disabled={testing} className="shrink-0">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Testar conexão
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Token de integração</CardTitle>
          <CardDescription>
            Gerado no PortalHiper, em Painel → Integração. É guardado cifrado e nunca mais exibido.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mostrarInput ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="hiper-token">Token</Label>
                <Input id="hiper-token" type="password" autoComplete="new-password" placeholder="hig_…"
                  value={token} onChange={(e) => setToken(e.target.value)} disabled={saving} />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar e conectar
                </Button>
                {configurado && (
                  <Button variant="ghost" onClick={() => { setTrocando(false); setToken(""); }} disabled={saving}>
                    Cancelar
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Token configurado ••••••••</span>
              <Button variant="outline" size="sm" onClick={() => setTrocando(true)}>Trocar token</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {configurado && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" />Escopo — fornecedor</CardTitle>
            <CardDescription>
              A amarra que impede o cruzamento de tocar a base inteira.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Explica>
              Nem todo cliente seu é Hiper. Só entram no cruzamento os clientes que têm
              contrato <strong>ativo</strong> com este fornecedor. Sem escolher, a
              reconciliação não roda.
            </Explica>
            <Label htmlFor="hiper-fornecedor">Fornecedor</Label>
            <Select
              value={integracao?.fornecedor_id ? String(integracao.fornecedor_id) : undefined}
              onValueChange={(v) => salvarFornecedor.mutate(Number(v))}
              disabled={salvarFornecedor.isPending}
            >
              <SelectTrigger id="hiper-fornecedor" className="max-w-sm">
                <SelectValue placeholder="Selecione o fornecedor Hiper" />
              </SelectTrigger>
              <SelectContent>
                {(fornecedores ?? []).map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!integracao?.fornecedor_id && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Defina o fornecedor antes de sincronizar.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
