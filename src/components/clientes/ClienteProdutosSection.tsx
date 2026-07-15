import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Package, Plus, Pencil, Trash2, ChevronDown, ChevronRight,
  ExternalLink, Loader2, Puzzle, Percent, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

import SugestaoMRRDialog from "./SugestaoMRRDialog";
import ReajusteModulosDialog from "./ReajusteModulosDialog";
import EnviarContratoOmieButton from "./EnviarContratoOmieButton";

interface Props {
  clienteId: string;
}

interface MRRDialogState {
  open: boolean;
  tipo: "upsell" | "cross_sell" | "downsell";
  valorDelta: number;
  custoDelta: number;
  descricao: string;
  moduloId?: string | null;
}

interface ClienteProduto {
  id: string;
  produto_id: number;
  fornecedor_id: number | null;
  codigo_fornecedor: string | null;
  link_portal_fornecedor: string | null;
  vlr_ativacao: number | null;
  vlr_mensal: number | null;
  vlr_custo: number | null;
  data_ativacao: string | null;
  ativo: boolean;
  produtos?: { nome: string } | null;
  fornecedores?: { nome: string } | null;
}

interface ClienteProdutoModulo {
  id: string;
  cliente_produto_id: string;
  modulo_id: string;
  quantidade: number | null;
  vlr_ativacao: number | null;
  vlr_mensal: number | null;
  vlr_custo: number | null;
  data_ativacao: string | null;
  data_inativacao: string | null;
  ativo: boolean;
  produto_modulos?: { nome: string; descricao: string | null } | null;
}

