import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLookups } from "@/hooks/useLookups";
import { getNavIds } from "@/hooks/useClientesFilters";
import { Form, FormField, FormControl } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Loader2, Building2, FileText, XCircle, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { MovimentosMrrModal } from "@/components/clientes/MovimentosMrrModal";
import DadosClienteTab from "@/components/clientes/DadosClienteTab";
import VendaProdutoTab from "@/components/clientes/VendaProdutoTab";
import FinanceiroTab from "@/components/clientes/FinanceiroTab";
import CancelamentoTab from "@/components/clientes/CancelamentoTab";
import CertificadoA1Section from "@/components/clientes/CertificadoA1Section";
import { ClienteTicketsSection } from "@/components/cs/ClienteTicketsSection";
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
  modelo_contrato_id: z.number().nullable(),
  observacao_cliente: z.string().nullable(),
  data_venda: z.string().nullable(),
  funcionario_id: z.number().nullable(),
  origem_venda_id: z.number().nullable(),
  recorrencia: z.enum(["mensal", "anual", "semestral", "semanal"]).nullable(),
  produto_id: z.number().nullable(),
  observacao_negociacao: z.string().nullable(),
  data_ativacao: z.string().nullable(),
  fornecedor_id: z.number().nullable(),
  codigo_fornecedor: z.string().nullable(),
  link_portal_fornecedor: z.string().nullable(),
  valor_ativacao: z.number().min(0, "Deve ser >= 0").nullable(),
  forma_pagamento_ativacao_id: z.number().nullable(),
  mensalidade: z.number().min(0, "Deve ser >= 0").nullable(),
  forma_pagamento_mensalidade_id: z.number().nullable(),
  custo_operacao: z.number().min(0, "Deve ser >= 0").nullable(),
  imposto_percentual: z.number().min(0).max(100).nullable(),
  custo_fixo_percentual: z.number().min(0).max(100).nullable(),
  cancelado: z.boolean(),
  data_cancelamento: z.string().nullable(),
  motivo_cancelamento_id: z.number().nullable(),
  observacao_cancelamento: z.string().nullable(),
  cert_a1_vencimento: z.string().nullable(),
  cert_a1_ultima_venda_em: z.string().nullable(),
  cert_a1_ultimo_vendedor_id: z.number().nullable(),
  contato_nome: z.string().nullable(),
  contato_cpf: z.string().nullable(),
  contato_fone: z.string().nullable(),
  contato_aniversario: z.string().nullable(),
  unidade_base_id: z.number().nullable(),
  matriz_id: z.string().nullable(),
  cep: z.string().nullable(),
  endereco: z.string().nullable(),
  numero: z.string().nullable(),
  bairro: z.string().nullable(),
});

export type ClienteFormValues = z.infer<typeof clienteSchema>;

