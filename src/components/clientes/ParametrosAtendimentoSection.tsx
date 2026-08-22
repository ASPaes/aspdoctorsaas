import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Headset } from "lucide-react";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOperadoresAtendimento } from "@/hooks/useOperadoresAtendimento";
import type { ClienteFormValues } from "@/pages/ClienteForm";

const SEM_OPERADOR = "__none__";

interface Props {
  form: UseFormReturn<ClienteFormValues>;
}

export default function ParametrosAtendimentoSection({ form }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { data: operadores = [], isLoading } = useOperadoresAtendimento(tid);
  const [aberto, setAberto] = useState(false);

  // O nome vai no botão de propósito: fechado, o card esconderia justamente a
  // informação que muda o roteamento do cliente.
  const operadorId = form.watch("operador_responsavel_id");
  const operadorNome = operadores.find((o) => o.user_id === operadorId)?.nome ?? null;

  if (!aberto) {
    return (
      <div className="flex justify-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAberto(true)}
          className="text-xs text-muted-foreground"
        >
          <Headset className="h-3 w-3 mr-1" />
          Ver parâmetros de atendimento
          {operadorNome ? ` (operador: ${operadorNome})` : ""}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Headset className="h-5 w-5 text-primary" />
          Parâmetros de atendimento
        </CardTitle>
        <CardDescription className="text-xs">
          Como o WhatsApp deste cliente deve ser roteado quando ele chamar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormField
          control={form.control}
          name="operador_responsavel_id"
          render={({ field }) => (
            <FormItem className="max-w-md">
              <FormLabel>Operador responsável</FormLabel>
              <Select
                value={field.value ?? SEM_OPERADOR}
                onValueChange={(v) => field.onChange(v === SEM_OPERADOR ? null : v)}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={isLoading ? "Carregando..." : "Sem operador responsável"} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={SEM_OPERADOR}>Sem operador responsável (distribuição normal)</SelectItem>
                  {operadores.map((o) => (
                    <SelectItem key={o.user_id} value={o.user_id}>
                      {o.nome}
                      {o.setor ? ` (${o.setor})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription className="text-xs">
                Vale para qualquer contato deste cliente: caixa, gerente, financeiro. Sempre que um deles chamar,
                o atendimento vai direto para esse operador. Se ele estiver offline ou no limite de chats,
                o atendimento entra na fila do setor dele.
              </FormDescription>
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}
