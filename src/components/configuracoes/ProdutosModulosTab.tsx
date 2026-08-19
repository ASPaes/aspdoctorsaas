import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "@/hooks/use-toast";
import { NumericInput } from "@/components/ui/numeric-input";
import { ProtectedElement } from "@/components/auth/ProtectedElement";
import { Switch } from "@/components/ui/switch";


interface Produto {
  id: number;
  nome: string;
  tenant_id: string;
  omie_servico_codigo?: number | null;
  omie_conta_corrente_codigo?: number | null;
  omie_tipo_faturamento_codigo?: string | null;
  omie_dia_faturamento?: number | null;
  omie_numero_parcelas?: number | null;
  omie_permite_servidor_nuvem?: boolean | null;
}
interface Modulo {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  produto_id: number;
  vlr_custo: number;
  margem_percentual: number;
  vlr_venda: number;
}

const fmtBRL = (n: number) => `R$ ${(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export default function ProdutosModulosTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const qc = useQueryClient();

  const [selectedProdutoId, setSelectedProdutoId] = useState<number | null>(null);
  // Qual coluna da grade do OEM está sendo espiada. null = o cadastro do
  // produto, que é o que a tela sempre mostrou.
  const [colunaOem, setColunaOem] = useState<string | null>(null);

  // Produto dialog
  const [produtoDialogOpen, setProdutoDialogOpen] = useState(false);
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const [produtoNome, setProdutoNome] = useState("");
  const [savingProduto, setSavingProduto] = useState(false);
  // Omie fields (only used when integration is active)
  const [omieServico, setOmieServico] = useState<string>("");
  const [omieConta, setOmieConta] = useState<string>("");
  const [omieTipoFat, setOmieTipoFat] = useState<string>("");
  const [omieDiaFat, setOmieDiaFat] = useState<string>("");
  const [omieNumParcelas, setOmieNumParcelas] = useState<string>("");
  const [omiePermiteNuvem, setOmiePermiteNuvem] = useState<boolean>(false);

  // Produto delete
  const [deleteProduto, setDeleteProduto] = useState<Produto | null>(null);

  // Módulo dialog
  const [moduloDialogOpen, setModuloDialogOpen] = useState(false);
  const [editingModulo, setEditingModulo] = useState<Modulo | null>(null);
  const [moduloNome, setModuloNome] = useState("");
  const [moduloDesc, setModuloDesc] = useState("");
  const [moduloAtivo, setModuloAtivo] = useState(true);
  const [moduloVlrCusto, setModuloVlrCusto] = useState(0);
  const [moduloMargem, setModuloMargem] = useState(0);
  const [moduloVlrVenda, setModuloVlrVenda] = useState(0);
  const [savingModulo, setSavingModulo] = useState(false);

  // Módulo delete
  const [deleteModulo, setDeleteModulo] = useState<Modulo | null>(null);

  // Import CSV
  

  // Queries
  const produtosQ = useQuery({
    queryKey: ["crud_produtos_master", tid],
    queryFn: async () => {
      let q = (supabase.from("produtos" as any) as any).select("*").order("nome");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Produto[];
    },
  });

  const modulosQ = useQuery({
    queryKey: ["produto_modulos", tid, selectedProdutoId],
    enabled: !!selectedProdutoId,
    queryFn: async () => {
      let q = (supabase.from("produto_modulos" as any) as any)
        .select("*")
        .eq("produto_id", selectedProdutoId)
        .order("nome");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Modulo[];
    },
  });

  // ----------------------------------------------------------------- OEM
  // As abas são os VÍNCULOS do produto — não as colunas que existem na grade.
  // Mostrar coluna não vinculada dizia que o produto tinha preço no FULL sem
  // ele ter sido ligado ao FULL.
  //
  // São várias linhas de propósito: desde 18/08/2026 o mesmo produto pode estar
  // em mais de uma coluna (GESTAO LEGAL e FULL), e ainda pode estar em contas
  // diferentes (uma por unidade). Nada de maybeSingle aqui — ele erraria com
  // "multiple rows", que foi exatamente o bug da segunda conta Omie logo abaixo.
  const vinculosOemQ = useQuery({
    queryKey: ["oem-vinculo-do-produto", tid, selectedProdutoId],
    enabled: !!selectedProdutoId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("oem_produto_vinculo" as any) as any)
        .select("conta_integration_id, produto_codigo, produto_nome, ultimo_upgrade_em, criado_em")
        .eq("produto_id", selectedProdutoId)
        .order("criado_em");
      if (error) throw error;
      return (data ?? []) as {
        conta_integration_id: string; produto_codigo: string;
        produto_nome: string | null; ultimo_upgrade_em: string | null;
      }[];
    },
  });

  // A aba é identificada por conta+código: o mesmo código pode existir em duas
  // contas com preços diferentes, e aí "FULL" sozinho não diz qual é qual.
  const chaveAba = (conta: string, codigo: string) => `${conta}|${codigo}`;

  const colunasOem = useMemo(
    () => (vinculosOemQ.data ?? []).map((v) => ({
      chave: chaveAba(v.conta_integration_id, v.produto_codigo),
      conta: v.conta_integration_id,
      codigo: v.produto_codigo,
      nome: v.produto_nome ?? v.produto_codigo,
      ultimoUpgrade: v.ultimo_upgrade_em,
    })),
    [vinculosOemQ.data],
  );

  const contasOem = useMemo(
    () => [...new Set(colunasOem.map((c) => c.conta))],
    [colunasOem],
  );

  const precosOemQ = useQuery({
    queryKey: ["oem-precos-da-conta", contasOem.join(",")],
    enabled: contasOem.length > 0,
    queryFn: () =>
      fetchAllRows<{ conta_integration_id: string; produto_codigo: string; produto_nome: string; modulo_codigo: number; modulo_nome: string; valor_unitario: number | null }>(() =>
        (supabase.from("oem_espelho_modulo_preco" as any) as any)
          .select("conta_integration_id, produto_codigo, produto_nome, modulo_codigo, modulo_nome, valor_unitario")
          .in("conta_integration_id", contasOem)
          .order("modulo_codigo"),
      ),
  });

  const modulosOem = useMemo(() => {
    if (!colunaOem) return [];
    return (precosOemQ.data ?? [])
      .filter((p) => chaveAba(p.conta_integration_id, p.produto_codigo) === colunaOem)
      .sort((a, b) => a.modulo_codigo - b.modulo_codigo);
  }, [precosOemQ.data, colunaOem]);

  // Produto vinculado NÃO mostra a lista cadastrada nesta tela: as abas são só
  // as colunas vinculadas, e ela abre na primeira. Decisão do Alexandre em
  // 18/08/2026 — com o vínculo, a lista de cá é a do OEM, e ter as duas lado a
  // lado só criava a dúvida de qual das duas era a verdade.
  // (Editar margem/venda de produto vinculado passa a não ter caminho aqui.)
  const vinculadoOem = colunasOem.length > 0;
  useEffect(() => {
    if (colunasOem.length === 0) return;
    // Também corrige a aba órfã: desvincular a coluna aberta deixaria a tela
    // presa numa aba que não existe mais, mostrando lista vazia.
    if (colunaOem && colunasOem.some((c) => c.chave === colunaOem)) return;
    setColunaOem(colunasOem[0].chave);
  }, [colunasOem, colunaOem]);

  // Omie integration active check — usa o mesmo effectiveTenantId que as demais telas (super admin pode simular tenant).
  //
  // 07/08/2026: era um .maybeSingle() sobre omie_integration filtrado por tenant. Com a segunda
  // conta Omie (uma por unidade base) isso passou a ERRAR — "multiple rows returned" — e a tela
  // de produtos perdia os campos do Omie por inteiro.
  //
  // Produto é do TENANT, mas categoria/serviço do Omie é de cada CONTA. Enquanto não existir
  // mapeamento de produto por unidade, esta tela usa a conta da **unidade principal**: é o padrão
  // visível na interface (a principal é marcada como tal) e mantém o comportamento de antes, já
  // que quem tinha uma conta só continua com ela. O mapeamento por conta, esse sim definitivo,
  // vive em Integrações → Omie → Vínculos, que já é por conta.
  const omieContaQ = useQuery({
    queryKey: ["omie_conta_para_produtos", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data: contas, error } = await (supabase.from("omie_integration" as any) as any)
        .select("id, unidades_base_ids")
        .eq("tenant_id", tid as string)
        .eq("ativo", true);
      if (error) throw error;
      const lista = (contas ?? []) as Array<{ id: string; unidades_base_ids: number[] | null }>;
      if (lista.length === 0) return null;
      if (lista.length === 1) return lista[0].id;
      const { data: principal } = await (supabase.from("unidades_base" as any) as any)
        .select("id")
        .eq("tenant_id", tid as string)
        .eq("is_principal", true)
        .maybeSingle();
      const pid = (principal as any)?.id ?? null;
      const escolhida =
        lista.find(
          (c) => !c.unidades_base_ids?.length || (pid != null && c.unidades_base_ids.includes(pid)),
        ) ?? lista[0];
      return escolhida.id;
    },
  });
  const omieContaId = omieContaQ.data ?? null;
  const omieAtivo = !!omieContaId;

  // Omie lists (only when integration is active and dialog is open)
  const omiePadroesQ = useQuery({
    queryKey: ["omie_padroes_lists", tid, omieContaId],
    enabled: !!tid && omieAtivo && produtoDialogOpen,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "ler_padroes", tenant_id: tid, conta_integration_id: omieContaId, dados: { operacao: "ler" } },
      });
      if (error) throw error;
      const payload = (data as any)?.dados ?? data ?? {};
      return {
        contas: (payload.contas ?? []) as Array<{ codigo: any; descricao: string }>,
        servicos: (payload.servicos ?? []) as Array<{ codigo: any; descricao: string }>,
        tipos_faturamento: (payload.tipos_faturamento ?? []) as Array<{ codigo: any; descricao: string }>,
      };
    },
  });

  const selectedProduto = produtosQ.data?.find(p => p.id === selectedProdutoId) ?? null;

  // Produto handlers
  const resetOmieFields = (p?: Produto | null) => {
    setOmieServico(p?.omie_servico_codigo != null ? String(p.omie_servico_codigo) : "");
    setOmieConta(p?.omie_conta_corrente_codigo != null ? String(p.omie_conta_corrente_codigo) : "");
    setOmieTipoFat(p?.omie_tipo_faturamento_codigo ?? "");
    setOmieDiaFat(p?.omie_dia_faturamento != null ? String(p.omie_dia_faturamento) : "");
    setOmieNumParcelas(p?.omie_numero_parcelas != null ? String(p.omie_numero_parcelas) : "");
    setOmiePermiteNuvem(p?.omie_permite_servidor_nuvem === true);
  };
  const openNewProduto = () => {
    setEditingProduto(null); setProdutoNome(""); resetOmieFields(null); setProdutoDialogOpen(true);
  };
  const openEditProduto = (p: Produto) => {
    setEditingProduto(p); setProdutoNome(p.nome); resetOmieFields(p); setProdutoDialogOpen(true);
  };

  const saveProduto = async () => {
    if (!produtoNome.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    const parseIntOrNull = (s: string) => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    };
    const dia = parseIntOrNull(omieDiaFat);
    if (omieAtivo && dia !== null && (dia < 1 || dia > 31)) {
      toast({ title: "Dia de faturamento inválido", description: "Use um valor entre 1 e 31.", variant: "destructive" });
      return;
    }
    const omiePayload = omieAtivo ? {
      omie_servico_codigo: omieServico ? Number(omieServico) : null,
      omie_conta_corrente_codigo: omieConta ? Number(omieConta) : null,
      omie_tipo_faturamento_codigo: omieTipoFat ? omieTipoFat : null,
      omie_dia_faturamento: dia,
      omie_numero_parcelas: parseIntOrNull(omieNumParcelas),
      omie_permite_servidor_nuvem: !!omiePermiteNuvem,
    } : {};
    setSavingProduto(true);
    try {
      if (editingProduto) {
        const { error } = await (supabase.from("produtos" as any) as any)
          .update({ nome: produtoNome.trim(), ...omiePayload })
          .eq("id", editingProduto.id)
          .eq("tenant_id", tid as string);
        if (error) throw error;
        toast({ title: "Produto atualizado" });
      } else {
        const { error } = await (supabase.from("produtos" as any) as any)
          .insert({ nome: produtoNome.trim(), tenant_id: tid, ...omiePayload });
        if (error) throw error;
        toast({ title: "Produto criado" });
      }
      setProdutoDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["crud_produtos_master", tid] });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSavingProduto(false);
    }
  };

  const confirmDeleteProduto = async () => {
    if (!deleteProduto) return;
    try {
      const { error } = await (supabase.from("produtos" as any) as any).delete().eq("id", deleteProduto.id);
      if (error) throw error;
      toast({ title: "Produto excluído" });
      if (selectedProdutoId === deleteProduto.id) setSelectedProdutoId(null);
      qc.invalidateQueries({ queryKey: ["crud_produtos_master", tid] });
    } catch (err: any) {
      const msg = err.code === "23503" || /foreign key/i.test(err.message)
        ? "Este produto não pode ser excluído pois está vinculado a outros registros."
        : err.message;
      toast({ title: "Erro ao excluir", description: msg, variant: "destructive" });
    } finally {
      setDeleteProduto(null);
    }
  };

  // Módulo handlers
  const openNewModulo = () => {
    setEditingModulo(null); setModuloNome(""); setModuloDesc(""); setModuloAtivo(true);
    setModuloVlrCusto(0); setModuloMargem(0); setModuloVlrVenda(0);
    setModuloDialogOpen(true);
  };
  const openEditModulo = (m: Modulo) => {
    setEditingModulo(m); setModuloNome(m.nome); setModuloDesc(m.descricao ?? ""); setModuloAtivo(m.ativo);
    setModuloVlrCusto(m.vlr_custo ?? 0);
    setModuloMargem(m.margem_percentual ?? 0);
    setModuloVlrVenda(m.vlr_venda ?? 0);
    setModuloDialogOpen(true);
  };

  const saveModulo = async () => {
    if (!moduloNome.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    if (!selectedProdutoId) return;
    setSavingModulo(true);
    try {
      if (editingModulo) {
        const { error } = await (supabase.from("produto_modulos" as any) as any)
          .update({
            nome: moduloNome.trim(),
            descricao: moduloDesc.trim() || null,
            ativo: moduloAtivo,
            vlr_custo: moduloVlrCusto,
            margem_percentual: moduloMargem,
            vlr_venda: moduloVlrVenda,
          })
          .eq("id", editingModulo.id);
        if (error) throw error;
        toast({ title: "Módulo atualizado" });
      } else {
        const { error } = await (supabase.from("produto_modulos" as any) as any).insert({
          tenant_id: tid,
          produto_id: selectedProdutoId,
          nome: moduloNome.trim(),
          descricao: moduloDesc.trim() || null,
          ativo: moduloAtivo,
          vlr_custo: moduloVlrCusto,
          margem_percentual: moduloMargem,
          vlr_venda: moduloVlrVenda,
        });
        if (error) throw error;
        toast({ title: "Módulo criado" });
      }
      setModuloDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["produto_modulos", tid, selectedProdutoId] });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSavingModulo(false);
    }
  };

  const confirmDeleteModulo = async () => {
    if (!deleteModulo) return;
    try {
      const { error } = await (supabase.from("produto_modulos" as any) as any).delete().eq("id", deleteModulo.id);
      if (error) throw error;
      toast({ title: "Módulo excluído" });
      qc.invalidateQueries({ queryKey: ["produto_modulos", tid, selectedProdutoId] });
    } catch (err: any) {
      const msg = err.code === "23503" || /foreign key/i.test(err.message)
        ? "Este módulo não pode ser excluído pois está vinculado a clientes."
        : err.message;
      toast({ title: "Erro ao excluir", description: msg, variant: "destructive" });
    } finally {
      setDeleteModulo(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Master: Produtos */}
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <ProtectedElement resource="cfg.produtos" action="insert" mode="notify">
            <Button onClick={openNewProduto} size="sm"><Plus />Novo Produto</Button>
          </ProtectedElement>
        </div>

        <div className="border border-border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="w-[220px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {produtosQ.isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={2}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : (produtosQ.data ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">Nenhum produto cadastrado.</TableCell></TableRow>
              ) : (
                produtosQ.data!.map(p => (
                  <TableRow
                    key={p.id}
                    className={selectedProdutoId === p.id ? "bg-muted/50" : ""}
                  >
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant={selectedProdutoId === p.id ? "default" : "outline"}
                          size="sm"
                          onClick={() => { setSelectedProdutoId(p.id); setColunaOem(null); }}
                        >
                          <Package />Módulos
                        </Button>
                        <ProtectedElement resource="cfg.produtos" action="update" mode="notify">
                          <Button variant="ghost" size="icon" onClick={() => openEditProduto(p)}><Pencil /></Button>
                        </ProtectedElement>
                        <ProtectedElement resource="cfg.produtos" action="delete" mode="notify">
                          <Button variant="ghost" size="icon" onClick={() => setDeleteProduto(p)}><Trash2 /></Button>
                        </ProtectedElement>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Detail: Módulos */}
      {selectedProduto && (
        <>
          <Separator />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">Módulos de {selectedProduto.nome}</h3>
                <Badge variant="secondary">
                  {colunaOem
                    ? `${modulosOem.length} módulos no OEM`
                    : `${(modulosQ.data ?? []).length} módulos`}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {/* As colunas da grade do parceiro, ao lado do cadastro: é a
                    mesma pergunta feita duas vezes ("o que este produto tem?"),
                    e ter que ir até Integrações para responder a segunda faz
                    perder de vista a primeira. Só aparece para produto
                    vinculado — sem vínculo não existe grade que seja dele. */}
                {colunasOem.length > 0 && (
                  <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
                    {colunasOem.map((c) => (
                      <Button
                        key={c.chave}
                        size="sm" variant={colunaOem === c.chave ? "secondary" : "ghost"}
                        className="h-7 px-2 text-xs"
                        onClick={() => setColunaOem(c.chave)}
                      >
                        {c.nome}
                      </Button>
                    ))}
                  </div>
                )}
                {/* Em modo OEM não há o que criar: a lista é do parceiro. */}
                {!colunaOem && (
                  <ProtectedElement resource="cfg.produtos" action="insert" mode="notify">
                    <Button onClick={openNewModulo} size="sm"><Plus />Novo Módulo</Button>
                  </ProtectedElement>
                )}
              </div>
            </div>

            {vinculadoOem && !colunaOem ? (
              // Produto vinculado abre direto numa coluna do OEM. Enquanto a
              // grade não chega não dá para mostrar a lista cadastrada "só um
              // instante": ela piscaria e sumiria, parecendo defeito.
              <div className="space-y-2">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : colunaOem ? (
              // Espelho da grade de Integrações › OEM › Módulos, recortado
              // nesta coluna. Só leitura: nada aqui altera o cadastro — quem
              // importa é o botão de vínculo na tela do OEM.
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Preço de <strong>tabela</strong> do parceiro para{" "}
                  <strong>{colunasOem.find((c) => c.chave === colunaOem)?.nome}</strong> — só
                  leitura, o cadastro de {selectedProduto.nome} não muda.
                </p>
                <div className="border border-border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Módulo</TableHead>
                        <TableHead className="w-[120px]">Código</TableHead>
                        <TableHead className="w-[160px] text-right">Valor no OEM</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {precosOemQ.isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                          <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                        ))
                      ) : modulosOem.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                            Nenhum módulo nesta coluna. Atualize o espelho em Integrações › OEM.
                          </TableCell>
                        </TableRow>
                      ) : (
                        modulosOem.map((m) => (
                          <TableRow key={m.modulo_codigo}>
                            <TableCell className="font-medium">{m.modulo_nome}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">#{m.modulo_codigo}</TableCell>
                            <TableCell className={`text-right tabular-nums ${Number(m.valor_unitario) ? "" : "text-muted-foreground"}`}>
                              {fmtBRL(Number(m.valor_unitario) || 0)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
            <div className="border border-border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-[120px] text-right">Vlr Custo</TableHead>
                    <TableHead className="w-[100px] text-right">Margem %</TableHead>
                    <TableHead className="w-[120px] text-right">Vlr Venda</TableHead>
                    <TableHead className="w-[100px]">Ativo</TableHead>
                    <TableHead className="w-[120px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modulosQ.isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                    ))
                  ) : (modulosQ.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        Nenhum módulo cadastrado. Use 'Novo Módulo' ou 'Importar CSV'.
                      </TableCell>
                    </TableRow>
                  ) : (
                    modulosQ.data!.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium align-top">{m.nome}</TableCell>
                        <TableCell className="text-muted-foreground whitespace-pre-wrap break-words max-w-[600px]">{m.descricao ?? "—"}</TableCell>
                        <TableCell className="text-right align-top tabular-nums">{fmtBRL(m.vlr_custo)}</TableCell>
                        <TableCell className="text-right align-top tabular-nums">{fmtPct(m.margem_percentual)}</TableCell>
                        <TableCell className="text-right align-top tabular-nums">{fmtBRL(m.vlr_venda)}</TableCell>
                        <TableCell className="align-top">
                          {m.ativo
                            ? <Badge className="bg-green-500/15 text-green-500 hover:bg-green-500/20">Ativo</Badge>
                            : <Badge variant="secondary">Inativo</Badge>}
                        </TableCell>
                        <TableCell className="text-right align-top">
                          <div className="flex items-center justify-end gap-1">
                            <ProtectedElement resource="cfg.produtos" action="update" mode="notify">
                              <Button variant="ghost" size="icon" onClick={() => openEditModulo(m)}><Pencil /></Button>
                            </ProtectedElement>
                            <ProtectedElement resource="cfg.produtos" action="delete" mode="notify">
                              <Button variant="ghost" size="icon" onClick={() => setDeleteModulo(m)}><Trash2 /></Button>
                            </ProtectedElement>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            )}
          </div>
        </>
      )}

      {/* Produto Dialog */}
      <Dialog open={produtoDialogOpen} onOpenChange={setProdutoDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProduto ? "Editar Produto" : "Novo Produto"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="produto-nome">Nome</Label>
              <Input id="produto-nome" value={produtoNome} onChange={(e) => setProdutoNome(e.target.value)} autoFocus />
            </div>

            {omieAtivo && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold">Integração Omie</h4>
                  <p className="text-xs text-muted-foreground">
                    Estes campos são opcionais. Se deixados em branco, o contrato usará os Padrões Omie configurados em Configurações → Integrações → Omie. Preencha apenas se este produto precisar de valores diferentes do padrão.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Serviço Omie</Label>
                    <Select value={omieServico || "__default__"} onValueChange={(v) => setOmieServico(v === "__default__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Usar padrão" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">Usar padrão</SelectItem>
                        {(omiePadroesQ.data?.servicos ?? []).map((s) => (
                          <SelectItem key={String(s.codigo)} value={String(s.codigo)}>{s.descricao}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Conta Corrente</Label>
                    <Select value={omieConta || "__default__"} onValueChange={(v) => setOmieConta(v === "__default__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Usar padrão" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">Usar padrão</SelectItem>
                        {(omiePadroesQ.data?.contas ?? []).map((c) => (
                          <SelectItem key={String(c.codigo)} value={String(c.codigo)}>{c.descricao}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Tipo de Faturamento</Label>
                    <Select value={omieTipoFat || "__default__"} onValueChange={(v) => setOmieTipoFat(v === "__default__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Usar padrão" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">Usar padrão</SelectItem>
                        {(omiePadroesQ.data?.tipos_faturamento ?? []).map((t) => (
                          <SelectItem key={String(t.codigo)} value={String(t.codigo)}>{t.descricao}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="omie-dia-fat">Dia de Faturamento</Label>
                    <Input
                      id="omie-dia-fat"
                      type="number"
                      min={1}
                      max={31}
                      value={omieDiaFat}
                      onChange={(e) => setOmieDiaFat(e.target.value)}
                      placeholder="1-31"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="omie-num-parcelas">Número de Parcelas</Label>
                    <Input
                      id="omie-num-parcelas"
                      type="number"
                      min={1}
                      value={omieNumParcelas}
                      onChange={(e) => setOmieNumParcelas(e.target.value)}
                      placeholder="Em branco para usar padrão"
                    />
                  </div>
                </div>

                <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="omie-permite-nuvem" className="text-sm">Permite servidor em nuvem</Label>
                    <p className="text-xs text-muted-foreground">
                      Habilita a cobrança recorrente de servidor em nuvem para clientes deste produto.
                    </p>
                  </div>
                  <Switch
                    id="omie-permite-nuvem"
                    checked={omiePermiteNuvem}
                    onCheckedChange={setOmiePermiteNuvem}
                  />
                </div>

                <p className="text-xs text-muted-foreground italic">
                  A categoria Omie deste produto é definida em Configurações → Integrações → Omie, na aba Vínculos.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProdutoDialogOpen(false)} disabled={savingProduto}>Cancelar</Button>
            <Button onClick={saveProduto} disabled={savingProduto}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Módulo Dialog */}
      <Dialog open={moduloDialogOpen} onOpenChange={setModuloDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingModulo ? "Editar Módulo" : "Novo Módulo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="modulo-nome">Nome</Label>
              <Input id="modulo-nome" value={moduloNome} onChange={(e) => setModuloNome(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="modulo-desc">Descrição</Label>
              <Textarea
                id="modulo-desc"
                value={moduloDesc}
                onChange={(e) => setModuloDesc(e.target.value)}
                rows={3}
                className="resize-y min-h-[80px] max-h-[300px]"
                placeholder="Descreva o módulo. Arraste o canto inferior direito para aumentar o campo."
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="modulo-vlr-custo">Valor de Custo (R$)</Label>
                <NumericInput
                  id="modulo-vlr-custo"
                  value={moduloVlrCusto}
                  onChange={(v) => setModuloVlrCusto(v ?? 0)}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="modulo-margem">Margem</Label>
                <NumericInput
                  id="modulo-margem"
                  value={moduloMargem}
                  onChange={(v) => setModuloMargem(v ?? 0)}
                  placeholder="0"
                  suffix="%"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="modulo-vlr-venda">Valor de Venda (R$)</Label>
                <NumericInput
                  id="modulo-vlr-venda"
                  value={moduloVlrVenda}
                  onChange={(v) => setModuloVlrVenda(v ?? 0)}
                  placeholder="0,00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Ativo</Label>
              <Select value={moduloAtivo ? "sim" : "nao"} onValueChange={(v) => setModuloAtivo(v === "sim")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sim">Sim</SelectItem>
                  <SelectItem value="nao">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModuloDialogOpen(false)} disabled={savingModulo}>Cancelar</Button>
            <Button onClick={saveModulo} disabled={savingModulo}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Produto */}
      <AlertDialog open={!!deleteProduto} onOpenChange={(o) => !o && setDeleteProduto(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O produto "{deleteProduto?.nome}" será removido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteProduto}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Módulo */}
      <AlertDialog open={!!deleteModulo} onOpenChange={(o) => !o && setDeleteModulo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir módulo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O módulo "{deleteModulo?.nome}" será removido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteModulo}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
