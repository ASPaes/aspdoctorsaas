import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, RefreshCw, Plug, Link2, HelpCircle, TrendingDown, Search, AlertTriangle, KeyRound,
} from "lucide-react";

// ============================================================================
// Integrações › OEM
//
// Espelha a estrutura da aba do Omie, mas a semântica é diferente num ponto
// que importa: no Omie a conferência procura valores IGUAIS e divergência é
// erro. Aqui os dois valores TÊM que diferir — a mensalidade é preço de venda
// e o custo é o da licença. A diferença é a margem, e é isso que se olha.
//
// Grão do vínculo é a FILIAL, não o CNPJ: medido em 14/08/2026, 188 CNPJs têm
// mais de uma filial (633 no total), um deles com 38. Cada filial é uma
// licença com custo próprio.
// ============================================================================

type Recon = {
  id: string;
  cnpj_norm: string | null;
  empresa_codigo: string | null;
  filial_codigo: string | null;
  razao_oem: string | null;
  custo_oem: number | null;
  status_oem: string | null;
  bloqueado_oem: boolean | null;
  ds_customer_id: string | null;
  razao_ds: string | null;
  mensalidade_ds: number | null;
  cancelado_ds: boolean | null;
  qtd_candidatos_ds: number;
  estado_match: string | null;
  acao_sugerida: string | null;
  status_usuario: string;
  margem: number | null;
};

