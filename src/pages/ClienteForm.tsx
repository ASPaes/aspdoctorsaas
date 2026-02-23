import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLookups } from "@/hooks/useLookups";
import { Form, FormField, FormControl } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Loader2, Building2, FileText, XCircle } from "lucide-react";
import DadosClienteTab from "@/components/clientes/DadosClienteTab";
import VendaProdutoTab from "@/components/clientes/VendaProdutoTab";
import FinanceiroTab from "@/components/clientes/FinanceiroTab";
import CancelamentoTab from "@/components/clientes/CancelamentoTab";
import type { Database } from "@/integrations/supabase/types";

const clienteSchema = z.object({
  data_cadastro: z.string().nullable(),
  razao_social: z.string().nullable(),
  nome_fantasia: z.string().nullable(),
  cnpj: z.string().nullable(),
  email: z.string().email("Email inválido").nullable().or(z.literal("")),
  telefone_contato: z.string().nullable(),
  telefone_whatsapp: z.string().nullable(),
  estado_id: z.number().nullable(),
  cidade_id: z.number().nullable(),
  area_atuacao_id: z.number().nullable(),
  segmento_id: z.number().nullable(),
  vertical_id: z.number().nullable(),
  observacao_cliente: z.string().nullable(),
  data_venda: z.string().nullable(),
  funcionario_id: z.number().nullable(),
  origem_venda: z.string().nullable(),
  recorrencia: z.enum(["mensal", "anual", "semestral", "semanal"]).nullable(),
  produto_id: z.number().nullable(),
  observacao_negociacao: z.string().nullable(),
  valor_ativacao: z.number().min(0, "Deve ser >= 0").nullable(),
  forma_pagamento_ativacao_id: z.number().nullable(),
  mensalidade: z.number().min(0, "Deve ser >= 0").nullable(),
  forma_pagamento_mensalidade_id: z.number().nullable(),
  custo_operacao: z.number().min(0, "Deve ser >= 0").nullable(),
  imposto_percentual: z.number().min(0).max(1).nullable(),
  custo_fixo_percentual: z.number().min(0).max(1).nullable(),
  cancelado: z.boolean(),
  data_cancelamento: z.string().nullable(),
  motivo_cancelamento_id: z.number().nullable(),
  observacao_cancelamento: z.string().nullable(),
});

export type ClienteFormValues = z.infer<typeof clienteSchema>;

