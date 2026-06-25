import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Users, Package, AlertCircle } from "lucide-react";

type OmieVendedor = { codigo: number | string; nome: string };
type OmieCategoria = { codigo: string; descricao: string };
type VinculoVendedor = { ds_funcionario_id: string; nCodVend: number | string; nome_omie: string; origem?: string };
type VinculoProduto = { ds_produto_id: string; cCodCateg: string; nome_omie: string; origem?: string };

type ListarVinculosResp = {
  vendedores: OmieVendedor[];
  categorias: OmieCategoria[];
  vinculos_vendedores: VinculoVendedor[];
  vinculos_produtos: VinculoProduto[];
};

type Funcionario = { id: number; nome: string };
type Produto = { id: number; nome: string };

function normalizar(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default function OmieVinculosTab() {
  const { toast } = useToast();
  const { effectiveTenantId: tid } = useTenantFilter();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [selecoes, setSelecoes] = useState<Record<string, string>>({});
  const [vinculados, setVinculados] = useState<Record<string, boolean>>({});
  const [mostrarTodosVendedores, setMostrarTodosVendedores] = useState(false);
  const [mostrarTodosProdutos, setMostrarTodosProdutos] = useState(false);

  const { data: remote, isLoading: loadingRemote, error: errRemote } = useQuery({
    queryKey: ["omie_listar_vinculos", tid],
    queryFn: async (): Promise<ListarVinculosResp> => {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "listar_vinculos" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao carregar vínculos.");
      return data.resultado as ListarVinculosResp;
    },
  });

  const { data: funcionarios, isLoading: loadingFunc } = useQuery({
    queryKey: ["omie_vinculos_funcionarios", tid],
    enabled: !!tid,
    queryFn: async (): Promise<Funcionario[]> => {
      const { data, error } = await supabase
        .from("funcionarios")
        .select("id, nome")
        .eq("tenant_id", tid as string)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data || []) as Funcionario[];
    },
  });

  const { data: produtos, isLoading: loadingProd } = useQuery({
    queryKey: ["omie_vinculos_produtos", tid],
    enabled: !!tid,
    queryFn: async (): Promise<Produto[]> => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, nome")
        .eq("tenant_id", tid as string)
        .order("nome");
      if (error) throw error;
      return (data || []) as Produto[];
    },
  });

  const vendedoresOmie = remote?.vendedores || [];
  const categoriasOmie = remote?.categorias || [];

  const vendedorPorNome = useMemo(() => {
    const counts: Record<string, number> = {};
    const map: Record<string, OmieVendedor> = {};
    vendedoresOmie.forEach((v) => {
      const k = normalizar(v.nome);
      counts[k] = (counts[k] || 0) + 1;
      map[k] = v;
    });
    Object.keys(counts).forEach((k) => {
      if (counts[k] !== 1) delete map[k];
    });
    return map;
  }, [vendedoresOmie]);

  const categoriaPorNome = useMemo(() => {
    const counts: Record<string, number> = {};
    const map: Record<string, OmieCategoria> = {};
    categoriasOmie.forEach((c) => {
      const k = normalizar(c.descricao);
      counts[k] = (counts[k] || 0) + 1;
      map[k] = c;
    });
    Object.keys(counts).forEach((k) => {
      if (counts[k] !== 1) delete map[k];
    });
    return map;
  }, [categoriasOmie]);

  const vinculoVendPorFunc = useMemo(() => {
    const m: Record<string, VinculoVendedor> = {};
    (remote?.vinculos_vendedores || []).forEach((v) => {
      m[String(v.ds_funcionario_id)] = v;
    });
    return m;
  }, [remote]);

  const vinculoProdPorProd = useMemo(() => {
    const m: Record<string, VinculoProduto> = {};
    (remote?.vinculos_produtos || []).forEach((v) => {
      m[String(v.ds_produto_id)] = v;
    });
    return m;
  }, [remote]);

  useEffect(() => {
    if (!remote || !funcionarios || !produtos) return;
    const novasSel: Record<string, string> = {};
    const novosVinc: Record<string, boolean> = {};

    funcionarios.forEach((f) => {
      const key = `vend:${f.id}`;
      const vinc = vinculoVendPorFunc[String(f.id)];
      if (vinc) {
        novasSel[key] = String(vinc.nCodVend);
        novosVinc[key] = true;
      } else {
        const sug = vendedorPorNome[normalizar(f.nome)];
        if (sug) novasSel[key] = String(sug.codigo);
      }
    });

    produtos.forEach((p) => {
      const key = `prod:${p.id}`;
      const vinc = vinculoProdPorProd[String(p.id)];
      if (vinc) {
        novasSel[key] = String(vinc.cCodCateg);
        novosVinc[key] = true;
      } else {
        const sug = categoriaPorNome[normalizar(p.nome)];
        if (sug) novasSel[key] = String(sug.codigo);
      }
    });

    setSelecoes(novasSel);
    setVinculados(novosVinc);
  }, [remote, funcionarios, produtos, vendedorPorNome, categoriaPorNome, vinculoVendPorFunc, vinculoProdPorProd]);

  const salvarVendedor = async (func: Funcionario, codigo: string) => {
    const key = `vend:${func.id}`;
    const vendedor = vendedoresOmie.find((v) => String(v.codigo) === codigo);
    if (!vendedor) return;
    setSavingKey(key);
    try {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: {
          acao: "salvar_vinculo",
          dados: {
            tipo: "vendedor",
            ds_funcionario_id: String(func.id),
            nome_ds: func.nome,
            nCodVend: Number(codigo),
            nome_omie: vendedor.nome,
          },
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao salvar vínculo.");
      setSelecoes((s) => ({ ...s, [key]: codigo }));
      setVinculados((v) => ({ ...v, [key]: true }));
      toast({ title: "Vínculo salvo" });
    } catch (err: any) {
      toast({ title: "Erro ao salvar vínculo", description: err.message || "Erro de rede.", variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  };

  const salvarProduto = async (prod: Produto, codigo: string) => {
    const key = `prod:${prod.id}`;
    const categoria = categoriasOmie.find((c) => String(c.codigo) === codigo);
    if (!categoria) return;
    setSavingKey(key);
    try {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: {
          acao: "salvar_vinculo",
          dados: {
            tipo: "produto",
            ds_produto_id: String(prod.id),
            nome_ds: prod.nome,
            cCodCateg: categoria.codigo,
            nome_omie: categoria.descricao,
          },
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao salvar vínculo.");
      setSelecoes((s) => ({ ...s, [key]: codigo }));
      setVinculados((v) => ({ ...v, [key]: true }));
      toast({ title: "Vínculo salvo" });
    } catch (err: any) {
      toast({ title: "Erro ao salvar vínculo", description: err.message || "Erro de rede.", variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  };

  const isVinculadoVend = (id: number) => !!vinculados[`vend:${id}`];
  const isVinculadoProd = (id: number) => !!vinculados[`prod:${id}`];

  const funcionariosVisiveis = mostrarTodosVendedores
    ? funcionarios
    : funcionarios?.filter((f) => !isVinculadoVend(f.id));

  const produtosVisiveis = mostrarTodosProdutos
    ? produtos
    : produtos?.filter((p) => !isVinculadoProd(p.id));

  if (errRemote) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>Não foi possível carregar os vínculos do Omie. Verifique a conexão na aba anterior.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const loading = loadingRemote || loadingFunc || loadingProd;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isSugestaoPendente = (key: string, funcOrProd: Funcionario | Produto, isVend: boolean) => {
    if (vinculados[key]) return false;
    const sel = selecoes[key];
    if (!sel) return false;
    const nameMatch = isVend
      ? vendedorPorNome[normalizar(funcOrProd.nome)]
      : categoriaPorNome[normalizar(funcOrProd.nome)];
    return !!(nameMatch && String(nameMatch.codigo) === sel);
  };

  const renderRowBadge = (key: string, funcOrProd: Funcionario | Produto, isVend: boolean) => {
    if (vinculados[key]) {
      return <Badge variant="secondary" className="text-[10px]">vinculado</Badge>;
    }
    if (isSugestaoPendente(key, funcOrProd, isVend)) {
      return <Badge variant="outline" className="text-[10px]">sugerido</Badge>;
    }
    return null;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Vendedores
          </CardTitle>
          <CardDescription>
            Vincule cada funcionário ativo ao vendedor correspondente no Omie.
          </CardDescription>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              À esquerda, o funcionário cadastrado no seu sistema. À direita, o vendedor correspondente no Omie. Vincule cada funcionário ao seu equivalente no Omie.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {mostrarTodosVendedores ? "Mostrando todos os funcionários." : "Mostrando apenas funcionários sem vínculo."}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMostrarTodosVendedores((v) => !v)}
              >
                {mostrarTodosVendedores ? "Ver só pendentes" : "Ver todos"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {(funcionarios?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum funcionário ativo encontrado.</p>
          ) : (funcionariosVisiveis?.length ?? 0) === 0 ? (
            <div className="py-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">Todos os vendedores estão vinculados.</p>
              <Button variant="outline" size="sm" onClick={() => setMostrarTodosVendedores(true)}>
                Ver todos
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {funcionariosVisiveis!.map((f) => {
                const key = `vend:${f.id}`;
                const isSaving = savingKey === key;
                return (
                  <div key={f.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">{f.nome}</span>
                      {renderRowBadge(key, f, true)}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      <Select
                        value={selecoes[key] || ""}
                        onValueChange={(v) => salvarVendedor(f, v)}
                        disabled={isSaving}
                      >
                        <SelectTrigger className="w-[280px]">
                          <SelectValue placeholder="Selecione o vendedor" />
                        </SelectTrigger>
                        <SelectContent>
                          {vendedoresOmie.map((v) => (
                            <SelectItem key={String(v.codigo)} value={String(v.codigo)}>
                              {v.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isSugestaoPendente(key, f, true) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSaving}
                          onClick={() => salvarVendedor(f, selecoes[key])}
                        >
                          Confirmar vínculo
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Produtos
          </CardTitle>
          <CardDescription>
            Vincule cada produto à categoria correspondente no Omie.
          </CardDescription>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              À esquerda, o produto do seu sistema. À direita, a categoria de contrato correspondente no Omie. Vincule cada produto à sua categoria.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {mostrarTodosProdutos ? "Mostrando todos os produtos." : "Mostrando apenas produtos sem vínculo."}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMostrarTodosProdutos((v) => !v)}
              >
                {mostrarTodosProdutos ? "Ver só pendentes" : "Ver todos"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {(produtos?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>
          ) : (produtosVisiveis?.length ?? 0) === 0 ? (
            <div className="py-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">Todos os produtos estão vinculados.</p>
              <Button variant="outline" size="sm" onClick={() => setMostrarTodosProdutos(true)}>
                Ver todos
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {produtosVisiveis!.map((p) => {
                const key = `prod:${p.id}`;
                const isSaving = savingKey === key;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">{p.nome}</span>
                      {renderRowBadge(key, p, false)}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      <Select
                        value={selecoes[key] || ""}
                        onValueChange={(v) => salvarProduto(p, v)}
                        disabled={isSaving}
                      >
                        <SelectTrigger className="w-[280px]">
                          <SelectValue placeholder="Selecione a categoria" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoriasOmie.map((c) => (
                            <SelectItem key={c.codigo} value={c.codigo}>
                              {c.descricao}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isSugestaoPendente(key, p, false) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSaving}
                          onClick={() => salvarProduto(p, selecoes[key])}
                        >
                          Confirmar vínculo
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
