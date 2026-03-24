import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import CrudTable, { type ColumnDef } from "@/components/CrudTable";

function useDepartmentOptions() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { data } = useQuery({
    queryKey: ["departments_for_crud", tid],
    queryFn: async () => {
      let q = supabase.from("support_departments").select("id, name").eq("is_active", true).order("name");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((d: any) => ({ value: d.id, label: d.name }));
    },
  });
  return data ?? [];
}

export default function CadastrosTab() {
  const [syncing, setSyncing] = useState(false);
  const { effectiveTenantId: tid } = useTenantFilter();
  const departmentOptions = useDepartmentOptions();

  // Validate department belongs to the effective tenant before saving funcionario
  const validateFuncionario = async (payload: Record<string, any>, _isEdit: boolean): Promise<string | void> => {
    const deptId = payload.department_id;
    if (!deptId || !tid) return;

    const { data, error } = await supabase
      .from("support_departments")
      .select("id")
      .eq("id", deptId)
      .eq("tenant_id", tid)
      .maybeSingle();

    if (error || !data) {
      return "Setor inválido para este tenant. Verifique o tenant selecionado no topo ou escolha outro setor.";
    }
  };

  const tabs: { value: string; label: string; table: string; queryKey: string; columns: ColumnDef[]; orderBy?: string; selectQuery?: string; onBeforeSave?: (payload: Record<string, any>, isEdit: boolean) => Promise<string | void> }[] = [
    {
      value: "funcionarios", label: "Funcionários", table: "funcionarios", queryKey: "crud_funcionarios", orderBy: "nome",
      selectQuery: "*, support_departments:department_id(name)",
      onBeforeSave: validateFuncionario,
      columns: [
        { key: "nome", label: "Nome" },
        { key: "cargo", label: "Cargo" },
        { key: "email", label: "Email" },
        { key: "department_id", label: "Setor", type: "select", valueType: "string", options: departmentOptions, render: (_val, row) => row.support_departments?.name ?? "—" },
        { key: "ativo", label: "Ativo", type: "boolean" },
      ],
    },
    {
      value: "fornecedores", label: "Fornecedores", table: "fornecedores", queryKey: "crud_fornecedores", orderBy: "nome",
      columns: [
        { key: "nome", label: "Nome" },
        { key: "site", label: "Site" },
      ],
    },
    {
      value: "produtos", label: "Produtos", table: "produtos", queryKey: "crud_produtos", orderBy: "nome",
      columns: [{ key: "nome", label: "Nome" }],
    },
    {
      value: "segmentos", label: "Segmentos", table: "segmentos", queryKey: "crud_segmentos", orderBy: "nome",
      columns: [{ key: "nome", label: "Nome" }],
    },
    {
      value: "modelos_contrato", label: "Modelos de Contrato", table: "modelos_contrato", queryKey: "crud_modelos_contrato", orderBy: "nome",
      columns: [{ key: "nome", label: "Nome" }],
    },
    {
      value: "areas_atuacao", label: "Áreas de Atuação", table: "areas_atuacao", queryKey: "crud_areas_atuacao", orderBy: "nome",
      columns: [{ key: "nome", label: "Nome" }],
    },
    {
      value: "motivos_cancelamento", label: "Motivos Cancel.", table: "motivos_cancelamento", queryKey: "crud_motivos", orderBy: "descricao",
      columns: [{ key: "descricao", label: "Descrição" }],
    },
    {
      value: "origens_venda", label: "Origens Venda", table: "origens_venda", queryKey: "crud_origens_venda", orderBy: "nome",
      columns: [{ key: "nome", label: "Nome" }],
    },
    {
      value: "formas_pagamento", label: "Formas Pgto", table: "formas_pagamento", queryKey: "crud_formas_pgto", orderBy: "nome",
      columns: [{ key: "nome", label: "Nome" }],
    },
    {
      value: "unidades_base", label: "Unidades Base", table: "unidades_base", queryKey: "crud_unidades_base", orderBy: "nome",
      columns: [{ key: "nome", label: "Nome" }],
    },
  ];



  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("populate-cidades", { method: "POST" });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Erro desconhecido");
      toast({ title: "Sincronização concluída", description: `${data.estados} estados e ${data.cidades} cidades sincronizados.` });
    } catch (err: any) {
      toast({ title: "Erro na sincronização", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm">
          <RefreshCw className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sincronizando..." : "Sincronizar Estados/Cidades"}
        </Button>
      </div>

      <Tabs defaultValue="funcionarios">
        <TabsList className="flex-wrap h-auto gap-1">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            <CrudTable
              table={t.table}
              queryKey={t.queryKey}
              columns={t.columns}
              orderBy={t.orderBy}
              selectQuery={t.selectQuery}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