export default function ClienteForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!id;

  const form = useForm<ClienteFormValues>({
    resolver: zodResolver(clienteSchema),
    defaultValues: {
      data_cadastro: new Date().toISOString().split("T")[0],
      razao_social: null, nome_fantasia: null, cnpj: null, email: null,
      telefone_contato: null, telefone_whatsapp: null, estado_id: null, cidade_id: null,
      area_atuacao_id: null, segmento_id: null, vertical_id: null, observacao_cliente: null,
      data_venda: null, funcionario_id: null, origem_venda: null, recorrencia: null,
      produto_id: null, observacao_negociacao: null, valor_ativacao: null,
      forma_pagamento_ativacao_id: null, mensalidade: null, forma_pagamento_mensalidade_id: null,
      custo_operacao: null, imposto_percentual: null, custo_fixo_percentual: null,
      cancelado: false, data_cancelamento: null, motivo_cancelamento_id: null, observacao_cancelamento: null,
    },
  });

  const estadoId = form.watch("estado_id");
  const cancelado = form.watch("cancelado");
  const lookups = useLookups(estadoId);

  // Load config defaults for new clients
  useEffect(() => {
    if (!isEditing && lookups.configuracoes.data) {
      const cfg = lookups.configuracoes.data;
      if (form.getValues("imposto_percentual") === null) {
        form.setValue("imposto_percentual", cfg.imposto_percentual);
      }
      if (form.getValues("custo_fixo_percentual") === null) {
        form.setValue("custo_fixo_percentual", cfg.custo_fixo_percentual);
      }
    }
  }, [isEditing, lookups.configuracoes.data]);

  // Load existing client for editing
  const clienteQuery = useQuery({
    queryKey: ["cliente", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: isEditing,
  });

  useEffect(() => {
    if (clienteQuery.data) {
      const c = clienteQuery.data;
      form.reset({
        data_cadastro: c.data_cadastro, razao_social: c.razao_social, nome_fantasia: c.nome_fantasia,
        cnpj: c.cnpj, email: c.email, telefone_contato: c.telefone_contato,
        telefone_whatsapp: c.telefone_whatsapp, estado_id: c.estado_id, cidade_id: c.cidade_id,
        area_atuacao_id: c.area_atuacao_id, segmento_id: c.segmento_id, vertical_id: c.vertical_id,
        observacao_cliente: c.observacao_cliente, data_venda: c.data_venda,
        funcionario_id: c.funcionario_id, origem_venda: c.origem_venda,
        recorrencia: c.recorrencia, produto_id: c.produto_id,
        observacao_negociacao: c.observacao_negociacao, valor_ativacao: c.valor_ativacao ? Number(c.valor_ativacao) : null,
        forma_pagamento_ativacao_id: c.forma_pagamento_ativacao_id,
        mensalidade: c.mensalidade ? Number(c.mensalidade) : null,
        forma_pagamento_mensalidade_id: c.forma_pagamento_mensalidade_id,
        custo_operacao: c.custo_operacao ? Number(c.custo_operacao) : null,
        imposto_percentual: c.imposto_percentual ? Number(c.imposto_percentual) : null,
        custo_fixo_percentual: c.custo_fixo_percentual ? Number(c.custo_fixo_percentual) : null,
        cancelado: c.cancelado, data_cancelamento: c.data_cancelamento,
        motivo_cancelamento_id: c.motivo_cancelamento_id,
        observacao_cancelamento: c.observacao_cancelamento,
      });
    }
  }, [clienteQuery.data]);

  const mutation = useMutation({
    mutationFn: async (values: ClienteFormValues) => {
      const payload = {
        ...values,
        email: values.email || null,
      };

      if (isEditing) {
        const { error } = await supabase.from("clientes").update(payload).eq("id", id!);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clientes").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
      toast({ title: isEditing ? "Cliente atualizado!" : "Cliente criado!", description: "Dados salvos com sucesso." });
      navigate("/clientes");
    },
    onError: (error) => {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (values: ClienteFormValues) => mutation.mutate(values);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/clientes")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{isEditing ? "Editar Cliente" : "Novo Cliente"}</h1>
            <p className="text-sm text-muted-foreground">Preencha os dados do cliente e contrato</p>
          </div>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Card: Dados Cadastrais */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5 text-primary" />
                Dados Cadastrais
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DadosClienteTab
                form={form}
                estados={lookups.estados.data ?? []}
                cidades={lookups.cidades.data ?? []}
                areasAtuacao={lookups.areasAtuacao.data ?? []}
                segmentos={lookups.segmentos.data ?? []}
                verticais={lookups.verticais.data ?? []}
              />
            </CardContent>
          </Card>

          {/* Card: Produto / Contrato */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-primary" />
                Produto / Contrato
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <VendaProdutoTab
                form={form}
                funcionarios={lookups.funcionarios.data ?? []}
                produtos={lookups.produtos.data ?? []}
              />
              <FinanceiroTab
                form={form}
                formasPagamento={lookups.formasPagamento.data ?? []}
              />
            </CardContent>
          </Card>

          {/* Card: Cancelamento */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <XCircle className="h-5 w-5 text-destructive" />
                  Cancelamento
                </CardTitle>
                <CardDescription>Ative para registrar o cancelamento do cliente</CardDescription>
              </div>
              <FormField control={form.control} name="cancelado" render={({ field }) => (
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              )} />
            </CardHeader>
            {cancelado && (
              <CardContent>
                <CancelamentoTab
                  form={form}
                  motivosCancelamento={lookups.motivosCancelamento.data ?? []}
                />
              </CardContent>
            )}
          </Card>

          {/* Botões de ação */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => navigate("/clientes")}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar Cliente
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
