import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Save, Plug, RefreshCw, KeyRound, Store } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function HiperIntegrationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const [token, setToken] = useState("");
  const [trocando, setTrocando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("conexao");

  const { data: integracao, isLoading, refetch } = useQuery({
    queryKey: ["hiper_integration", tid],
    enabled: !!tid,
    queryFn: async () => {
      // Filtrar explicitamente pelo tenant visualizado (super admin pode trocar de tenant).
      // Tabela sem TS type ainda — cast conforme convenção do projeto.
      const { data, error } = await (supabase.from("hiper_integration" as any) as any)
        .select("ativo, ultimo_status, ultimo_teste_at, fornecedor_id")
        .eq("tenant_id", tid as string)
        .maybeSingle();
      // Backend ainda não existe (tabela ausente): trata como "não conectado", sem quebrar a tela.
      if (error) {
        const code = (error as any)?.code;
        if (code === "PGRST205" || code === "42P01") return null;
        throw error;
      }
      return data;
    },
    retry: false,
  });

  const configurado = !!integracao?.ativo;
  const mostrarInput = !configurado || trocando;

  // Fornecedores do tenant — define o escopo da reconciliação (só clientes com este fornecedor).
  const { data: fornecedores } = useQuery({
    queryKey: ["hiper_fornecedores", tid],
    enabled: !!tid && configurado,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fornecedores")
        .select("id, nome")
        .eq("tenant_id", tid as string)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: number; nome: string }[];
    },
  });

  const salvarFornecedor = useMutation({
    mutationFn: async (fornecedorId: number | null) => {
      const { error } = await (supabase.from("hiper_integration" as any) as any)
        .update({ fornecedor_id: fornecedorId })
        .eq("tenant_id", tid as string);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hiper_integration"] });
      toast({ title: "Fornecedor do escopo salvo" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar fornecedor", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = async () => {
    if (!token.trim()) {
      toast({ title: "Informe o token", description: "Cole o token de integração para conectar.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("hiper-integration-save", {
        body: { token: token.trim(), tenant_id: tid },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Não foi possível conectar.");
      setToken("");
      setTrocando(false);
      toast({ title: "Integração conectada com sucesso" });
      await refetch();
    } catch (err: any) {
      toast({ title: "Erro ao conectar", description: err.message || "Erro de rede. Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("hiper-integration-call", {
        body: { acao: "testar", tenant_id: tid },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao testar conexão.");
      toast({ title: "Conexão OK" });
      queryClient.invalidateQueries({ queryKey: ["hiper_integration"] });
    } catch (err: any) {
      toast({ title: "Erro no teste", description: err.message || "Erro de rede. Tente novamente.", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const renderStatus = () => {
    if (integracao?.ultimo_status === "erro") {
      return <Badge variant="destructive">Erro na última verificação</Badge>;
    }
    if (configurado) {
      return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Conectado</Badge>;
    }
    return <Badge variant="secondary">Não conectado</Badge>;
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-xl">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="conexao">Conexão</TabsTrigger>
        <TabsTrigger value="vinculos" disabled={!configurado}>Vínculos</TabsTrigger>
        <TabsTrigger value="conferencia" disabled={!configurado}>Conferência</TabsTrigger>
      </TabsList>

      <TabsContent value="conexao" className="space-y-4 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              Status da conexão
            </CardTitle>
            <CardDescription>
              Estado atual da integração com o PortalHiper para este tenant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                {renderStatus()}
                {integracao?.ultimo_teste_at && (
                  <span className="text-xs text-muted-foreground">
                    Último teste: {new Date(integracao.ultimo_teste_at).toLocaleString("pt-BR")}
                  </span>
                )}
              </div>
              {configurado && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Testar conexão
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Token de Integração
            </CardTitle>
            <CardDescription>
              Cole o token gerado no PortalHiper (Configurações → Integração). Por segurança, ele nunca é exibido novamente após salvo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mostrarInput ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="hiper-token">Token de Integração</Label>
                  <Input
                    id="hiper-token"
                    type="password"
                    autoComplete="new-password"
                    placeholder="hig_..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salvar e conectar
                  </Button>
                  {configurado && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setTrocando(false);
                        setToken("");
                      }}
                      disabled={saving}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Token configurado ••••••••
                </span>
                <Button variant="outline" size="sm" onClick={() => setTrocando(true)}>
                  Trocar token
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {configurado && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="h-5 w-5" />
                Escopo — Fornecedor
              </CardTitle>
              <CardDescription>
                Nem todo cliente da base é Hiper. Escolha o fornecedor que representa o Hiper:
                a reconciliação só toca clientes com este fornecedor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
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
                  Defina o fornecedor antes de reconciliar a carteira.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="vinculos">
        {configurado ? (
          <p className="text-sm text-muted-foreground">Reconciliação por CNPJ — em construção.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Conecte a integração antes de configurar os vínculos.</p>
        )}
      </TabsContent>

      <TabsContent value="conferencia">
        {configurado ? (
          <p className="text-sm text-muted-foreground">Conferência de carteira — em construção.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Conecte a integração antes de acessar a conferência.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