export default function ClienteForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!id;
  const [mrrModalOpen, setMrrModalOpen] = useState(false);

  // Navigation between records
  const navInfo = useMemo(() => {
    if (!id) return null;
    const ids = getNavIds();
    if (!ids.length) return null;
    const idx = ids.indexOf(id);
    if (idx === -1) return null;
    return {
      currentIndex: idx,
      total: ids.length,
      prevId: idx > 0 ? ids[idx - 1] : null,
      nextId: idx < ids.length - 1 ? ids[idx + 1] : null,
    };
  }, [id]);

  const form = useForm<ClienteFormValues>({
    resolver: zodResolver(clienteSchema),
    defaultValues: {
      data_cadastro: new Date().toISOString().split("T")[0],
      razao_social: null, nome_fantasia: null, cnpj: null, email: null,
      telefone_contato: null, telefone_whatsapp: null, estado_id: null, cidade_id: null,
      area_atuacao_id: null, segmento_id: null, modelo_contrato_id: null, observacao_cliente: null,
      data_venda: null, funcionario_id: null, origem_venda_id: null, recorrencia: null,
      produto_id: null, observacao_negociacao: null,
      data_ativacao: null, fornecedor_id: null, codigo_fornecedor: null, link_portal_fornecedor: null,
      valor_ativacao: null,
      forma_pagamento_ativacao_id: null, mensalidade: null, forma_pagamento_mensalidade_id: null,
      custo_operacao: null, imposto_percentual: null, custo_fixo_percentual: null,
      cancelado: false, data_cancelamento: null, motivo_cancelamento_id: null, observacao_cancelamento: null,
      cert_a1_vencimento: null, cert_a1_ultima_venda_em: null, cert_a1_ultimo_vendedor_id: null,
      contato_nome: null, contato_cpf: null, contato_fone: null, contato_aniversario: null,
      unidade_base_id: null,
      matriz_id: null,
      cep: null, endereco: null, numero: null, bairro: null,
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
        form.setValue("imposto_percentual", Number(cfg.imposto_percentual) * 100);
      }
      if (form.getValues("custo_fixo_percentual") === null) {
        form.setValue("custo_fixo_percentual", Number(cfg.custo_fixo_percentual) * 100);
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
        area_atuacao_id: c.area_atuacao_id, segmento_id: c.segmento_id, modelo_contrato_id: (c as any).modelo_contrato_id,
        observacao_cliente: c.observacao_cliente, data_venda: c.data_venda,
        funcionario_id: c.funcionario_id, origem_venda_id: (c as any).origem_venda_id ?? null,
        recorrencia: c.recorrencia, produto_id: c.produto_id,
        observacao_negociacao: c.observacao_negociacao,
        data_ativacao: (c as any).data_ativacao ?? null,
        fornecedor_id: (c as any).fornecedor_id ?? null,
        codigo_fornecedor: (c as any).codigo_fornecedor ?? null,
        link_portal_fornecedor: (c as any).link_portal_fornecedor ?? null,
        valor_ativacao: c.valor_ativacao ? Number(c.valor_ativacao) : null,
        forma_pagamento_ativacao_id: c.forma_pagamento_ativacao_id,
        mensalidade: c.mensalidade ? Number(c.mensalidade) : null,
        forma_pagamento_mensalidade_id: c.forma_pagamento_mensalidade_id,
        custo_operacao: c.custo_operacao ? Number(c.custo_operacao) : null,
        imposto_percentual: c.imposto_percentual ? Number(c.imposto_percentual) * 100 : null,
        custo_fixo_percentual: c.custo_fixo_percentual ? Number(c.custo_fixo_percentual) * 100 : null,
        cancelado: c.cancelado, data_cancelamento: c.data_cancelamento,
        motivo_cancelamento_id: c.motivo_cancelamento_id,
        observacao_cancelamento: c.observacao_cancelamento,
        cert_a1_vencimento: (c as any).cert_a1_vencimento ?? null,
        cert_a1_ultima_venda_em: (c as any).cert_a1_ultima_venda_em ?? null,
        cert_a1_ultimo_vendedor_id: (c as any).cert_a1_ultimo_vendedor_id ?? null,
        contato_nome: (c as any).contato_nome ?? null,
        contato_cpf: (c as any).contato_cpf ?? null,
        contato_fone: (c as any).contato_fone ?? null,
        contato_aniversario: (c as any).contato_aniversario ?? null,
        unidade_base_id: (c as any).unidade_base_id ?? null,
        matriz_id: (c as any).matriz_id ?? null,
        cep: (c as any).cep ?? null,
        endereco: (c as any).endereco ?? null,
        numero: (c as any).numero ?? null,
        bairro: (c as any).bairro ?? null,
      });
    }
  }, [clienteQuery.data]);

  const mutation = useMutation({
    mutationFn: async (values: ClienteFormValues) => {
      const payload: any = {
        ...values,
        email: values.email || null,
        imposto_percentual: values.imposto_percentual != null ? values.imposto_percentual / 100 : null,
        custo_fixo_percentual: values.custo_fixo_percentual != null ? values.custo_fixo_percentual / 100 : null,
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
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{isEditing ? "Editar Cliente" : "Novo Cliente"}</h1>
            <p className="text-sm text-muted-foreground">Preencha os dados do cliente e contrato</p>
          </div>

          {/* Prev/Next navigation */}
          {isEditing && navInfo && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                disabled={!navInfo.prevId}
                onClick={() => navInfo.prevId && navigate(`/clientes/${navInfo.prevId}`)}
                title="Cliente anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-2 whitespace-nowrap">
                {navInfo.currentIndex + 1} / {navInfo.total}
              </span>
              <Button
                variant="outline"
                size="icon"
                disabled={!navInfo.nextId}
                onClick={() => navInfo.nextId && navigate(`/clientes/${navInfo.nextId}`)}
                title="Próximo cliente"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
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
                unidadesBase={lookups.unidadesBase.data ?? []}
                clienteId={id}
                codigoSequencial={(clienteQuery.data as any)?.codigo_sequencial ?? null}
              />
            </CardContent>
          </Card>

          {/* Card: Produto / Contrato */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-primary" />
                Produto / Contrato
              </CardTitle>
              {isEditing && (
                <Button type="button" variant="outline" size="sm" onClick={() => setMrrModalOpen(true)}>
                  <ArrowUpDown className="h-4 w-4 mr-2" />
                  Movimentos MRR
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <VendaProdutoTab
                form={form}
                funcionarios={lookups.funcionarios.data ?? []}
                produtos={lookups.produtos.data ?? []}
                fornecedores={lookups.fornecedores?.data ?? []}
                origensVenda={lookups.origensVenda?.data ?? []}
                modelosContrato={lookups.modelosContrato.data ?? []}
              />
              <FinanceiroTab
                form={form}
                formasPagamento={lookups.formasPagamento.data ?? []}
                clienteId={id}
              />
            </CardContent>
          </Card>

          {/* Card: Certificado A1 */}
          <CertificadoA1Section
            clienteId={id}
            vencimento={form.watch("cert_a1_vencimento") ?? null}
            ultimaVendaEm={form.watch("cert_a1_ultima_venda_em") ?? null}
            ultimoVendedorId={form.watch("cert_a1_ultimo_vendedor_id") ?? null}
            onVencimentoChange={(v) => form.setValue("cert_a1_vencimento", v)}
            onVendaRegistrada={async () => {
              if (!id) return;
              const { data } = await supabase.from("clientes").select("cert_a1_vencimento, cert_a1_ultima_venda_em, cert_a1_ultimo_vendedor_id").eq("id", id).single();
              if (data) {
                form.setValue("cert_a1_vencimento", (data as any).cert_a1_vencimento ?? null);
                form.setValue("cert_a1_ultima_venda_em", (data as any).cert_a1_ultima_venda_em ?? null);
                form.setValue("cert_a1_ultimo_vendedor_id", (data as any).cert_a1_ultimo_vendedor_id ?? null);
              }
            }}
            funcionarios={lookups.funcionarios.data ?? []}
          />

          {/* Tickets CS (apenas em edição) */}
          {isEditing && id && (
            <ClienteTicketsSection
              clienteId={id}
              clienteNome={form.watch("razao_social") || form.watch("nome_fantasia") || ""}
            />
          )}

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

      {isEditing && id && (
        <MovimentosMrrModal
          open={mrrModalOpen}
          onOpenChange={setMrrModalOpen}
          clienteId={id}
          clienteNome={form.watch("razao_social") || form.watch("nome_fantasia") || ""}
          mensalidadeBase={form.watch("mensalidade") ?? 0}
          custoBase={form.watch("custo_operacao") ?? 0}
          funcionarios={(lookups.funcionarios.data ?? []).map((f: any) => ({ id: f.id, nome: f.nome }))}
        />
      )}
    </div>
  );
}