const fmtBRL = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ClienteProdutosSection({ clienteId }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const qc = useQueryClient();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [produtoDialog, setProdutoDialog] = useState<{ open: boolean; edit?: ClienteProduto | null }>({ open: false });
  const [moduloDialog, setModuloDialog] = useState<{
    open: boolean; clienteProdutoId?: string; produtoId?: number; edit?: ClienteProdutoModulo | null;
  }>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<ClienteProduto | null>(null);
  const [confirmDeleteModulo, setConfirmDeleteModulo] = useState<ClienteProdutoModulo | null>(null);
  const [mrrDialog, setMrrDialog] = useState<MRRDialogState>({
    open: false, tipo: "upsell", valorDelta: 0, custoDelta: 0, descricao: "",
  });
  const [reajusteDialog, setReajusteDialog] = useState<{
    open: boolean; clienteProdutoId?: string; produtoNome?: string;
  }>({ open: false });

  if (!clienteId) return null;

  // ---- Queries ----
  const produtosQuery = useQuery<ClienteProduto[]>({
    queryKey: ["cliente_produtos", tid, clienteId],
    queryFn: async () => {
      let q = (supabase.from("cliente_produtos" as any) as any)
        .select("*, produtos:produto_id(nome), fornecedores:fornecedor_id(nome)")
        .eq("cliente_id", clienteId)
        .order("created_at");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ClienteProduto[];
    },
  });

  const produtoIds = useMemo(() => (produtosQuery.data ?? []).map(p => p.id), [produtosQuery.data]);

  const modulosQuery = useQuery<ClienteProdutoModulo[]>({
    queryKey: ["cliente_produto_modulos", tid, clienteId, produtoIds.join(",")],
    enabled: produtoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cliente_produto_modulos" as any) as any)
        .select("*, produto_modulos:modulo_id(nome, descricao)")
        .in("cliente_produto_id", produtoIds)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as ClienteProdutoModulo[];
    },
  });

  const modulosByProduto = useMemo(() => {
    const map: Record<string, ClienteProdutoModulo[]> = {};
    (modulosQuery.data ?? []).forEach(m => {
      (map[m.cliente_produto_id] ||= []).push(m);
    });
    return map;
  }, [modulosQuery.data]);

  const clienteTenantQuery = useQuery<{ tenant_id: string | null }>({
    queryKey: ["cliente_tenant_lookup", clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("clientes" as any) as any)
        .select("tenant_id").eq("id", clienteId).maybeSingle();
      if (error) throw error;
      return (data ?? { tenant_id: null }) as any;
    },
  });
  const lookupTenantId: string | null = (clienteTenantQuery.data?.tenant_id ?? tid) ?? null;

  const produtosLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["produtos_lookup", lookupTenantId],
    enabled: !!lookupTenantId,
    queryFn: async () => {
      let q = (supabase.from("produtos" as any) as any).select("id, nome").order("nome");
      if (lookupTenantId) q = q.eq("tenant_id", lookupTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const fornecedoresLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["fornecedores_lookup", lookupTenantId],
    enabled: !!lookupTenantId,
    queryFn: async () => {
      let q = supabase.from("fornecedores").select("id, nome").order("nome");
      if (lookupTenantId) q = q.eq("tenant_id", lookupTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["cliente_produtos", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["cliente_produto_modulos", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["cliente", clienteId] });
    qc.invalidateQueries({ queryKey: ["contratos_cliente", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["contrato_itens_cliente", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["contratos_totais_check", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["has_non_implicit_contratos", tid, clienteId] });
  };

  // ---- Mutations ----
  const deleteProdutoMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("cliente_produtos" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Produto removido" });
      invalidateAll();
    },
    onError: (err: any) => {
      const msg = String(err?.message || "");
      if (msg.includes("foreign key") || msg.includes("violates")) {
        toast({ title: "Não é possível excluir", description: "Remova os módulos vinculados primeiro.", variant: "destructive" });
      } else {
        toast({ title: "Erro ao excluir", description: msg, variant: "destructive" });
      }
    },
  });

  const deleteModuloMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("cliente_produto_modulos" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Módulo excluído" });
      invalidateAll();
    },
    onError: (err: any) => toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" }),
  });

  const toggleModuloMut = useMutation({
    mutationFn: async (m: ClienteProdutoModulo) => {
      const novoAtivo = !m.ativo;
      const { error } = await (supabase.from("cliente_produto_modulos" as any) as any)
        .update({
          ativo: novoAtivo,
          data_inativacao: novoAtivo ? null : new Date().toISOString().slice(0, 10),
        })
        .eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: (_, m) => {
      toast({ title: "Módulo atualizado" });
      invalidateAll();
      // Se foi inativação (estava ativo) e tinha valor mensal, sugerir downsell
      if (m.ativo && (Number(m.vlr_mensal) || 0) > 0) {
        setMrrDialog({
          open: true,
          tipo: "downsell",
          valorDelta: -((Number(m.vlr_mensal) || 0) * (Number(m.quantidade) || 1)),
          custoDelta: -((Number(m.vlr_custo) || 0) * (Number(m.quantidade) || 1)),
          descricao: `Módulo ${m.produto_modulos?.nome ?? ""} inativado`,
          moduloId: m.id,
        });
      }
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  // ---- Totals ----
  const ativos = (produtosQuery.data ?? []).filter(p => p.ativo);
  const totalMensal = ativos.reduce((s, p) => s + (Number(p.vlr_mensal) || 0), 0);
  const totalCusto = ativos.reduce((s, p) => s + (Number(p.vlr_custo) || 0), 0);
  const totalAtivacao = ativos.reduce((s, p) => s + (Number(p.vlr_ativacao) || 0), 0);

  const { data: contratosInfo } = useQuery({
    queryKey: ["contratos_totais_check", tid, clienteId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("contratos" as any) as any)
        .select("vlr_total_mensal, vlr_total_ativacao")
        .eq("cliente_id", clienteId)
        .eq("status", "ativo");
      if (error) return { count: 0, totalMensal: 0, totalAtivacao: 0 };
      const rows = data ?? [];
      return {
        count: rows.length,
        totalMensal: rows.reduce((s: number, c: any) => s + (Number(c.vlr_total_mensal) || 0), 0),
        totalAtivacao: rows.reduce((s: number, c: any) => s + (Number(c.vlr_total_ativacao) || 0), 0),
      };
    },
    enabled: !!clienteId,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 !flex-row !items-center !justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-5 w-5" />
          Produtos & Módulos
          <Badge variant="secondary" className="ml-2">{ativos.length} ativo{ativos.length === 1 ? "" : "s"}</Badge>
        </CardTitle>
        <Button type="button" size="sm" onClick={() => setProdutoDialog({ open: true, edit: null })}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar Produto
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {produtosQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (produtosQuery.data ?? []).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nenhum produto vinculado a este cliente.</p>
            <Button type="button" variant="link" size="sm" onClick={() => setProdutoDialog({ open: true, edit: null })}>
              Adicionar primeiro produto
            </Button>
          </div>
        ) : (
          (produtosQuery.data ?? []).map(p => {
            const isOpen = !!expanded[p.id];
            const mods = modulosByProduto[p.id] ?? [];
            const modsAtivos = (modulosByProduto[p.id] ?? []).filter(m => m.ativo).length;
            return (
              <Collapsible key={p.id} open={isOpen} onOpenChange={(o) => setExpanded(s => ({ ...s, [p.id]: o }))}>
                <div className="border rounded-md bg-card">
                  <div className="flex items-center gap-2 p-3">
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </CollapsibleTrigger>
                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                      <div className="font-semibold truncate">{p.produtos?.nome ?? "—"}</div>
                      <div className="text-sm text-muted-foreground truncate">{p.fornecedores?.nome ?? "—"}</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={p.ativo ? "default" : "secondary"} className="shrink-0">
                          R$ {fmtBRL(p.vlr_mensal)}/mês
                        </Badge>
                        <Badge variant="outline" className="shrink-0 text-muted-foreground">
                          Custo: R$ {fmtBRL(p.vlr_custo)}
                        </Badge>
                        {Number(p.vlr_ativacao) > 0 && (
                          <Badge variant="outline" className="shrink-0 text-amber-500 border-amber-500/30">
                            Ativ: R$ {fmtBRL(p.vlr_ativacao)}
                          </Badge>
                        )}
                      </div>
                      <div>
                        {modsAtivos > 0 ? (
                          <Badge variant="outline">{modsAtivos} módulo{modsAtivos > 1 ? "s" : ""}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem módulos</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setProdutoDialog({ open: true, edit: p })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setConfirmDelete(p)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-3">
                      <Separator />
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <div>
                          <div className="text-muted-foreground text-xs">Data Ativação</div>
                          <div>{p.data_ativacao ? new Date(p.data_ativacao + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">Vlr Ativação</div>
                          <div>R$ {fmtBRL(p.vlr_ativacao)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">Link Portal</div>
                          {p.link_portal_fornecedor ? (
                            <a href={p.link_portal_fornecedor} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
                              Abrir <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : <div>—</div>}
                        </div>
                      </div>

                      <div className="rounded border bg-background/50 overflow-x-auto">
                        {mods.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            Nenhum módulo vinculado.
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Módulo</TableHead>
                                <TableHead className="text-center w-16">Qtd</TableHead>
                                <TableHead className="text-right">Vlr Mensal (unit.)</TableHead>
                                <TableHead className="text-right">Vlr Custo (unit.)</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-40 text-right">Ações</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {mods.map(m => (
                                <TableRow key={m.id}>
                                  <TableCell className="font-medium">{m.produto_modulos?.nome ?? "—"}</TableCell>
                                  <TableCell className="text-center">{Number(m.quantidade) || 1}</TableCell>
                                  <TableCell className="text-right">
                                    R$ {fmtBRL(m.vlr_mensal)}
                                    {(Number(m.quantidade) || 1) > 1 && (
                                      <span className="block text-xs text-muted-foreground">
                                        = R$ {fmtBRL((Number(m.vlr_mensal) || 0) * (Number(m.quantidade) || 1))}
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    R$ {fmtBRL(m.vlr_custo)}
                                    {(Number(m.quantidade) || 1) > 1 && (
                                      <span className="block text-xs text-muted-foreground">
                                        = R$ {fmtBRL((Number(m.vlr_custo) || 0) * (Number(m.quantidade) || 1))}
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={m.ativo ? "default" : "secondary"}>{m.ativo ? "Ativo" : "Inativo"}</Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-0.5">
                                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setModuloDialog({ open: true, clienteProdutoId: p.id, produtoId: p.produto_id, edit: m })}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => toggleModuloMut.mutate(m)} disabled={toggleModuloMut.isPending}>
                                        {m.ativo ? "Inativar" : "Reativar"}
                                      </Button>
                                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setConfirmDeleteModulo(m)} disabled={deleteModuloMut.isPending}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setModuloDialog({ open: true, clienteProdutoId: p.id, produtoId: p.produto_id, edit: null })}>
                          <Plus className="h-4 w-4 mr-1" /> <Puzzle className="h-4 w-4 mr-1" /> Adicionar Módulo
                        </Button>
                        <Button
                          type="button" variant="outline" size="sm"
                          onClick={() => setReajusteDialog({ open: true, clienteProdutoId: p.id, produtoNome: p.produtos?.nome ?? '' })}
                          disabled={modsAtivos === 0}
                        >
                          <Percent className="h-4 w-4 mr-1" /> Reajuste %
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })
        )}

        <Separator />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-sm">
          <div className="flex flex-wrap gap-4">
            <div className="font-semibold">Total Mensal: <span className="text-primary">R$ {fmtBRL(totalMensal)}</span></div>
            <div className="font-semibold">Total Custo: <span className="text-muted-foreground">R$ {fmtBRL(totalCusto)}</span></div>
            {totalAtivacao > 0 && (
              <div className="font-semibold">Total Ativação: <span className="text-amber-500">R$ {fmtBRL(totalAtivacao)}</span></div>
            )}
          </div>
          <div className="text-xs text-muted-foreground">Mensalidade do cliente é recalculada automaticamente.</div>
        </div>
        {ativos.length > 0 && (() => {
          const ct = contratosInfo ?? { count: 0, totalMensal: 0, totalAtivacao: 0 };

          if (ct.count === 0) {
            return (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 mt-2 space-y-1">
                <p className="font-medium">⚠ Nenhum contrato ativo encontrado.</p>
                <p>Adicione um contrato para formalizar os produtos (R$ {fmtBRL(totalMensal)}/mês).</p>
              </div>
            );
          }

          const diffMensal = Math.abs(totalMensal - ct.totalMensal);
          const diffAtivacao = Math.abs(totalAtivacao - ct.totalAtivacao);

          if (diffMensal > 0.01 || diffAtivacao > 0.01) {
            return (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 mt-2 space-y-1">
                <p className="font-medium">⚠ Os valores dos contratos divergem dos produtos.</p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div>
                    <span className="text-muted-foreground">Mensal produtos:</span> R$ {fmtBRL(totalMensal)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Mensal contratos:</span> R$ {fmtBRL(ct.totalMensal)}
                  </div>
                  {totalAtivacao > 0 && (
                    <>
                      <div>
                        <span className="text-muted-foreground">Ativação produtos:</span> R$ {fmtBRL(totalAtivacao)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Ativação contratos:</span> R$ {fmtBRL(ct.totalAtivacao)}
                      </div>
                    </>
                  )}
                </div>
                <p className="mt-1">Atualize o contrato existente, insira um aditivo ou registre um movimento MRR para conciliar.</p>
              </div>
            );
          }

          return null;
        })()}
      </CardContent>

      <ProdutoDialog
        open={produtoDialog.open}
        edit={produtoDialog.edit ?? null}
        onClose={() => setProdutoDialog({ open: false })}
        clienteId={clienteId}
        tid={tid}
        produtos={produtosLookup.data ?? []}
        fornecedores={fornecedoresLookup.data ?? []}
        onSaved={invalidateAll}
        modulosCountForEdit={produtoDialog.edit ? (modulosByProduto[produtoDialog.edit.id]?.length ?? 0) : 0}
      />

      <ModuloDialog
        open={moduloDialog.open}
        edit={moduloDialog.edit ?? null}
        clienteProdutoId={moduloDialog.clienteProdutoId}
        produtoId={moduloDialog.produtoId}
        tid={tid}
        onClose={() => setModuloDialog({ open: false })}
        onSaved={invalidateAll}
        produtoDataAtivacao={produtosQuery.data?.find(p => p.id === moduloDialog.clienteProdutoId)?.data_ativacao ?? null}
        onMRRSuggest={(d) => setMrrDialog({ open: true, ...d })}
      />

      <ReajusteModulosDialog
        open={reajusteDialog.open}
        onOpenChange={(o) => setReajusteDialog(prev => ({ ...prev, open: o }))}
        clienteProdutoId={reajusteDialog.clienteProdutoId ?? ''}
        produtoNome={reajusteDialog.produtoNome ?? ''}
        modulos={(modulosByProduto[reajusteDialog.clienteProdutoId ?? ''] ?? [])
          .filter((m: any) => m.ativo)
          .map((m: any) => ({
            id: m.id,
            nome: m.produto_modulos?.nome ?? '',
            vlr_mensal: Number(m.vlr_mensal) || 0,
            vlr_custo: Number(m.vlr_custo) || 0,
            ativo: m.ativo,
          }))}
        tenantId={tid}
        clienteId={clienteId}
        onSuccess={invalidateAll}
        onMRRSuggest={(d) => setMrrDialog({ open: true, ...d, moduloId: null })}
      />

      <SugestaoMRRDialog
        open={mrrDialog.open}
        onOpenChange={(o) => setMrrDialog(prev => ({ ...prev, open: o }))}
        clienteId={clienteId}
        tenantId={lookupTenantId}
        tipo={mrrDialog.tipo}
        valorDelta={mrrDialog.valorDelta}
        custoDelta={mrrDialog.custoDelta}
        descricaoSugerida={mrrDialog.descricao}
        moduloId={mrrDialog.moduloId}
        onRegistrado={invalidateAll}
      />

      <AlertDialog open={!!confirmDeleteModulo} onOpenChange={(o) => !o && setConfirmDeleteModulo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir módulo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Use apenas para corrigir lançamentos errados. Para um módulo que o cliente deixou de usar (downsell), prefira "Inativar". Os valores do produto são recalculados automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDeleteModulo) deleteModuloMut.mutate(confirmDeleteModulo.id);
                setConfirmDeleteModulo(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto do cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Se houver módulos vinculados, será necessário removê-los primeiro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => {
                if (confirmDelete) deleteProdutoMut.mutate(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ============ Produto Dialog ============
function ProdutoDialog({
  open, edit, onClose, clienteId, tid, produtos, fornecedores, onSaved, modulosCountForEdit,
}: {
  open: boolean;
  edit: ClienteProduto | null;
  onClose: () => void;
  clienteId: string;
  tid: string | null;
  produtos: { id: number; nome: string }[];
  fornecedores: { id: number; nome: string }[];
  onSaved: () => void;
  modulosCountForEdit: number;
}) {
  const isEdit = !!edit;
  const { profile } = useAuth();
  const isSuperAdmin = profile?.is_super_admin === true;
  const isTenantAdmin = profile?.role === "admin";
  const isHead = profile?.role === "head";
  const canSwapProduto = isEdit && (isSuperAdmin || isTenantAdmin || isHead) && modulosCountForEdit === 0;
  const [produtoId, setProdutoId] = useState<string>("");
  const [fornecedorId, setFornecedorId] = useState<string>("");
  const [codigo, setCodigo] = useState("");
  const [link, setLink] = useState("");
  const [dataAt, setDataAt] = useState("");
  const [vlrAt, setVlrAt] = useState<number | null>(null);
  const [vlrMensal, setVlrMensal] = useState<number | null>(null);
  const [vlrCusto, setVlrCusto] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmSwapOpen, setConfirmSwapOpen] = useState(false);
  // Após criar um novo produto/contrato, oferece o envio ao Omie no fim do fluxo
  const [postSaveContrato, setPostSaveContrato] = useState<{ id: string; numero: string | null; created_at: string | null } | null>(null);

  // Novos campos
  const [dataVenda, setDataVenda] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [prazoMeses, setPrazoMeses] = useState<number | null>(null);
  const [diaVencimento, setDiaVencimento] = useState<number | null>(null);
  const [modeloContratoId, setModeloContratoId] = useState<string>("");
  const [recorrencia, setRecorrencia] = useState<string>("");
  const [funcionarioId, setFuncionarioId] = useState<string>("");
  const [origemVendaId, setOrigemVendaId] = useState<string>("");
  const [formaPagAtivacaoId, setFormaPagAtivacaoId] = useState<string>("");
  const [formaPagMensalidadeId, setFormaPagMensalidadeId] = useState<string>("");
  const [observacoesContratuais, setObservacoesContratuais] = useState("");

  const produtoIdOriginal = edit?.produto_id ? String(edit.produto_id) : "";
  const produtoTrocou = isEdit && produtoId !== "" && produtoId !== produtoIdOriginal;

  // Lookups
  const clienteTenantQ = useQuery<{ tenant_id: string | null }>({
    queryKey: ["cliente_tenant_id", clienteId],
    enabled: open && !!clienteId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("clientes" as any) as any)
        .select("tenant_id").eq("id", clienteId).maybeSingle();
      if (error) throw error;
      return (data ?? { tenant_id: null }) as any;
    },
  });
  const resolvedTenantId: string | null = (clienteTenantQ.data?.tenant_id ?? tid) ?? null;

  const modelosContratoLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["modelos_contrato_lookup", resolvedTenantId],
    enabled: open && !!resolvedTenantId,
    queryFn: async () => {
      let q = (supabase.from("modelos_contrato" as any) as any).select("id, nome").order("nome");
      if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });
  const funcionariosLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["funcionarios_lookup", resolvedTenantId],
    enabled: open && !!resolvedTenantId,
    queryFn: async () => {
      let q = (supabase.from("funcionarios" as any) as any).select("id, nome").order("nome");
      if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });
  const origensVendaLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["origens_venda_lookup", resolvedTenantId],
    enabled: open && !!resolvedTenantId,
    queryFn: async () => {
      let q = (supabase.from("origens_venda" as any) as any).select("id, nome").order("nome");
      if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });
  const formasPagamentoLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["formas_pagamento_lookup", resolvedTenantId],
    enabled: open && !!resolvedTenantId,
    queryFn: async () => {
      let q = (supabase.from("formas_pagamento" as any) as any).select("id, nome").order("nome");
      if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  // ========= Omie: tenant a partir do cliente + integração ativa + padrões =========

  const omieAtivoQ = useQuery({
    queryKey: ["omie_integration_ativo_dialog", resolvedTenantId],
    enabled: open && !!resolvedTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("omie_integration" as any) as any)
        .select("tenant_id")
        .eq("tenant_id", resolvedTenantId as string)
        .eq("ativo", true)
        .maybeSingle();
      // eslint-disable-next-line no-console
      console.log("[ProdutoDialog/Omie] tenantId resolvido:", resolvedTenantId, "omie_integration:", data, "error:", error);
      if (error) throw error;
      return !!data;
    },
  });
  const omieAtivo = omieAtivoQ.data === true;

  const omiePadroesQ = useQuery({
    queryKey: ["omie_padroes_lists_dialog", resolvedTenantId],
    enabled: open && omieAtivo && !!resolvedTenantId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "ler_padroes", tenant_id: resolvedTenantId, dados: { operacao: "ler" } },
      });
      if (error) throw error;
      const resultado = (data as any)?.resultado ?? (data as any)?.dados ?? data ?? {};
      if (resultado?.ok === false) {
        throw new Error(resultado?.error || "Falha ao carregar opções do Omie");
      }
      return {
        contas: (resultado.contas ?? []) as Array<{ codigo: any; descricao: string }>,
        servicos: (resultado.servicos ?? []) as Array<{ codigo: any; descricao: string }>,
        tipos_faturamento: (resultado.tipos_faturamento ?? []) as Array<{ codigo: any; descricao: string }>,
      };

    },
  });

  // Carrega o produto selecionado para ler campos omie_* atuais
  const produtoOmieQ = useQuery({
    queryKey: ["produto_omie_atual", produtoId, resolvedTenantId],
    enabled: open && omieAtivo && !!produtoId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos" as any) as any)
        .select("id, omie_servico_codigo, omie_conta_corrente_codigo, omie_tipo_faturamento_codigo, omie_dia_faturamento, omie_numero_parcelas, omie_permite_servidor_nuvem")
        .eq("id", Number(produtoId))
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // Estado dos campos Omie
  const [omieServico, setOmieServico] = useState<string>("");
  const [omieConta, setOmieConta] = useState<string>("");
  const [omieTipoFat, setOmieTipoFat] = useState<string>("");
  const [omieDiaFat, setOmieDiaFat] = useState<string>("");
  const [omieNumParcelas, setOmieNumParcelas] = useState<string>("");
  const [omiePermiteNuvem, setOmiePermiteNuvem] = useState<boolean>(false);

  useEffect(() => {
    const p = produtoOmieQ.data;
    setOmieServico(p?.omie_servico_codigo != null ? String(p.omie_servico_codigo) : "");
    setOmieConta(p?.omie_conta_corrente_codigo != null ? String(p.omie_conta_corrente_codigo) : "");
    setOmieTipoFat(p?.omie_tipo_faturamento_codigo ?? "");
    setOmieDiaFat(p?.omie_dia_faturamento != null ? String(p.omie_dia_faturamento) : "");
    setOmieNumParcelas(p?.omie_numero_parcelas != null ? String(p.omie_numero_parcelas) : "");
    setOmiePermiteNuvem(p?.omie_permite_servidor_nuvem === true);
  }, [produtoOmieQ.data, produtoId]);



  // Reset on open
  useMemo(() => {
    if (open) {
      const e = edit as any;
      setProdutoId(edit?.produto_id ? String(edit.produto_id) : "");
      setFornecedorId(edit?.fornecedor_id ? String(edit.fornecedor_id) : "");
      setCodigo(edit?.codigo_fornecedor ?? "");
      setLink(edit?.link_portal_fornecedor ?? "");
      setDataAt(edit?.data_ativacao ?? "");
      setVlrAt(edit?.vlr_ativacao ?? null);
      setVlrMensal(edit?.vlr_mensal ? Number(edit.vlr_mensal) || null : null);
      setVlrCusto(edit?.vlr_custo ? Number(edit.vlr_custo) || null : null);
      setDataVenda(e?.data_venda ?? "");
      setDataFim(e?.data_fim ?? "");
      setPrazoMeses(e?.prazo_meses ?? null);
      setDiaVencimento(e?.dia_vencimento ?? null);
      setModeloContratoId(e?.modelo_contrato_id ? String(e.modelo_contrato_id) : "");
      setRecorrencia(e?.recorrencia ?? "");
      setFuncionarioId(e?.funcionario_id ? String(e.funcionario_id) : "");
      setOrigemVendaId(e?.origem_venda_id ? String(e.origem_venda_id) : "");
      setFormaPagAtivacaoId(e?.forma_pagamento_ativacao_id ? String(e.forma_pagamento_ativacao_id) : "");
      setFormaPagMensalidadeId(e?.forma_pagamento_mensalidade_id ? String(e.forma_pagamento_mensalidade_id) : "");
      setObservacoesContratuais(e?.observacoes_contratuais ?? "");
      setTimeout(() => setDataProximoReajuste(e?.data_proximo_reajuste ?? ""), 0);
    }
  }, [open, edit]);

  const [dataProximoReajuste, setDataProximoReajuste] = useState("");
  useEffect(() => {
    if (!dataAt) {
      setDataProximoReajuste("");
      return;
    }
    const start = new Date(dataAt + "T00:00:00");
    if (isNaN(start.getTime())) {
      setDataProximoReajuste("");
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next = new Date(start);
    let guard = 0;
    while (next <= today && guard < 600) {
      next.setMonth(next.getMonth() + 12);
      guard++;
    }
    const y = next.getFullYear();
    const m = String(next.getMonth() + 1).padStart(2, "0");
    const d = String(next.getDate()).padStart(2, "0");
    setDataProximoReajuste(`${y}-${m}-${d}`);
  }, [dataAt]);



  const executeSave = async () => {
    if (!produtoId) {
      toast({ title: "Selecione um produto", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isEdit && edit) {
        const payload: any = {
          fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
          codigo_fornecedor: codigo || null,
          link_portal_fornecedor: link || null,
          data_ativacao: dataAt || null,
          vlr_ativacao: vlrAt,
          vlr_mensal: vlrMensal || 0,
          vlr_custo: vlrCusto || 0,
          data_venda: dataVenda || null,
          data_fim: dataFim || null,
          data_proximo_reajuste: dataProximoReajuste || null,
          prazo_meses: prazoMeses,
          dia_vencimento: diaVencimento,
          modelo_contrato_id: modeloContratoId ? Number(modeloContratoId) : null,
          recorrencia: recorrencia || null,
          funcionario_id: funcionarioId ? Number(funcionarioId) : null,
          origem_venda_id: origemVendaId ? Number(origemVendaId) : null,
          forma_pagamento_ativacao_id: formaPagAtivacaoId ? Number(formaPagAtivacaoId) : null,
          forma_pagamento_mensalidade_id: formaPagMensalidadeId ? Number(formaPagMensalidadeId) : null,
          observacoes_contratuais: observacoesContratuais || null,
        };
        // Se trocou produto, chama RPC primeiro (gate + propagação contrato_itens)
        if (produtoTrocou) {
          const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
            "admin_swap_cliente_produto",
            {
              p_cliente_produto_id: edit.id,
              p_novo_produto_id: Number(produtoId),
              p_novo_fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
            }
          );
          if (rpcError) throw rpcError;
          const updated = (rpcData as any)?.contrato_itens_atualizados ?? 0;
          toast({
            title: "Produto trocado",
            description: updated > 0
              ? `${updated} item(ns) de contrato tiveram descrição atualizada.`
              : "Nenhum item de contrato afetado.",
          });
          delete payload.fornecedor_id;
        }
        const { error } = await (supabase.from("cliente_produtos" as any) as any)
          .update(payload).eq("id", edit.id);
        if (error) throw error;

        // Sync para contrato (não bloquear em erro)
        try {
          const { error: syncErr } = await (supabase.rpc as any)("sync_cliente_produto_to_contract", {
            p_cliente_produto_id: edit.id,
          });
          if (syncErr) {
            toast({ title: "Atenção", description: `Sync de contrato falhou: ${syncErr.message}`, variant: "destructive" });
          }
        } catch (syncCatch: any) {
          toast({ title: "Atenção", description: `Sync de contrato falhou: ${syncCatch?.message ?? ""}`, variant: "destructive" });
        }
      } else {
        const dados: any = {
          fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
          codigo_fornecedor: codigo || null,
          link_portal_fornecedor: link || null,
          vlr_ativacao: vlrAt ?? 0,
          vlr_mensal: vlrMensal ?? 0,
          vlr_custo: vlrCusto ?? 0,
          data_venda: dataVenda || null,
          data_ativacao: dataAt || null,
          data_fim: dataFim || null,
          data_proximo_reajuste: dataProximoReajuste || null,
          prazo_meses: prazoMeses,
          dia_vencimento: diaVencimento,
          modelo_contrato_id: modeloContratoId ? Number(modeloContratoId) : null,
          recorrencia: recorrencia || null,
          funcionario_id: funcionarioId ? Number(funcionarioId) : null,
          origem_venda_id: origemVendaId ? Number(origemVendaId) : null,
          forma_pagamento_ativacao_id: formaPagAtivacaoId ? Number(formaPagAtivacaoId) : null,
          forma_pagamento_mensalidade_id: formaPagMensalidadeId ? Number(formaPagMensalidadeId) : null,
          observacoes_contratuais: observacoesContratuais || null,
        };
        const { error } = await (supabase.rpc as any)("create_cliente_produto_with_contract", {
          p_cliente_id: clienteId,
          p_produto_id: Number(produtoId),
          p_dados: dados,
        });
        if (error) throw error;
      }

      // Salva campos omie_* na tabela produtos (escopado por tenant) se Omie ativo
      if (omieAtivo && produtoId && resolvedTenantId) {
        const parseIntOrNull = (s: string) => {
          const t = s.trim(); if (!t) return null;
          const n = Number(t); return Number.isFinite(n) ? Math.trunc(n) : null;
        };
        const dia = parseIntOrNull(omieDiaFat);
        if (dia !== null && (dia < 1 || dia > 31)) {
          toast({ title: "Dia de faturamento inválido", description: "Use um valor entre 1 e 31.", variant: "destructive" });
        } else {
          const omiePayload = {
            omie_servico_codigo: omieServico ? Number(omieServico) : null,
            omie_conta_corrente_codigo: omieConta ? Number(omieConta) : null,
            omie_tipo_faturamento_codigo: omieTipoFat || null,
            omie_dia_faturamento: dia,
            omie_numero_parcelas: parseIntOrNull(omieNumParcelas),
            omie_permite_servidor_nuvem: !!omiePermiteNuvem,
          };
          const { error: omieErr } = await (supabase.from("produtos" as any) as any)
            .update(omiePayload)
            .eq("id", Number(produtoId))
            .eq("tenant_id", resolvedTenantId);
          if (omieErr) {
            toast({ title: "Atenção", description: `Falha ao salvar campos Omie: ${omieErr.message}`, variant: "destructive" });
          }
        }
      }

      if (!produtoTrocou) {
        toast({ title: isEdit ? "Produto atualizado" : "Produto adicionado" });
      }

      // Fluxo de lançamento novo com Omie ativo: oferece o envio ao Omie no fim do fluxo,
      // no momento em que a pessoa sabe que terminou o lançamento. Reaproveita o
      // EnviarContratoOmieButton (dry_run → confirmação → criar).
      if (!isEdit && !produtoTrocou && omieAtivo && resolvedTenantId) {
        const { data: ctr } = await (supabase.from("contratos" as any) as any)
          .select("id, numero, created_at")
          .eq("cliente_id", clienteId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ctr?.id) {
          setPostSaveContrato({ id: ctr.id as string, numero: (ctr as any).numero ?? null, created_at: (ctr as any).created_at ?? null });
          onSaved();
          return; // não fecha o diálogo — mostra o passo "Enviar ao Omie"
        }
      }

      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!produtoId) {
      toast({ title: "Selecione um produto", variant: "destructive" });
      return;
    }
    if (produtoTrocou) {
      setConfirmSwapOpen(true);
      return;
    }
    await executeSave();
  };

  const modelosContrato = modelosContratoLookup.data ?? [];
  const funcionariosList = funcionariosLookup.data ?? [];
  const origensVenda = origensVendaLookup.data ?? [];
  const formasPagamento = formasPagamentoLookup.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Produto" : "Adicionar Produto"}</DialogTitle>
        </DialogHeader>

        {/* Identificação */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Identificação</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Fornecedor</Label>
              <Select value={fornecedorId || "__none__"} onValueChange={(v) => setFornecedorId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhum —</SelectItem>
                  {fornecedores.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Produto *</Label>
              <Select value={produtoId} onValueChange={setProdutoId} disabled={isEdit && !canSwapProduto}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {produtos.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {isEdit && !canSwapProduto && (
                <p className="text-xs text-muted-foreground">
                  {modulosCountForEdit > 0
                    ? "Remova os módulos vinculados para trocar o produto."
                    : "Apenas admin pode trocar o produto."}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Código Fornecedor</Label>
              <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Link Portal Fornecedor</Label>
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
            </div>
          </div>
        </div>

        <Separator />

        {/* Valores */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Valores</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Valor Ativação</Label>
              <NumericInput value={vlrAt} onChange={setVlrAt} decimals={2} placeholder="0,00" suffix="R$" />
            </div>
            <div className="space-y-1">
              <Label>Valor Mensal</Label>
              <NumericInput value={vlrMensal} onChange={setVlrMensal} decimals={2} placeholder="0,00" suffix="R$" />
            </div>
            <div className="space-y-1">
              <Label>Custo Operação</Label>
              <NumericInput value={vlrCusto} onChange={setVlrCusto} decimals={2} placeholder="0,00" suffix="R$" />
            </div>
          </div>
        </div>

        <Separator />

        {/* Vigência & Reajuste */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Vigência & Reajuste</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Data Venda</Label>
              <Input type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Data Ativação</Label>
              <Input type="date" value={dataAt} onChange={(e) => setDataAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Prazo (meses)</Label>
              <Input
                type="number"
                min={1}
                value={prazoMeses ?? ""}
                onChange={(e) => setPrazoMeses(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div className="space-y-1">
              <Label>Próximo Reajuste</Label>
              <Input
                type="date"
                value={dataProximoReajuste}
                onChange={(ev) => setDataProximoReajuste(ev.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Calculado automaticamente (reajuste anual). Editável caso o cliente tenha data específica.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Dia Vencimento</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={diaVencimento ?? ""}
                onChange={(e) => setDiaVencimento(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Comercial */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Comercial</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Modelo de Contrato</Label>
              <Select value={modeloContratoId || "__none__"} onValueChange={(v) => setModeloContratoId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhum —</SelectItem>
                  {modelosContrato.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Recorrência</Label>
              <Select value={recorrencia || "__none__"} onValueChange={(v) => setRecorrencia(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhuma —</SelectItem>
                  <SelectItem value="semanal">Semanal</SelectItem>
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="semestral">Semestral</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Vendedor</Label>
              <Select value={funcionarioId || "__none__"} onValueChange={(v) => setFuncionarioId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhum —</SelectItem>
                  {funcionariosList.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Origem da Venda</Label>
              <Select value={origemVendaId || "__none__"} onValueChange={(v) => setOrigemVendaId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhuma —</SelectItem>
                  {origensVenda.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        {/* Pagamento */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Pagamento</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Forma Pag. Ativação</Label>
              <Select value={formaPagAtivacaoId || "__none__"} onValueChange={(v) => setFormaPagAtivacaoId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhuma —</SelectItem>
                  {formasPagamento.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Forma Pag. Mensalidade</Label>
              <Select value={formaPagMensalidadeId || "__none__"} onValueChange={(v) => setFormaPagMensalidadeId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhuma —</SelectItem>
                  {formasPagamento.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        {/* Observações Contratuais */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Observações Contratuais</h4>
          <Textarea
            rows={3}
            value={observacoesContratuais}
            onChange={(e) => setObservacoesContratuais(e.target.value)}
          />
        </div>


        {omieAtivo && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground">Integração Omie</h4>
              <p className="text-xs text-muted-foreground">
                Valores específicos deste produto. Se vazios, os padrões da integração serão usados.
              </p>
              {omiePadroesQ.isError && (
                <p className="text-xs text-destructive">Não foi possível carregar as opções do Omie.</p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                <div className="space-y-1">
                  <Label>Serviço Omie</Label>
                  <Select
                    value={omieServico || "__default__"}
                    onValueChange={(v) => setOmieServico(v === "__default__" ? "" : v)}
                    disabled={omiePadroesQ.isLoading}
                  >
                    <SelectTrigger><SelectValue placeholder="Usar padrão" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">— Usar padrão —</SelectItem>
                      {(omiePadroesQ.data?.servicos ?? []).map((s) => (
                        <SelectItem key={String(s.codigo)} value={String(s.codigo)}>{s.descricao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Conta Corrente</Label>
                  <Select
                    value={omieConta || "__default__"}
                    onValueChange={(v) => setOmieConta(v === "__default__" ? "" : v)}
                    disabled={omiePadroesQ.isLoading}
                  >
                    <SelectTrigger><SelectValue placeholder="Usar padrão" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">— Usar padrão —</SelectItem>
                      {(omiePadroesQ.data?.contas ?? []).map((c) => (
                        <SelectItem key={String(c.codigo)} value={String(c.codigo)}>{c.descricao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Tipo de Faturamento</Label>
                  <Select
                    value={omieTipoFat || "__default__"}
                    onValueChange={(v) => setOmieTipoFat(v === "__default__" ? "" : v)}
                    disabled={omiePadroesQ.isLoading}
                  >
                    <SelectTrigger><SelectValue placeholder="Usar padrão" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">— Usar padrão —</SelectItem>
                      {(omiePadroesQ.data?.tipos_faturamento ?? []).map((t) => (
                        <SelectItem key={String(t.codigo)} value={String(t.codigo)}>{t.descricao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Dia de Faturamento</Label>
                  <Input
                    type="number" min={1} max={31}
                    value={omieDiaFat}
                    onChange={(e) => setOmieDiaFat(e.target.value)}
                    placeholder="1-31"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Número de Parcelas</Label>
                  <Input
                    type="number" min={1}
                    value={omieNumParcelas}
                    onChange={(e) => setOmieNumParcelas(e.target.value)}
                    placeholder="—"
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-2 md:col-span-1">
                  <Label className="text-sm">Permite servidor em nuvem</Label>
                  <Switch checked={omiePermiteNuvem} onCheckedChange={setOmiePermiteNuvem} />
                </div>
              </div>
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground mt-2">

          Se este produto terá módulos detalhados, os valores serão recalculados automaticamente.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
          </Button>
        </DialogFooter>

        <AlertDialog open={confirmSwapOpen} onOpenChange={setConfirmSwapOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Confirmar troca de produto
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>Você está prestes a trocar o produto deste registro. Esta ação:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Atualizará o produto vinculado ao cliente</li>
                    <li>Sobrescreverá a descrição dos itens de contrato apontados</li>
                    <li><strong>NÃO altera valores</strong> (mensal/ativação) do contrato — revise manualmente se necessário</li>
                  </ul>
                  <p className="text-amber-500 font-medium">
                    Use apenas para correção de erro de cadastro.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
              <AlertDialogAction
                type="button"
                onClick={async () => {
                  setConfirmSwapOpen(false);
                  await executeSave();
                }}
              >
                Trocar produto
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

// ============ Modulo Dialog ============
function ModuloDialog({
  open, edit, clienteProdutoId, produtoId, tid, onClose, onSaved, produtoDataAtivacao, onMRRSuggest,
}: {
  open: boolean;
  edit: ClienteProdutoModulo | null;
  clienteProdutoId?: string;
  produtoId?: number;
  tid: string | null;
  onClose: () => void;
  onSaved: () => void;
  produtoDataAtivacao?: string | null;
  onMRRSuggest?: (data: { tipo: "upsell"; valorDelta: number; custoDelta: number; descricao: string; moduloId?: string | null }) => void;
}) {
  const isEdit = !!edit;
  const [moduloId, setModuloId] = useState<string>("");
  const [quantidade, setQuantidade] = useState<number>(1);
  const [vlrMensal, setVlrMensal] = useState<number | null>(0);
  const [vlrCusto, setVlrCusto] = useState<number | null>(0);
  const [vlrAtivacao, setVlrAtivacao] = useState<number | null>(0);
  const [dataAt, setDataAt] = useState("");
  const [saving, setSaving] = useState(false);

  useMemo(() => {
    if (open) {
      setModuloId(edit?.modulo_id ?? "");
      setQuantidade(edit?.quantidade ?? 1);
      setVlrMensal(edit?.vlr_mensal ?? 0);
      setVlrCusto(edit?.vlr_custo ?? 0);
      setVlrAtivacao(edit?.vlr_ativacao ?? 0);
      setDataAt(edit?.data_ativacao ?? produtoDataAtivacao ?? "");
    }
  }, [open, edit, produtoDataAtivacao]);

  const catalogoQuery = useQuery<{ id: string; nome: string; descricao: string | null }[]>({
    queryKey: ["catalogo_modulos_produto", tid, produtoId],
    enabled: !!produtoId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produto_modulos" as any) as any)
        .select("id, nome, descricao")
        .eq("produto_id", produtoId)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const handleSave = async () => {
    if (!moduloId) {
      toast({ title: "Selecione um módulo", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        quantidade: quantidade || 1,
        vlr_mensal: vlrMensal || 0,
        vlr_custo: vlrCusto || 0,
        vlr_ativacao: vlrAtivacao || 0,
        data_ativacao: dataAt || null,
      };
      if (isEdit && edit) {
        const { error } = await (supabase.from("cliente_produto_modulos" as any) as any)
          .update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("cliente_produto_modulos" as any) as any).insert({
          ...payload,
          tenant_id: tid,
          cliente_produto_id: clienteProdutoId,
          modulo_id: moduloId,
          ativo: true,
        });
        if (error) throw error;
      }
      toast({ title: isEdit ? "Módulo atualizado" : "Módulo adicionado" });
      onSaved();
      onClose();
      if (!isEdit && (vlrMensal || 0) > 0) {
        const nomeModulo = catalogoQuery.data?.find(m => m.id === moduloId)?.nome ?? "";
        onMRRSuggest?.({
          tipo: "upsell",
          valorDelta: (vlrMensal || 0) * (quantidade || 1),
          custoDelta: (vlrCusto || 0) * (quantidade || 1),
          descricao: `Módulo ${nomeModulo} adicionado${(quantidade || 1) > 1 ? ` (${quantidade}×)` : ""}`,
          moduloId: null,
        });
      }
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Módulo" : "Adicionar Módulo"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1 md:col-span-2">
            <Label>Módulo *</Label>
            <Select value={moduloId} onValueChange={setModuloId} disabled={isEdit}>
              <SelectTrigger>
                <SelectValue placeholder={catalogoQuery.isLoading ? "Carregando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent>
                {(catalogoQuery.data ?? []).map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={1}
              step={1}
              value={quantidade}
              onChange={(e) => setQuantidade(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </div>
          <div className="space-y-1">
            <Label>Valor Mensal (unit.)</Label>
            <NumericInput value={vlrMensal} onChange={setVlrMensal} suffix="R$" />
          </div>
          <div className="space-y-1">
            <Label>Valor Custo (unit.)</Label>
            <NumericInput value={vlrCusto} onChange={setVlrCusto} suffix="R$" />
          </div>
          <div className="space-y-1">
            <Label>Valor Ativação</Label>
            <NumericInput value={vlrAtivacao} onChange={setVlrAtivacao} suffix="R$" />
          </div>
          <div className="space-y-1">
            <Label>Data Ativação</Label>
            <Input type="date" value={dataAt} onChange={(e) => setDataAt(e.target.value)} />
          </div>
          <div className="md:col-span-2 rounded-md border bg-muted/30 p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Total do módulo ({quantidade}×)</span>
            <span className="font-semibold">
              Mensal: <span className="text-primary">R$ {fmtBRL((Number(vlrMensal) || 0) * (quantidade || 1))}</span>
              {"  ·  "}
              Custo: <span className="text-muted-foreground">R$ {fmtBRL((Number(vlrCusto) || 0) * (quantidade || 1))}</span>
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
