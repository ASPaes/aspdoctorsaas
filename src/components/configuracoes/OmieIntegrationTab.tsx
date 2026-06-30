import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Save, Plug, RefreshCw, KeyRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OmieVinculosTab from "./OmieVinculosTab";
import OmiePadroesTab from "./OmiePadroesTab";

export default function OmieIntegrationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const [chave, setChave] = useState("");
  const [trocando, setTrocando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const { data: integracao, isLoading, refetch } = useQuery({
    queryKey: ["omie_integration", tid],
    queryFn: async () => {
      // RLS já filtra pelo tenant do usuário logado; não filtrar manualmente.
      const { data, error } = await supabase
        .from("omie_integration")
        .select("ativo, ultimo_status, ultimo_teste_at")
        .limit(1)
        .maybeSingle();
      console.log("[OmieIntegrationTab] omie_integration raw:", { data, error, tid });
      if (error) throw error;
      return data;
    },
  });

  const configurado = !!integracao?.ativo;
  const mostrarInput = !configurado || trocando;

  const handleSave = async () => {
    if (!chave.trim()) {
      toast({ title: "Informe a chave", description: "Cole a Chave de Integração para conectar.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("omie-integration-save", {
        body: { chave: chave.trim() },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Não foi possível conectar.");
      setChave("");
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
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "testar" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao testar conexão.");
      if (data?.resultado?.omie_configurado) {
        toast({ title: "Conexão OK" });
      } else {
        toast({
          title: "Chave válida",
          description: "Mas o Omie não está configurado no ambiente.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["omie_integration"] });
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
    <Tabs defaultValue="conexao" className="space-y-4">
      <TabsList>
        <TabsTrigger value="conexao">Conexão</TabsTrigger>
        <TabsTrigger value="vinculos" disabled={!configurado}>Vínculos</TabsTrigger>
        <TabsTrigger value="padroes" disabled={!configurado}>Padrões Omie</TabsTrigger>
      </TabsList>

      <TabsContent value="conexao" className="space-y-4 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              Status da conexão
            </CardTitle>
            <CardDescription>
              Estado atual da integração com o Omie para este tenant.
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
              Chave de Integração
            </CardTitle>
            <CardDescription>
              Cole a chave gerada no Omie. Por segurança, ela nunca é exibida novamente após salva.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mostrarInput ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="omie-chave">Chave de Integração</Label>
                  <Input
                    id="omie-chave"
                    type="password"
                    autoComplete="new-password"
                    placeholder="dmie_live_..."
                    value={chave}
                    onChange={(e) => setChave(e.target.value)}
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
                        setChave("");
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
                  Chave configurada ••••••••
                </span>
                <Button variant="outline" size="sm" onClick={() => setTrocando(true)}>
                  Trocar chave
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="vinculos">
        {configurado ? (
          <OmieVinculosTab />
        ) : (
          <p className="text-sm text-muted-foreground">Conecte a integração antes de configurar os vínculos.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
