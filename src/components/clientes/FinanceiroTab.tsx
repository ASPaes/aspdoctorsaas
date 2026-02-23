import { UseFormReturn } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField control={form.control} name="valor_ativacao" render={({ field }) => (
          <FormItem>
            <FormLabel>Valor Ativação</FormLabel>
            <FormControl>
              <Input type="number" step="0.01" min="0" {...field}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
              />
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
              <Input type="number" step="0.01" min="0" {...field}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
              />
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
              <Input type="number" step="0.01" min="0" {...field}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="imposto_percentual" render={({ field }) => (
          <FormItem>
            <FormLabel>Imposto %</FormLabel>
            <FormControl>
              <Input type="number" step="0.001" min="0" max="1" {...field}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="custo_fixo_percentual" render={({ field }) => (
          <FormItem>
            <FormLabel>Custo Fixo %</FormLabel>
            <FormControl>
              <Input type="number" step="0.001" min="0" max="1" {...field}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      <EspelhoFinanceiro espelho={espelho} />
    </div>
  );
}
