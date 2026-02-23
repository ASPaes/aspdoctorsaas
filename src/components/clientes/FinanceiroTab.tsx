import { UseFormReturn } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumericInput } from "@/components/ui/numeric-input";
import EspelhoFinanceiro from "./EspelhoFinanceiro";
import { useEspelhoFinanceiro } from "@/hooks/useEspelhoFinanceiro";
import type { ClienteFormValues } from "@/pages/ClienteForm";

interface Props {
  form: UseFormReturn<ClienteFormValues>;
  formasPagamento: { id: number; nome: string }[];
}

export default function FinanceiroTab({ form, formasPagamento }: Props) {
  const mensalidade = form.watch("mensalidade");
  const custo_operacao = form.watch("custo_operacao");
  const imposto_percentual = form.watch("imposto_percentual");
  const custo_fixo_percentual = form.watch("custo_fixo_percentual");

  const espelho = useEspelhoFinanceiro({
    mensalidade: mensalidade ?? null,
    custo_operacao: custo_operacao ?? null,
    imposto_percentual: imposto_percentual ?? null,
    custo_fixo_percentual: custo_fixo_percentual ?? null,
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

      <EspelhoFinanceiro espelho={espelho} />
    </div>
  );
}
