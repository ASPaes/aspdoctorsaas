import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronRight, Plus, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

interface Category {
  id: string;
  tenant_id: string;
  nome: string;
  ativo: boolean;
  linkedProductIds: number[];
  linkedProductNames: string[];
}

interface Subcategory {
  id: string;
  tenant_id: string;
  category_id: string;
  nome: string;
  ativo: boolean;
}

interface Product {
  id: number;
  nome: string;
}

export default function CategoriasServicosTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const qc = useQueryClient();
  const { can } = usePermissions();
  const DENY_MSG = "Você não tem acesso a esta ação. Entre em contato com o administrador.";
  const guardInsert = () => { if (!can("cfg.categorias_servico", "insert")) { toast({ title: DENY_MSG, variant: "destructive" }); return false; } return true; };
  const guardUpdate = () => { if (!can("cfg.categorias_servico", "update")) { toast({ title: DENY_MSG, variant: "destructive" }); return false; } return true; };

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Category dialog
  const [catOpen, setCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catNome, setCatNome] = useState("");
  const [catLinkedProducts, setCatLinkedProducts] = useState<string[]>([]);
  const [catAtivo, setCatAtivo] = useState(true);

  // Subcategory dialog
  const [subOpen, setSubOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<Subcategory | null>(null);
  const [subParentCatId, setSubParentCatId] = useState<string>("");
  const [subNome, setSubNome] = useState("");
  const [subAtivo, setSubAtivo] = useState(true);

  const { data: produtos = [] } = useQuery({
    queryKey: ["cats_produtos", tid],
    queryFn: async () => {
      let q = (supabase.from("produtos" as any) as any).select("id, nome").order("nome");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  const { data: categoryLinks = [] } = useQuery({
    queryKey: ["cats_category_products", tid],
    queryFn: async () => {
      let q = (supabase.from("service_category_products" as any) as any)
        .select("category_id, produto_id");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { category_id: string; produto_id: number }[];
    },
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ["cats_categorias", tid, produtos, categoryLinks],
    queryFn: async () => {
      let q = (supabase.from("service_categories" as any) as any)
        .select("id, tenant_id, nome, ativo, created_at, updated_at")
        .order("nome");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const prodMap = new Map(produtos.map((p) => [p.id, p.nome]));
      const linksByCat = new Map<string, number[]>();
      for (const l of categoryLinks) {
        const arr = linksByCat.get(l.category_id) ?? [];
        arr.push(l.produto_id);
        linksByCat.set(l.category_id, arr);
      }
      return rows.map((r) => {
        const ids = linksByCat.get(r.id) ?? [];
        return {
          ...r,
          linkedProductIds: ids,
          linkedProductNames: ids.map((id) => prodMap.get(id)).filter(Boolean) as string[],
        } as Category;
      });
    },
  });

  const { data: subcategorias = [] } = useQuery({
    queryKey: ["cats_subcategorias", tid],
    queryFn: async () => {
      let q = (supabase.from("service_subcategories" as any) as any)
        .select("*")
        .order("nome");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Subcategory[];
    },
  });

  const subsByCategory = useMemo(() => {
    const map = new Map<string, Subcategory[]>();
    for (const s of subcategorias) {
      const arr = map.get(s.category_id) ?? [];
      arr.push(s);
      map.set(s.category_id, arr);
    }
    return map;
  }, [subcategorias]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openNewCategory = () => {
    if (!guardInsert()) return;
    setEditingCat(null);
    setCatNome("");
    setCatLinkedProducts([]);
    setCatAtivo(true);
    setCatOpen(true);
  };

  const openEditCategory = (c: Category) => {
    if (!guardUpdate()) return;
    setEditingCat(c);
    setCatNome(c.nome);
    setCatLinkedProducts(c.linkedProductIds.map(String));
    setCatAtivo(c.ativo);
    setCatOpen(true);
  };

  const saveCategory = async () => {
    if (!catNome.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    const payload: any = {
      nome: catNome.trim(),
      ativo: catAtivo,
    };
    if (!editingCat && tid) payload.tenant_id = tid;

    const table = supabase.from("service_categories" as any) as any;
    let categoryId: string | null = editingCat?.id ?? null;

    if (editingCat) {
      const { error } = await table.update(payload).eq("id", editingCat.id);
      if (error) {
        toast({ title: "Erro ao salvar categoria", description: error.message, variant: "destructive" });
        return;
      }
    } else {
      const { data, error } = await table.insert(payload).select("id").single();
      if (error) {
        toast({ title: "Erro ao salvar categoria", description: error.message, variant: "destructive" });
        return;
      }
      categoryId = data?.id ?? null;
    }

    if (categoryId) {
      const linkTable = supabase.from("service_category_products" as any) as any;
      await linkTable.delete().eq("category_id", categoryId);
      if (catLinkedProducts.length > 0) {
        await linkTable.insert(
          catLinkedProducts.map((pid) => ({
            tenant_id: tid,
            category_id: categoryId,
            produto_id: Number(pid),
          }))
        );
      }
    }

    toast({ title: editingCat ? "Categoria atualizada" : "Categoria criada" });
    setCatOpen(false);
    qc.invalidateQueries({ queryKey: ["cats_categorias"] });
    qc.invalidateQueries({ queryKey: ["cats_category_products"] });
  };

  const toggleCategoryActive = async (c: Category) => {
    if (!guardUpdate()) return;
    const { error } = await (supabase.from("service_categories" as any) as any)
      .update({ ativo: !c.ativo })
      .eq("id", c.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["cats_categorias"] });
  };

  const openNewSubcategory = (categoryId: string) => {
    if (!guardInsert()) return;
    setEditingSub(null);
    setSubParentCatId(categoryId);
    setSubNome("");
    setSubAtivo(true);
    setSubOpen(true);
  };

  const openEditSubcategory = (s: Subcategory) => {
    if (!guardUpdate()) return;
    setEditingSub(s);
    setSubParentCatId(s.category_id);
    setSubNome(s.nome);
    setSubAtivo(s.ativo);
    setSubOpen(true);
  };

  const saveSubcategory = async () => {
    if (!subNome.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    const payload: any = {
      nome: subNome.trim(),
      ativo: subAtivo,
      category_id: subParentCatId,
    };
    if (!editingSub && tid) payload.tenant_id = tid;

    const table = supabase.from("service_subcategories" as any) as any;
    const { error } = editingSub
      ? await table.update(payload).eq("id", editingSub.id)
      : await table.insert(payload);

    if (error) {
      toast({ title: "Erro ao salvar subcategoria", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingSub ? "Subcategoria atualizada" : "Subcategoria criada" });
    setSubOpen(false);
    qc.invalidateQueries({ queryKey: ["cats_subcategorias"] });
  };

  const toggleSubcategoryActive = async (s: Subcategory) => {
    if (!guardUpdate()) return;
    const { error } = await (supabase.from("service_subcategories" as any) as any)
      .update({ ativo: !s.ativo })
      .eq("id", s.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["cats_subcategorias"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          Categorias e subcategorias de serviço
        </h3>
        <Button size="sm" onClick={openNewCategory}>
          <Plus className="h-4 w-4" /> Nova categoria
        </Button>
      </div>

      <div className="space-y-2">
        {categorias.length === 0 && (
          <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
            Nenhuma categoria cadastrada.
          </div>
        )}

        {categorias.map((c) => {
          const isOpen = expanded.has(c.id);
          const subs = subsByCategory.get(c.id) ?? [];
          return (
            <div key={c.id} className="border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 p-3 hover:bg-muted/30 transition-colors">
                <button
                  onClick={() => toggleExpand(c.id)}
                  className="p-1 hover:bg-muted rounded shrink-0"
                  aria-label={isOpen ? "Recolher" : "Expandir"}
                >
                  <ChevronRight
                    className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")}
                  />
                </button>
                <span className="font-medium truncate min-w-0 flex-1">{c.nome}</span>
                {c.linkedProductNames.length === 0 ? (
                  <Badge variant="secondary" className="shrink-0">Universal</Badge>
                ) : c.linkedProductNames.length <= 2 ? (
                  c.linkedProductNames.map((n) => (
                    <Badge key={n} variant="default" className="shrink-0">{n}</Badge>
                  ))
                ) : (
                  <Badge variant="default" className="shrink-0">
                    {c.linkedProductNames.length} produtos
                  </Badge>
                )}
                <Badge variant={c.ativo ? "default" : "secondary"} className="shrink-0">
                  {c.ativo ? "Ativo" : "Inativo"}
                </Badge>
                <Badge variant="outline" className="shrink-0">
                  {subs.length} sub{subs.length === 1 ? "" : "s"}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => openEditCategory(c)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Switch checked={c.ativo} onCheckedChange={() => toggleCategoryActive(c)} />
              </div>

              {isOpen && (
                <div className="border-t bg-muted/10 pl-10 pr-3 py-2 space-y-1">
                  {subs.length === 0 && (
                    <div className="text-xs text-muted-foreground py-2">
                      Nenhuma subcategoria.
                    </div>
                  )}
                  {subs.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 py-2 px-2 rounded hover:bg-muted/40"
                    >
                      <span className="text-sm truncate min-w-0 flex-1">{s.nome}</span>
                      <Badge
                        variant={s.ativo ? "default" : "secondary"}
                        className="shrink-0 text-[10px]"
                      >
                        {s.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => openEditSubcategory(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Switch
                        checked={s.ativo}
                        onCheckedChange={() => toggleSubcategoryActive(s)}
                      />
                    </div>
                  ))}
                  <div className="pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openNewSubcategory(c.id)}
                    >
                      <Plus className="h-3.5 w-3.5" /> Subcategoria
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Category dialog */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCat ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={catNome}
                onChange={(e) => setCatNome(e.target.value)}
                placeholder="Nome da categoria"
              />
            </div>
            <div className="space-y-2">
              <Label>Produtos vinculados (opcional)</Label>
              <p className="text-xs text-muted-foreground">
                Sem vínculo = visível para todos os produtos
              </p>
              <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                {produtos.length === 0 && (
                  <div className="text-xs text-muted-foreground p-2">
                    Nenhum produto cadastrado.
                  </div>
                )}
                {produtos.map((p) => {
                  const pid = String(p.id);
                  const checked = catLinkedProducts.includes(pid);
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40 cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setCatLinkedProducts((prev) =>
                            v ? [...prev, pid] : prev.filter((x) => x !== pid)
                          );
                        }}
                      />
                      <span className="text-sm">{p.nome}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>Ativo</Label>
              <Switch checked={catAtivo} onCheckedChange={setCatAtivo} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveCategory}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Subcategory dialog */}
      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSub ? "Editar subcategoria" : "Nova subcategoria"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={subNome}
                onChange={(e) => setSubNome(e.target.value)}
                placeholder="Nome da subcategoria"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Ativo</Label>
              <Switch checked={subAtivo} onCheckedChange={setSubAtivo} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveSubcategory}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
