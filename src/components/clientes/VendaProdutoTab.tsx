import { UseFormReturn } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClienteFormValues } from "@/pages/ClienteForm";

interface Props {
  form: UseFormReturn<ClienteFormValues>;
  funcionarios: { id: number; nome: string }[];
  produtos: { id: number; nome: string }[];
}

const RECORRENCIA_OPTIONS = [
  { value: "mensal", label: "Mensal" },
  { value: "anual", label: "Anual" },
  { value: "semestral", label: "Semestral" },
  { value: "semanal", label: "Semanal" },
];

export default function VendaProdutoTab({ form, funcionarios, produtos }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField control={form.control} name="data_venda" render={({ field }) => (
        <FormItem>
          <FormLabel>Data da Venda</FormLabel>
          <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />

      <FormField control={form.control} name="funcionario_id" render={({ field }) => (
        <FormItem>
          <FormLabel>Funcionário</FormLabel>
          <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
            <SelectContent>
              {funcionarios.map((f) => (
                <SelectItem key={f.id} value={f.id.toString()}>{f.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />

      <FormField control={form.control} name="origem_venda" render={({ field }) => (
        <FormItem>
          <FormLabel>Origem da Venda</FormLabel>
          <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />

      <FormField control={form.control} name="recorrencia" render={({ field }) => (
        <FormItem>
          <FormLabel>Recorrência</FormLabel>
          <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v || null)}>
            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
            <SelectContent>
              {RECORRENCIA_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />

      <FormField control={form.control} name="produto_id" render={({ field }) => (
        <FormItem>
          <FormLabel>Produto</FormLabel>
          <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
            <SelectContent>
              {produtos.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()}>{p.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />

      <div className="md:col-span-2">
        <FormField control={form.control} name="observacao_negociacao" render={({ field }) => (
          <FormItem>
            <FormLabel>Observação da Negociação</FormLabel>
            <FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>
    </div>
  );
}
