import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Headset, Lock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOperadoresAtendimento } from "@/hooks/useOperadoresAtendimento";

const SEM_OPERADOR = "__none__";

interface Props {
  contactId: string | null;
  canEdit: boolean;
}

/**
 * Operador responsável do contato.
 *
 * O do CLIENTE ganha do que estiver marcado no contato: quando o cliente tem
 * operador, este card só mostra de onde a regra vem. O seletor por contato
 * existe para o contato cujo cliente está sem operador (ou sem cliente nenhum).
 */
export function OperadorResponsavelCard({ contactId, canEdit }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const { data: operadores = [] } = useOperadoresAtendimento(tid);

  const { data: vinculo } = useQuery({
    queryKey: ["operador-responsavel-contato", contactId],
    enabled: !!contactId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: ct } = await supabase.from("whatsapp_contacts")
        .select("id, cliente_id, operador_responsavel_id")
        .eq("id", contactId!)
        .maybeSingle();
      if (!ct) return null;

      let clienteOperador: string | null = null;
      let clienteNome: string | null = null;
      if ((ct as any).cliente_id) {
        const { data: cl } = await supabase.from("clientes")
          .select("razao_social, nome_fantasia, operador_responsavel_id")
          .eq("id", (ct as any).cliente_id)
          .maybeSingle();
        clienteOperador = (cl as any)?.operador_responsavel_id ?? null;
        clienteNome = (cl as any)?.nome_fantasia || (cl as any)?.razao_social || null;
      }

      return {
        contatoOperador: (ct as any).operador_responsavel_id as string | null,
        clienteOperador,
        clienteNome,
      };
    },
  });

  const salvar = useMutation({
    mutationFn: async (userId: string | null) => {
      const { error } = await supabase.from("whatsapp_contacts")
        .update({ operador_responsavel_id: userId })
        .eq("id", contactId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operador-responsavel-contato", contactId] });
      toast.success("Operador responsável atualizado");
    },
    onError: (e: any) => toast.error(e?.message || "Não foi possível salvar"),
  });

  if (!contactId || !vinculo) return null;

  const vemDoCliente = !!vinculo.clienteOperador;
  const efetivo = vinculo.clienteOperador ?? vinculo.contatoOperador;
  const nomeEfetivo = operadores.find((o) => o.user_id === efetivo)?.nome ?? null;

  return (
    <div className="bg-muted rounded-md p-3 space-y-2 min-w-0">
      <div className="flex items-center gap-2">
        <Headset className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">Operador responsável</span>
      </div>

      {vemDoCliente ? (
        <>
          <p className="text-sm font-medium truncate" title={nomeEfetivo ?? undefined}>
            {nomeEfetivo ?? "Operador removido do sistema"}
          </p>
          <p className="text-[10px] text-muted-foreground leading-snug flex items-start gap-1">
            <Lock className="h-3 w-3 mt-0.5 shrink-0" />
            Vem do cadastro do cliente{vinculo.clienteNome ? ` ${vinculo.clienteNome}` : ""} e vale para todos os
            contatos dele. Para trocar, edite o cliente.
          </p>
        </>
      ) : canEdit ? (
        <>
          <Select
            value={vinculo.contatoOperador ?? SEM_OPERADOR}
            onValueChange={(v) => salvar.mutate(v === SEM_OPERADOR ? null : v)}
            disabled={salvar.isPending}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Sem operador responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_OPERADOR}>Sem operador responsável</SelectItem>
              {operadores.map((o) => (
                <SelectItem key={o.user_id} value={o.user_id}>
                  {o.nome}
                  {o.setor ? ` (${o.setor})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Sempre que este contato chamar, o atendimento vai direto para o operador escolhido. Com ele offline ou
            no limite de chats, entra na fila do setor dele.
          </p>
        </>
      ) : (
        <p className="text-sm font-medium truncate">
          {nomeEfetivo ?? "Sem operador responsável"}
        </p>
      )}
    </div>
  );
}
