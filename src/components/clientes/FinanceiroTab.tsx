import { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumericInput } from "@/components/ui/numeric-input";
import EspelhoFinanceiro from "./EspelhoFinanceiro";
import { useEspelhoFinanceiro } from "@/hooks/useEspelhoFinanceiro";
import type { ClienteFormValues } from "@/pages/ClienteForm";

interface Props {
  form: UseFormReturn<ClienteFormValues>;
  formasPagamento: { id: number; nome: string }[];
  clienteId?: string;
}

interface MovimentoMrr {
  tipo: string;
  valor_delta: number;
  custo_delta: number;
  valor_venda_avulsa: number | null;
  status: string;
  estorno_de: string | null;
  estornado_por: string | null;
}

function useMrrMovimentos(clienteId?: string) {
  return useQuery({
    queryKey: ["movimentos_mrr_totals", clienteId],
    queryFn: async () => {
      if (!clienteId) return null;
      const { data, error } = await supabase
        .from("movimentos_mrr")
        .select("tipo, valor_delta, custo_delta, valor_venda_avulsa, status, estorno_de, estornado_por")
        .eq("cliente_id", clienteId);
      if (error) throw error;
      return data as unknown as MovimentoMrr[];
    },
    enabled: !!clienteId,
  });
}

export default function FinanceiroTab({ form, formasPagamento, clienteId }: Props) {
  const mensalidade = form.watch("mensalidade");
  const custo_operacao = form.watch("custo_operacao");
  const imposto_percentual = form.watch("imposto_percentual");
  const custo_fixo_percentual = form.watch("custo_fixo_percentual");

  const { data: movimentos } = useMrrMovimentos(clienteId);

  // Calculate MRR deltas from active movements (excluding vendas avulsas and estornos)
  const movimentosAtivos = (movimentos ?? []).filter(
    (m) => m.status === "ativo" && !m.estornado_por && !m.estorno_de && m.tipo !== "venda_avulsa"
  );
  const somaDeltaMrr = movimentosAtivos.reduce((s, m) => s + m.valor_delta, 0);
  const somaDeltaCusto = movimentosAtivos.reduce((s, m) => s + (m.custo_delta || 0), 0);

  // Vendas avulsas totals (to sum into activation value)
  const vendasAvulsas = (movimentos ?? []).filter(
    (m) => m.status === "ativo" && m.tipo === "venda_avulsa"
  );
  const totalVendasAvulsas = vendasAvulsas.reduce((s, m) => s + (m.valor_venda_avulsa || 0), 0);

  // Movement breakdown for display
  const totalUpsell = movimentosAtivos.filter((m) => m.tipo === "upsell").reduce((s, m) => s + m.valor_delta, 0);
  const totalCrossSell = movimentosAtivos.filter((m) => m.tipo === "cross_sell").reduce((s, m) => s + m.valor_delta, 0);
  const totalDownsell = movimentosAtivos.filter((m) => m.tipo === "downsell").reduce((s, m) => s + Math.abs(m.valor_delta), 0);
  const qtdMovimentos = (movimentos ?? []).filter((m) => m.status === "ativo").length;

  const espelho = useEspelhoFinanceiro({
    mensalidade: mensalidade ?? null,
    custo_operacao: custo_operacao ?? null,
    imposto_percentual: imposto_percentual ?? null,
    custo_fixo_percentual: custo_fixo_percentual ?? null,
    deltaMrr: somaDeltaMrr,
    deltaCusto: somaDeltaCusto,
  });

  return (
    <div className="space-y-6">
      {/* SubCard: Valores */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Valores</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField control={form.control} name="valor_ativacao" render={({ field }) => (
            <FormItem>
              <FormLabel>Valor Ativação</FormLabel>
              <FormControl>
                <NumericInput value={field.value} onChange={field.onChange} placeholder="0,00" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="forma_pagamento_ativacao_id" render={({ field }) => (
            <FormItem>
              <FormLabel>Forma Pgto Ativação</FormLabel>
              <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
                <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                <SelectContent>
                  {formasPagamento.map((f) => (
                    <SelectItem key={f.id} value={f.id.toString()}>{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="mensalidade" render={({ field }) => (
            <FormItem>
              <FormLabel>Mensalidade / MRR</FormLabel>
              <FormControl>
                <NumericInput value={field.value} onChange={field.onChange} placeholder="0,00" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="forma_pagamento_mensalidade_id" render={({ field }) => (
            <FormItem>
              <FormLabel>Forma Pgto Mensalidade</FormLabel>
              <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
                <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                <SelectContent>
                  {formasPagamento.map((f) => (
                    <SelectItem key={f.id} value={f.id.toString()}>{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="custo_operacao" render={({ field }) => (
            <FormItem>
              <FormLabel>Custo Operação</FormLabel>
              <FormControl>
                <NumericInput value={field.value} onChange={field.onChange} placeholder="0,00" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="imposto_percentual" render={({ field }) => (
            <FormItem>
              <FormLabel>Imposto %</FormLabel>
              <FormControl>
                <NumericInput value={field.value} onChange={field.onChange} placeholder="0,00" decimals={2} suffix="%" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="custo_fixo_percentual" render={({ field }) => (
            <FormItem>
              <FormLabel>Custo Fixo %</FormLabel>
              <FormControl>
                <NumericInput value={field.value} onChange={field.onChange} placeholder="0,00" decimals={2} suffix="%" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
      </div>

      <EspelhoFinanceiro
        espelho={espelho}
        clienteId={clienteId}
        mensalidadeBase={mensalidade ?? 0}
        custoBase={custo_operacao ?? 0}
        totalUpsell={totalUpsell}
        totalCrossSell={totalCrossSell}
        totalDownsell={totalDownsell}
        totalVendasAvulsas={totalVendasAvulsas}
        somaDeltaMrr={somaDeltaMrr}
        qtdMovimentos={qtdMovimentos}
      />
    </div>
  );
}
