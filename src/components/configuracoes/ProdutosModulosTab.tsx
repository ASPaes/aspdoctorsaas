import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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


interface Produto { id: number; nome: string; tenant_id: string; }
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

  // Produto dialog
  const [produtoDialogOpen, setProdutoDialogOpen] = useState(false);
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const [produtoNome, setProdutoNome] = useState("");
  const [savingProduto, setSavingProduto] = useState(false);

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

  const selectedProduto = produtosQ.data?.find(p => p.id === selectedProdutoId) ?? null;

  // Produto handlers
  const openNewProduto = () => { setEditingProduto(null); setProdutoNome(""); setProdutoDialogOpen(true); };
  const openEditProduto = (p: Produto) => { setEditingProduto(p); setProdutoNome(p.nome); setProdutoDialogOpen(true); };

  const saveProduto = async () => {
    if (!produtoNome.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    setSavingProduto(true);
    try {
      if (editingProduto) {
        const { error } = await (supabase.from("produtos" as any) as any)
          .update({ nome: produtoNome.trim() })
          .eq("id", editingProduto.id);
        if (error) throw error;
        toast({ title: "Produto atualizado" });
      } else {
        const { error } = await (supabase.from("produtos" as any) as any)
          .insert({ nome: produtoNome.trim(), tenant_id: tid });
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
                          onClick={() => setSelectedProdutoId(p.id)}
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
                <Badge variant="secondary">{(modulosQ.data ?? []).length} módulos</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={openNewModulo} size="sm"><Plus />Novo Módulo</Button>
              </div>
            </div>

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
                            <Button variant="ghost" size="icon" onClick={() => openEditModulo(m)}><Pencil /></Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteModulo(m)}><Trash2 /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {/* Produto Dialog */}
      <Dialog open={produtoDialogOpen} onOpenChange={setProdutoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduto ? "Editar Produto" : "Novo Produto"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="produto-nome">Nome</Label>
              <Input id="produto-nome" value={produtoNome} onChange={(e) => setProdutoNome(e.target.value)} autoFocus />
            </div>
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
            <div className="grid grid-cols-3 gap-3">
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
