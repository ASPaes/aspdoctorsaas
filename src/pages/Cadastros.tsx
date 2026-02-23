import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import CrudTable, { type ColumnDef } from "@/components/CrudTable";

export default function Cadastros() {
  const [syncing, setSyncing] = useState(false);

  const { data: fornecedores } = useQuery({
    queryKey: ["fornecedores_lookup"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fornecedores").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

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

  const fornecedorOptions = (fornecedores ?? []).map((f) => ({ value: f.id, label: f.nome }));

  const tabs: { value: string; label: string; table: string; queryKey: string; columns: ColumnDef[]; orderBy?: string; selectQuery?: string }[] = [
    {
      value: "funcionarios", label: "Funcionários", table: "funcionarios", queryKey: "crud_funcionarios", orderBy: "nome",
      columns: [
        { key: "nome", label: "Nome" },
        { key: "cargo", label: "Cargo" },
        { key: "email", label: "Email" },
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
      selectQuery: "*, fornecedores(nome)",
      columns: [
        { key: "nome", label: "Nome" },
        { key: "codigo_fornecedor", label: "Cód. Fornecedor" },
        { key: "link_portal", label: "Link Portal" },
        {
          key: "fornecedor_id", label: "Fornecedor", type: "select",
          options: fornecedorOptions,
          render: (_val: any, row: any) => row.fornecedores?.nome ?? "—",
        },
      ],
    },
    {
      value: "segmentos", label: "Segmentos", table: "segmentos", queryKey: "crud_segmentos", orderBy: "nome",
      columns: [{ key: "nome", label: "Nome" }],
    },
    {
      value: "verticais", label: "Verticais", table: "verticais", queryKey: "crud_verticais", orderBy: "nome",
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
      value: "formas_pagamento", label: "Formas Pgto", table: "formas_pagamento", queryKey: "crud_formas_pgto", orderBy: "nome",
      columns: [{ key: "nome", label: "Nome" }],
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cadastros</h1>
          <p className="mt-1 text-muted-foreground">Gerencie tabelas auxiliares.</p>
        </div>
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
