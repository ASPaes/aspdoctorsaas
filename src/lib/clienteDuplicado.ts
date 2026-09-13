import { supabase } from "@/integrations/supabase/client";
import { cnpjDigitsVariants, documentoCompleto } from "@/lib/cnpjDigitsVariants";

export interface ClienteMesmoDocumento {
  id: string;
  codigo_sequencial: number | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  cancelado: boolean | null;
}

/**
 * Outros clientes do mesmo tenant com este CNPJ/CPF.
 *
 * Usada em dois lugares com propósitos diferentes: a faixa âmbar da aba de dados
 * (feedback enquanto digita) e a TRAVA do salvar. A trava consulta de novo no
 * submit em vez de reaproveitar o estado da aba — o debounce de 400ms perde quem
 * cola o documento e salva em seguida, que é justamente a pessoa com pressa.
 *
 * `cnpjDigitsVariants` cobre o zero-fill de 14 dígitos: o CPF 374.105.258-27 está
 * na base como `00037410525827` desde a importação de jun/2026.
 */
export async function buscarClientesComMesmoDocumento(
  tenantId: string,
  digits: string,
  ignorarClienteId?: string,
): Promise<ClienteMesmoDocumento[]> {
  if (!tenantId || !documentoCompleto(digits)) return [];
  let q = (supabase as any)
    .from("clientes")
    .select("id, codigo_sequencial, razao_social, nome_fantasia, cancelado")
    .eq("tenant_id", tenantId)
    .in("cnpj_digits", cnpjDigitsVariants(digits))
    .limit(5);
  if (ignorarClienteId) q = q.neq("id", ignorarClienteId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ClienteMesmoDocumento[];
}