type Conta = {
  id: string;
  unidades_base_ids: number[] | null;
  chave_prefixo: string | null;
  api_url: string;
  ativo: boolean;
  ultimo_status: string;
  ultimo_sync_em: string | null;
  ultimo_sync_status: string | null;
  ultimo_sync_msg: string | null;
  criado_em: string;
};

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Numero({
  valor, rotulo, sub, tom = "normal",
}: { valor: string; rotulo: string; sub?: string; tom?: "normal" | "bom" | "alerta" | "ruim" }) {
  const cor =
    tom === "bom" ? "text-emerald-600 dark:text-emerald-400"
    : tom === "alerta" ? "text-amber-600 dark:text-amber-400"
    : tom === "ruim" ? "text-destructive"
    : "";
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className={`text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      <p className="text-sm font-medium mt-1">{rotulo}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function OemIntegrationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const [sincronizando, setSincronizando] = useState(false);
  const [busca, setBusca] = useState("");
  const [contaSel, setContaSel] = useState<string | null>(null);
  const [novaUnidade, setNovaUnidade] = useState<string>("");
  const [novaChave, setNovaChave] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Uma conta POR UNIDADE BASE, igual ao Omie. A view não tem a coluna da
  // chave nem o ponteiro do Vault — nada disso chega ao navegador.
  const { data: contas = [] } = useQuery({
    queryKey: ["oem-contas", tid],
    queryFn: async () => {
      const { data } = await (supabase.from("oem_integration_status" as any) as any)
        .select("id, unidades_base_ids, chave_prefixo, api_url, ativo, ultimo_status, ultimo_sync_em, ultimo_sync_status, ultimo_sync_msg, criado_em")
        .eq("tenant_id", tid)
        .order("criado_em");
      return (data ?? []) as Conta[];
    },
    enabled: !!tid,
  });

  const { data: unidades = [] } = useQuery({
    queryKey: ["oem-unidades", tid],
    queryFn: async () => {
      const { data } = await (supabase.from("unidades_base" as any) as any)
        .select("id, nome").eq("tenant_id", tid).order("nome");
      return (data ?? []) as { id: number; nome: string }[];
    },
    enabled: !!tid,
  });

  const conta = useMemo(
    () => contas.find((c) => c.id === contaSel) ?? contas[0] ?? null,
    [contas, contaSel],
  );
  const rotulo = (c: Conta) =>
    (c.unidades_base_ids ?? []).map((u) => unidades.find((x) => x.id === u)?.nome ?? `Unidade ${u}`)
      .join(", ") || "Todas as unidades";

  // São ~3.000 linhas: acima do teto de 1000 do PostgREST, então fetchAllRows.
  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["oem-recon", conta?.id],
    queryFn: () =>
      fetchAllRows<Recon>(() =>
        (supabase.from("reconciliacao_oem" as any) as any)
          .select(
            "id, cnpj_norm, empresa_codigo, filial_codigo, razao_oem, custo_oem, status_oem, " +
            "bloqueado_oem, ds_customer_id, razao_ds, mensalidade_ds, cancelado_ds, " +
            "qtd_candidatos_ds, estado_match, acao_sugerida, status_usuario, margem",
          )
          .eq("conta_integration_id", conta!.id),
      ),
    enabled: !!conta?.id,
  });

  async function salvarChave() {
    if (!tid || !novaUnidade || !novaChave.trim()) return;
    setSalvando(true);
    try {
      const { error } = await (supabase as any).rpc("salvar_chave_oem", {
        p_tenant_id: tid,
        p_unidades: [Number(novaUnidade)],
        p_chave: novaChave.trim(),
      });
      if (error) throw error;
      toast({ title: "Conta conectada", description: "Agora atualize o espelho para trazer as filiais." });
      setNovaChave("");
      setNovaUnidade("");
      queryClient.invalidateQueries({ queryKey: ["oem-contas", tid] });
    } catch (e: any) {
      toast({ title: "Falha ao salvar", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  }

  const { data: ultimaCarga } = useQuery({
    queryKey: ["oem-espelho-ultima", tid],
    queryFn: async () => {
      const { data } = await (supabase.from("oem_espelho_filial" as any) as any)
        .select("atualizado_em, last_sync_oem")
        .eq("tenant_id", tid)
        .order("atualizado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { atualizado_em: string; last_sync_oem: string | null } | null;
    },
    enabled: !!tid,
  });

  const r = useMemo(() => {
    const ativas = linhas.filter((l) => l.status_oem === "Ativo");
    const comPar = ativas.filter(
      (l) => l.ds_customer_id && l.mensalidade_ds != null && l.custo_oem != null && !l.cancelado_ds,
    );
    return {
      total: linhas.length,
      filiais: linhas.filter((l) => l.filial_codigo).length,
      ativas: ativas.length,
      vinculadas: ativas.filter((l) => l.acao_sugerida === "vinculo_auto_ok").length,
      escolher: linhas.filter((l) => l.acao_sugerida === "escolher_candidato" && l.status_usuario === "novo"),
      semCliente: ativas.filter((l) => l.estado_match === "SO_NO_OEM"),
      soNoDs: linhas.filter((l) => l.estado_match === "SO_NO_DS" && !l.cancelado_ds),
      comPar,
      receita: comPar.reduce((a, l) => a + Number(l.mensalidade_ds || 0), 0),
      custo: comPar.reduce((a, l) => a + Number(l.custo_oem || 0), 0),
      negativas: comPar.filter((l) => Number(l.margem) < 0).sort((a, b) => Number(a.margem) - Number(b.margem)),
    };
  }, [linhas]);

  async function sincronizar() {
    setSincronizando(true);
    try {
      const { data, error } = await supabase.functions.invoke("oem-espelho-sync", { body: conta ? { contaId: conta.id } : {} });
      if (error) throw error;
      const res = (data as any)?.resultados?.[0];
      toast({
        title: "Espelho atualizado",
        description: res
          ? `${res.filiais} filiais · ${res.linhasRecon} vínculos · ${res.decisoesPreservadas} decisões preservadas`
          : "Concluído.",
      });
      queryClient.invalidateQueries({ queryKey: ["oem-recon", conta?.id] });
      queryClient.invalidateQueries({ queryKey: ["oem-espelho-ultima", tid] });
      queryClient.invalidateQueries({ queryKey: ["oem-conexao", tid] });
    } catch (e: any) {
      toast({
        title: "Falha ao sincronizar",
        description: e?.message ?? "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSincronizando(false);
    }
  }

  const filtra = (lista: Recon[]) => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((l) =>
      [l.razao_oem, l.razao_ds, l.cnpj_norm, l.filial_codigo, l.empresa_codigo]
        .some((c) => String(c ?? "").toLowerCase().includes(q)));
  };

  if (!tid) {
    return <p className="text-sm text-muted-foreground">Selecione uma empresa para ver a integração.</p>;
  }
  if (isLoading) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" /> OEM — PDV Legal / TabletCloud
            </CardTitle>
            <CardDescription>
              O espelho é alimentado pelo DoctorOEM, que sincroniza com a API do OEM a cada 6h.
              {ultimaCarga?.atualizado_em && (
                <> Última atualização deste espelho:{" "}
                  <strong>{new Date(ultimaCarga.atualizado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</strong>.
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Seletor de conta, igual ao do Omie. Com uma conta só ele some —
                a tela se comporta como se o multi-conta não existisse. */}
            {contas.length > 1 && (
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={conta?.id ?? ""}
                onChange={(e) => setContaSel(e.target.value)}
              >
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>{rotulo(c)}</option>
                ))}
              </select>
            )}
            <Button onClick={sincronizar} disabled={sincronizando || !conta} className="gap-2">
              {sincronizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {sincronizando ? "Atualizando…" : "Atualizar espelho"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="visao" className="w-full">
        <TabsList>
          <TabsTrigger value="conexao">Conexão</TabsTrigger>
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="escolher" className="gap-1.5">
            Escolher candidato
            {r.escolher.length > 0 && <Badge variant="secondary">{r.escolher.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="margem" className="gap-1.5">
            Margem
            {r.negativas.length > 0 && <Badge variant="destructive">{r.negativas.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pendencias">Pendências</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------ conexão */}
        <TabsContent value="conexao" className="space-y-4 max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Contas conectadas
              </CardTitle>
              <CardDescription>
                Uma conta por unidade base, como no Omie. A chave é gerada no{' '}
                <strong>Nexus Hub</strong> e colada aqui — é ela que diz de qual empresa do
                DoctorOEM vêm as filiais.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {contas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conta conectada ainda.</p>
              ) : (
                <div className="rounded-md border divide-y">
                  {contas.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 p-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{rotulo(c)}</p>
                        <p className="font-mono text-xs text-muted-foreground">{c.chave_prefixo}…</p>
                      </div>
                      {c.ultimo_sync_em ? (
                        <div className="text-right">
                          <Badge variant={c.ultimo_sync_status === 'sucesso' ? 'secondary' : 'destructive'}>
                            {c.ultimo_sync_status}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">{c.ultimo_sync_msg}</p>
                        </div>
                      ) : (
                        <Badge variant="outline">nunca sincronizou</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conectar uma unidade</CardTitle>
              <CardDescription>
                No Nexus Hub, crie a empresa, preencha as credenciais da API do OEM e gere uma
                chave de integração. Cole aqui escolhendo a unidade que ela atende.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={novaUnidade}
                  onChange={(e) => setNovaUnidade(e.target.value)}
                >
                  <option value="">Escolha a unidade…</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
                <Input
                  placeholder="oem_live_…"
                  value={novaChave}
                  onChange={(e) => setNovaChave(e.target.value)}
                  type="password"
                />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={salvarChave} disabled={salvando || !novaUnidade || !novaChave.trim()}>
                  {salvando ? 'Salvando…' : 'Conectar'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  A chave vai para o cofre do banco. Nem esta tela consegue lê-la de volta —
                  para trocar, gere outra no Nexus Hub e cole aqui.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------- visão geral */}
        <TabsContent value="visao" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Numero valor={String(r.filiais)} rotulo="Filiais no OEM" sub={`${r.ativas} ativas`} />
            <Numero valor={String(r.vinculadas)} rotulo="Vinculadas automaticamente" tom="bom"
              sub={r.ativas ? `${((r.vinculadas / r.ativas) * 100).toFixed(1)}% das ativas` : undefined} />
            <Numero valor={String(r.escolher.length)} rotulo="Aguardando escolha"
              tom={r.escolher.length ? "alerta" : "bom"} sub="CNPJ com mais de um cliente" />
            <Numero valor={brl(r.receita - r.custo)} rotulo="Margem mensal" tom="bom"
              sub={`${brl(r.receita)} − ${brl(r.custo)}`} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Como o vínculo é feito</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                O casamento é por CNPJ, mas o vínculo é por <strong>filial</strong> — cada filial
                é uma licença com custo próprio. Quando o CNPJ tem um cliente só, o vínculo nasce
                pronto. Quando tem mais de um, a filial vai para <strong>Escolher candidato</strong>.
              </p>
              <p>
                Decisões tomadas à mão são preservadas quando o espelho é atualizado — ninguém
                precisa escolher duas vezes.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- escolher */}
        <TabsContent value="escolher" className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, CNPJ ou código" className="pl-8"
              value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          {r.escolher.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma filial aguardando escolha.
            </CardContent></Card>
          ) : (
            <div className="rounded-md border divide-y">
              {filtra(r.escolher).slice(0, 100).map((l) => (
                <div key={l.id} className="flex items-center gap-3 p-3 text-sm">
                  <HelpCircle className="h-4 w-4 text-amber-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{l.razao_oem}</p>
                    <p className="text-xs text-muted-foreground">
                      filial {l.filial_codigo} · grupo {l.empresa_codigo} · CNPJ {l.cnpj_norm}
                    </p>
                  </div>
                  <Badge variant="outline">{l.qtd_candidatos_ds} candidatos</Badge>
                  <span className="tabular-nums text-muted-foreground w-24 text-right">{brl(l.custo_oem)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            A escolha do cliente ainda não é feita por aqui — é a próxima entrega. Esta lista já
            mostra exatamente quais filiais precisam de decisão.
          </p>
        </TabsContent>

        {/* ------------------------------------------------------------ margem */}
        <TabsContent value="margem" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Numero valor={brl(r.receita)} rotulo="Receita" sub={`${r.comPar.length} clientes ativos`} />
            <Numero valor={brl(r.custo)} rotulo="Custo das licenças" />
            <Numero valor={brl(r.receita - r.custo)} rotulo="Margem" tom="bom" />
          </div>

          {r.negativas.length > 0 && (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <TrendingDown className="h-4 w-4" />
                  {r.negativas.length} cliente(s) custando mais do que pagam
                </CardTitle>
                <CardDescription>
                  A licença no OEM sai mais caro que a mensalidade cobrada. Pode ser acordo
                  comercial — ou cadastro incompleto.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {r.negativas.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{l.razao_oem}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {l.razao_ds} · filial {l.filial_codigo}
                        </p>
                      </div>
                      <span className="tabular-nums text-muted-foreground w-24 text-right">
                        custo {brl(l.custo_oem)}
                      </span>
                      <span className="tabular-nums text-muted-foreground w-24 text-right">
                        cobra {brl(l.mensalidade_ds)}
                      </span>
                      <span className="tabular-nums font-medium text-destructive w-24 text-right">
                        {brl(l.margem)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* -------------------------------------------------------- pendências */}
        <TabsContent value="pendencias" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  {r.semCliente.length} filiais ativas sem cliente
                </CardTitle>
                <CardDescription>
                  Existem no OEM e são cobradas, mas não têm cadastro no DoctorSaaS.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 max-h-80 overflow-y-auto">
                <div className="divide-y">
                  {r.semCliente.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 px-6 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{l.razao_oem}</p>
                        <p className="text-xs text-muted-foreground">filial {l.filial_codigo} · CNPJ {l.cnpj_norm}</p>
                      </div>
                      <span className="tabular-nums text-muted-foreground">{brl(l.custo_oem)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  {r.soNoDs.length} clientes ativos sem filial
                </CardTitle>
                <CardDescription>
                  Estão no DoctorSaaS e não têm licença no OEM. Podem ser de outro produto.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 max-h-80 overflow-y-auto">
                <div className="divide-y">
                  {r.soNoDs.slice(0, 200).map((l) => (
                    <div key={l.id} className="flex items-center gap-3 px-6 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{l.razao_ds}</p>
                        <p className="text-xs text-muted-foreground">CNPJ {l.cnpj_norm ?? "—"}</p>
                      </div>
                      <span className="tabular-nums text-muted-foreground">{brl(l.mensalidade_ds)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
