import { useMemo, useState } from "react";
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
  ExternalLink, Loader2, Puzzle,
} from "lucide-react";
import { NumericInput } from "@/components/ui/numeric-input";
import SugestaoMRRDialog from "./SugestaoMRRDialog";

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

  const produtosLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["produtos_lookup", tid],
    queryFn: async () => {
      let q = (supabase.from("produtos" as any) as any).select("id, nome").order("nome");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const fornecedoresLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["fornecedores_lookup", tid],
    queryFn: async () => {
      let q = supabase.from("fornecedores").select("id, nome").order("nome");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["cliente_produtos", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["cliente_produto_modulos", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["cliente", clienteId] });
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
    onSuccess: () => {
      toast({ title: "Módulo atualizado" });
      invalidateAll();
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  // ---- Totals ----
  const ativos = (produtosQuery.data ?? []).filter(p => p.ativo);
  const totalMensal = ativos.reduce((s, p) => s + (Number(p.vlr_mensal) || 0), 0);
  const totalCusto = ativos.reduce((s, p) => s + (Number(p.vlr_custo) || 0), 0);

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
                      <div>
                        <Badge variant={p.ativo ? "default" : "secondary"} className="shrink-0">
                          R$ {fmtBRL(p.vlr_mensal)}/mês
                        </Badge>
                        {" "}
                        <Badge variant="outline" className="shrink-0 text-muted-foreground">
                          Custo: R$ {fmtBRL(p.vlr_custo)}
                        </Badge>
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
                                <TableHead className="text-right">Vlr Mensal</TableHead>
                                <TableHead className="text-right">Vlr Custo</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-24 text-right">Ações</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {mods.map(m => (
                                <TableRow key={m.id}>
                                  <TableCell className="font-medium">{m.produto_modulos?.nome ?? "—"}</TableCell>
                                  <TableCell className="text-right">R$ {fmtBRL(m.vlr_mensal)}</TableCell>
                                  <TableCell className="text-right">R$ {fmtBRL(m.vlr_custo)}</TableCell>
                                  <TableCell>
                                    <Badge variant={m.ativo ? "default" : "secondary"}>{m.ativo ? "Ativo" : "Inativo"}</Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setModuloDialog({ open: true, clienteProdutoId: p.id, produtoId: p.produto_id, edit: m })}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => toggleModuloMut.mutate(m)} disabled={toggleModuloMut.isPending}>
                                      {m.ativo ? "Inativar" : "Reativar"}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>

                      <Button type="button" variant="outline" size="sm" onClick={() => setModuloDialog({ open: true, clienteProdutoId: p.id, produtoId: p.produto_id, edit: null })}>
                        <Plus className="h-4 w-4 mr-1" /> <Puzzle className="h-4 w-4 mr-1" /> Adicionar Módulo
                      </Button>
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
          </div>
          <div className="text-xs text-muted-foreground">Mensalidade do cliente é recalculada automaticamente.</div>
        </div>
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
      />

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
  open, edit, onClose, clienteId, tid, produtos, fornecedores, onSaved,
}: {
  open: boolean;
  edit: ClienteProduto | null;
  onClose: () => void;
  clienteId: string;
  tid: string | null;
  produtos: { id: number; nome: string }[];
  fornecedores: { id: number; nome: string }[];
  onSaved: () => void;
}) {
  const isEdit = !!edit;
  const [produtoId, setProdutoId] = useState<string>("");
  const [fornecedorId, setFornecedorId] = useState<string>("");
  const [codigo, setCodigo] = useState("");
  const [link, setLink] = useState("");
  const [dataAt, setDataAt] = useState("");
  const [vlrAt, setVlrAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset on open
  useMemo(() => {
    if (open) {
      setProdutoId(edit?.produto_id ? String(edit.produto_id) : "");
      setFornecedorId(edit?.fornecedor_id ? String(edit.fornecedor_id) : "");
      setCodigo(edit?.codigo_fornecedor ?? "");
      setLink(edit?.link_portal_fornecedor ?? "");
      setDataAt(edit?.data_ativacao ?? "");
      setVlrAt(edit?.vlr_ativacao ?? null);
    }
  }, [open, edit]);

  const handleSave = async () => {
    if (!produtoId) {
      toast({ title: "Selecione um produto", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
        codigo_fornecedor: codigo || null,
        link_portal_fornecedor: link || null,
        data_ativacao: dataAt || null,
        vlr_ativacao: vlrAt,
      };
      if (isEdit && edit) {
        const { error } = await (supabase.from("cliente_produtos" as any) as any)
          .update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("cliente_produtos" as any) as any).insert({
          ...payload,
          tenant_id: tid,
          cliente_id: clienteId,
          produto_id: Number(produtoId),
          ativo: true,
        });
        if (error) throw error;
      }
      toast({ title: isEdit ? "Produto atualizado" : "Produto adicionado" });
      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Produto" : "Adicionar Produto"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Produto *</Label>
            <Select value={produtoId} onValueChange={setProdutoId} disabled={isEdit}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {produtos.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
            <Label>Código Fornecedor</Label>
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Link Portal Fornecedor</Label>
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-1">
            <Label>Data Ativação</Label>
            <Input type="date" value={dataAt} onChange={(e) => setDataAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Valor Ativação</Label>
            <NumericInput value={vlrAt} onChange={setVlrAt} suffix="R$" />
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

// ============ Modulo Dialog ============
function ModuloDialog({
  open, edit, clienteProdutoId, produtoId, tid, onClose, onSaved, produtoDataAtivacao,
}: {
  open: boolean;
  edit: ClienteProdutoModulo | null;
  clienteProdutoId?: string;
  produtoId?: number;
  tid: string | null;
  onClose: () => void;
  onSaved: () => void;
  produtoDataAtivacao?: string | null;
}) {
  const isEdit = !!edit;
  const [moduloId, setModuloId] = useState<string>("");
  const [vlrMensal, setVlrMensal] = useState<number | null>(0);
  const [vlrCusto, setVlrCusto] = useState<number | null>(0);
  const [vlrAtivacao, setVlrAtivacao] = useState<number | null>(0);
  const [dataAt, setDataAt] = useState("");
  const [saving, setSaving] = useState(false);

  useMemo(() => {
    if (open) {
      setModuloId(edit?.modulo_id ?? "");
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
            <Label>Valor Mensal</Label>
            <NumericInput value={vlrMensal} onChange={setVlrMensal} suffix="R$" />
          </div>
          <div className="space-y-1">
            <Label>Valor Custo</Label>
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
