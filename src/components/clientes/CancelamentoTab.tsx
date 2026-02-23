import { UseFormReturn } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClienteFormValues } from "@/pages/ClienteForm";

interface Props {
  form: UseFormReturn<ClienteFormValues>;
  motivosCancelamento: { id: number; descricao: string }[];
}

export default function CancelamentoTab({ form, motivosCancelamento }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField control={form.control} name="data_cancelamento" render={({ field }) => (
        <FormItem>
          <FormLabel>Data Cancelamento</FormLabel>
          <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />

      <FormField control={form.control} name="motivo_cancelamento_id" render={({ field }) => (
        <FormItem>
          <FormLabel>Motivo</FormLabel>
          <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
            <SelectContent>
              {motivosCancelamento.map((m) => (
                <SelectItem key={m.id} value={m.id.toString()}>{m.descricao}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />

      <div className="md:col-span-2">
        <FormField control={form.control} name="observacao_cancelamento" render={({ field }) => (
          <FormItem>
            <FormLabel>Observação Cancelamento</FormLabel>
            <FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>
    </div>
  );
}
