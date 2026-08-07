import { useEffect, useMemo, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Plug, RefreshCw, KeyRound, Building2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OmieVinculosTab from "./OmieVinculosTab";
import OmiePadroesTab from "./OmiePadroesTab";
import OmieConferenciaTab from "./OmieConferenciaTab";
import OmieEscolherCandidatoTab from "./OmieEscolherCandidatoTab";
import { OmieContaProvider, type OmieConta } from "./OmieContaContext";

// Uma conta Omie POR UNIDADE BASE (07/08/2026).
//
// Antes esta tela lia `omie_integration` com .maybeSingle() e salvava a chave sem dizer a quem ela
// pertencia -- o que, no banco, sobrescrevia a chave da outra unidade. Hoje o tenant Digi Office
// tem duas contas (Digi Office e Digi Up), cada uma com chave, de/para, espelho e reconciliação
// próprios.
//
// O seletor abaixo é a única coisa que escolhe a conta: as sub-abas leem do OmieContaContext e
// mandam a unidade no body. Com uma conta só ele mostra a única e o payload continua idêntico ao
// de antes -- a tela se comporta como se nada tivesse mudado.
//
// Unidade sem conta aparece no seletor como "conectar": escolher uma delas abre o campo da chave
// já apontando para ela. É por aí que uma unidade nova entra.

const NOVA = "nova:";

export default function OmieIntegrationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const [chave, setChave] = useState("");
  const [trocando, setTrocando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("conexao");
  const [selecionado, setSelecionado] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const tab = typeof detail === "string" ? detail : detail?.tab;
      if (tab === "escolher" || tab === "escolher_candidato") setActiveTab("escolher");
      else if (tab) setActiveTab(String(tab));
    };
    window.addEventListener("omie-goto-tab", handler as EventListener);
    return () => window.removeEventListener("omie-goto-tab", handler as EventListener);
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["omie_contas", tid],
    enabled: !!tid,
    queryFn: async () => {
      // Filtrar explicitamente pelo tenant visualizado (super admin pode trocar de tenant).
      const [contasRes, unidadesRes] = await Promise.all([
        supabase
          .from("omie_integration")
          .select("id, ativo, ultimo_status, ultimo_teste_at, integracao_pausada, unidades_base_ids")
          .eq("tenant_id", tid as string),
        supabase
          .from("unidades_base")
          .select("id, nome, is_active, is_principal")
          .eq("tenant_id", tid as string)
          .order("id"),
      ]);
      if (contasRes.error) throw contasRes.error;
      if (unidadesRes.error) throw unidadesRes.error;
      return {
        contas: (contasRes.data ?? []) as any[],
        unidades: (unidadesRes.data ?? []) as any[],
      };
    },
  });

  const unidades = data?.unidades ?? [];
  const nomeUnidade = (id: number) => unidades.find((u) => u.id === id)?.nome ?? `Unidade ${id}`;

  const contas: OmieConta[] = useMemo(
    () =>
      (data?.contas ?? []).map((c) => ({
        id: c.id,
        ativo: !!c.ativo,
        ultimo_status: c.ultimo_status,
        ultimo_teste_at: c.ultimo_teste_at,
        integracao_pausada: !!c.integracao_pausada,
        unidades_base_ids: c.unidades_base_ids,
        rotulo:
          !c.unidades_base_ids || c.unidades_base_ids.length === 0
            ? "Todas as unidades"
            : c.unidades_base_ids.map((u: number) => nomeUnidade(u)).join(", "),
      })),
    [data],
  );

  // Unidades ativas que ainda não pertencem a nenhuma conta.
  const unidadesLivres = useMemo(() => {
    const usadas = new Set<number>();
    for (const c of contas) (c.unidades_base_ids ?? []).forEach((u) => usadas.add(u));
    // Conta com escopo vazio cobre todas: nesse caso não há unidade "livre" para conectar.
    const algumaSemEscopo = contas.some((c) => !c.unidades_base_ids || c.unidades_base_ids.length === 0);
    if (algumaSemEscopo) return [];
    return unidades.filter((u) => u.is_active !== false && !usadas.has(u.id));
  }, [contas, unidades]);

  // Seleção padrão: a primeira conta. Se não houver nenhuma, a primeira unidade livre.
  const valorSelect =
    selecionado ??
    (contas.length > 0 ? contas[0].id : unidadesLivres.length > 0 ? `${NOVA}${unidadesLivres[0].id}` : "");

  const criandoNova = valorSelect.startsWith(NOVA);
  const unidadeNova = criandoNova ? Number(valorSelect.slice(NOVA.length)) : null;
  const conta = criandoNova ? null : contas.find((c) => c.id === valorSelect) ?? null;

  const configurado = !!conta?.ativo;
  const mostrarInput = criandoNova || !configurado || trocando;

  const handleSave = async () => {
    if (!chave.trim()) {
      toast({ title: "Informe a chave", description: "Cole a Chave de Integração para conectar.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: resp, error } = await supabase.functions.invoke("omie-integration-save", {
        body: {
          chave: chave.trim(),
          // Conta nova nasce presa à unidade escolhida; conta existente troca a própria chave.
          // Sem um dos dois, o backend só aceita enquanto o tenant tiver uma conta só.
          ...(criandoNova ? { unidade_base_id: unidadeNova } : conta ? { integration_id: conta.id } : {}),
        },
      });
      if (error) throw error;
      if (!resp?.ok) throw new Error(resp?.error || "Não foi possível conectar.");
      setChave("");
      setTrocando(false);
      const novoId = (resp?.rpc as any)?.integration_id;
      if (novoId) setSelecionado(novoId);
      toast({
        title: "Integração conectada com sucesso",
        description: (resp?.rpc as any)?.nova_conta
          ? "A conta nasce pausada. Confira o espelho e os vínculos antes de despausar em Padrões Omie."
          : undefined,
      });
      await refetch();
    } catch (err: any) {
      toast({ title: "Erro ao conectar", description: err.message || "Erro de rede. Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!conta) return;
    setTesting(true);
    try {
      const { data: resp, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "testar", tenant_id: tid, conta_integration_id: conta.id },
      });
      if (error) throw error;
      if (!resp?.ok) throw new Error(resp?.error || "Falha ao testar conexão.");
      if (resp?.resultado?.omie_configurado) {
        toast({ title: "Conexão OK" });
      } else {
        toast({
          title: "Chave válida",
          description: "Mas o Omie não está configurado no ambiente.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["omie_contas"] });
    } catch (err: any) {
      toast({ title: "Erro no teste", description: err.message || "Erro de rede. Tente novamente.", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const renderStatus = () => {
    if (criandoNova) return <Badge variant="secondary">Não conectado</Badge>;
    if (conta?.ultimo_status === "erro") {
      return <Badge variant="destructive">Erro na última verificação</Badge>;
    }
    if (configurado) {
      return (
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Conectado</Badge>
          {conta?.integracao_pausada && <Badge variant="outline">Pausada</Badge>}
        </div>
      );
    }
    return <Badge variant="secondary">Não conectado</Badge>;
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-xl">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const mostrarSeletor = contas.length > 1 || unidadesLivres.length > 0;

  return (
    <OmieContaProvider conta={conta} totalContas={contas.length}>
      <div className="space-y-4">
        {mostrarSeletor && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Conta Omie
            </div>
            <Select
              value={valorSelect}
              onValueChange={(v) => {
                setSelecionado(v);
                setChave("");
                setTrocando(false);
                setActiveTab("conexao");
              }}
            >
              <SelectTrigger className="h-9 w-[280px]">
                <SelectValue placeholder="Escolha a unidade" />
              </SelectTrigger>
              <SelectContent>
                {contas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${c.ativo ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                      />
                      {c.rotulo}
                    </span>
                  </SelectItem>
                ))}
                {unidadesLivres.map((u) => (
                  <SelectItem key={`${NOVA}${u.id}`} value={`${NOVA}${u.id}`}>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                      {u.nome}
                      <span className="text-xs text-muted-foreground">— conectar</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              Cada unidade tem a sua conta no Omie. Clientes e contratos nunca se misturam entre elas.
            </span>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="conexao">Conexão</TabsTrigger>
            <TabsTrigger value="vinculos" disabled={!configurado}>Vínculos</TabsTrigger>
            <TabsTrigger value="padroes" disabled={!configurado}>Padrões Omie</TabsTrigger>
            <TabsTrigger value="conferencia" disabled={!configurado}>Conferência</TabsTrigger>
            <TabsTrigger value="escolher" disabled={!configurado}>Escolher Candidato</TabsTrigger>
          </TabsList>

          <TabsContent value="conexao" className="space-y-4 max-w-xl">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plug className="h-5 w-5" />
                  Status da conexão
                </CardTitle>
                <CardDescription>
                  {criandoNova
                    ? `Conectar a unidade ${nomeUnidade(unidadeNova as number)} ao Omie.`
                    : `Estado atual da integração com o Omie para ${conta?.rotulo ?? "este tenant"}.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    {renderStatus()}
                    {conta?.ultimo_teste_at && (
                      <span className="text-xs text-muted-foreground">
                        Último teste: {new Date(conta.ultimo_teste_at).toLocaleString("pt-BR")}
                      </span>
                    )}
                  </div>
                  {configurado && (
                    <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
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
                  {criandoNova && " Esta chave vale só para a unidade selecionada."}
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
                    <span className="text-sm text-muted-foreground">Chave configurada ••••••••</span>
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

          <TabsContent value="padroes">
            {configurado ? (
              <OmiePadroesTab />
            ) : (
              <p className="text-sm text-muted-foreground">Conecte a integração antes de configurar os padrões.</p>
            )}
          </TabsContent>

          <TabsContent value="conferencia">
            {configurado ? (
              <OmieConferenciaTab />
            ) : (
              <p className="text-sm text-muted-foreground">Conecte a integração antes de acessar a conferência.</p>
            )}
          </TabsContent>

          <TabsContent value="escolher">
            {configurado ? (
              <OmieEscolherCandidatoTab />
            ) : (
              <p className="text-sm text-muted-foreground">Conecte a integração antes de acessar a escolha de candidato.</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </OmieContaProvider>
  );
}
