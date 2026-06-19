import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Building2, Star, Filter, Plus, Pencil, Check, X } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

export default function UnidadesBaseConfig() {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const { can } = usePermissions();
  const DENY_MSG = "Você não tem acesso a esta ação. Entre em contato com o administrador.";
  const guardInsert = () => { if (!can("cfg.unidades_base", "insert")) { toast.error(DENY_MSG); return false; } return true; };
  const guardUpdate = () => { if (!can("cfg.unidades_base", "update")) { toast.error(DENY_MSG); return false; } return true; };

  const { data: unidades = [], isLoading } = useQuery({
    queryKey: ["unidades_base_config", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("unidades_base" as any) as any)
        .select("id, nome, is_principal, is_default_filter, is_active")
        .eq("tenant_id", tid)
        .order("nome");
      if (error) throw error;
      return data as any[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["unidades_base"] });
    queryClient.invalidateQueries({ queryKey: ["unidades_base_config"] });
  };

  const setPrincipal = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await (supabase.rpc as any)("set_unidade_principal", { p_unidade_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Unidade principal definida"); },
    onError: (e: any) => toast.error(e.message),
  });

  const setDefaultFilter = useMutation({
    mutationFn: async (id: number | null) => {
      if (id) {
        const { error } = await (supabase.rpc as any)("set_unidade_default_filter", { p_unidade_id: id });
        if (error) throw error;
      } else {
        const { error } = await (supabase.rpc as any)("clear_unidade_default_filter", { p_tenant_id: tid });
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); toast.success("Filtro padrão atualizado"); },
    onError: (e: any) => toast.error(e.message),
  });

  const addUnidade = useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await (supabase.from("unidades_base" as any) as any)
        .insert({ nome, tenant_id: tid });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setNewName(""); toast.success("Unidade criada"); },
    onError: (e: any) => toast.error(e.message),
  });

  const renameUnidade = useMutation({
    mutationFn: async ({ id, nome }: { id: number; nome: string }) => {
      const { error } = await (supabase.from("unidades_base" as any) as any)
        .update({ nome })
        .eq("id", id)
        .eq("tenant_id", tid);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setEditingId(null); setEditingName(""); toast.success("Unidade renomeada"); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const { error } = await (supabase.from("unidades_base" as any) as any)
        .update({ is_active: active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (u: any) => { if (!guardUpdate()) return; setEditingId(u.id); setEditingName(u.nome); };
  const saveEdit = () => { const n = editingName.trim(); if (!n || editingId == null) return; if (guardUpdate()) renameUnidade.mutate({ id: editingId, nome: n }); };
  const cancelEdit = () => { setEditingId(null); setEditingName(""); };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Unidades Base
        </CardTitle>
        <CardDescription>
          Configure as unidades da sua empresa. Defina qual é a principal e qual será o filtro padrão em todas as telas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {isLoading && <p className="text-xs text-muted-foreground">Carregando...</p>}
          {!isLoading && unidades.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma unidade cadastrada.</p>
          )}
          {unidades.map((u: any) => (
            <div
              key={u.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
            >
              {editingId === u.id ? (
                <>
                  <Input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="h-8 text-sm flex-1 min-w-0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-8 px-2" disabled={!editingName.trim() || renameUnidade.isPending} onClick={saveEdit}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={cancelEdit}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-medium truncate">{u.nome}</span>
                    {u.is_principal && (
                      <Badge variant="secondary" className="gap-1">
                        <Star className="h-3 w-3" /> Principal
                      </Badge>
                    )}
                    {u.is_default_filter && (
                      <Badge className="gap-1 bg-primary/10 text-primary border-primary/30" variant="outline">
                        <Filter className="h-3 w-3" /> Filtro padrão
                      </Badge>
                    )}
                    {!u.is_active && <Badge variant="outline">Inativa</Badge>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => startEdit(u)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!u.is_principal && u.is_active && (
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { if (guardUpdate()) setPrincipal.mutate(u.id); }}>
                        Definir principal
                      </Button>
                    )}
                    {!u.is_default_filter && u.is_active && (
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { if (guardUpdate()) setDefaultFilter.mutate(u.id); }}>
                        Definir filtro padrão
                      </Button>
                    )}
                    {u.is_default_filter && (
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { if (guardUpdate()) setDefaultFilter.mutate(null); }}>
                        Remover filtro padrão
                      </Button>
                    )}
                    <Switch
                      checked={!!u.is_active}
                      onCheckedChange={(v) => { if (guardUpdate()) toggleActive.mutate({ id: u.id, active: v }); }}
                    />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome da nova unidade"
            className="h-9 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim() && guardInsert()) addUnidade.mutate(newName.trim());
            }}
          />
          <Button
            size="sm"
            disabled={!newName.trim() || addUnidade.isPending}
            onClick={() => { if (guardInsert()) addUnidade.mutate(newName.trim()); }}
          >
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
