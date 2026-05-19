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
import { Building2, Star, Filter, Plus } from "lucide-react";

export default function UnidadesBaseConfig() {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const [newName, setNewName] = useState("");

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
                {!u.is_principal && u.is_active && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPrincipal.mutate(u.id)}>
                    Definir principal
                  </Button>
                )}
                {!u.is_default_filter && u.is_active && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDefaultFilter.mutate(u.id)}>
                    Definir filtro padrão
                  </Button>
                )}
                {u.is_default_filter && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDefaultFilter.mutate(null)}>
                    Remover filtro padrão
                  </Button>
                )}
                <Switch
                  checked={!!u.is_active}
                  onCheckedChange={(v) => toggleActive.mutate({ id: u.id, active: v })}
                />
              </div>
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
              if (e.key === "Enter" && newName.trim()) addUnidade.mutate(newName.trim());
            }}
          />
          <Button
            size="sm"
            disabled={!newName.trim() || addUnidade.isPending}
            onClick={() => addUnidade.mutate(newName.trim())}
          >
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
