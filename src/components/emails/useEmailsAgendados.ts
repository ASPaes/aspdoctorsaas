import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { LISTA_AO_VIVO } from "./useEmailsEnviados";

/**
 * E-mail agendado (16/09/2026). A tabela `email_agendados` só é escrita por
 * RPC (`fn_email_agendar`, `fn_email_agendado_acao`); o RLS de leitura é o dos
 * Enviados: admin/head veem o tenant, os demais o que agendaram.
 */

export interface EmailAgendado {
  id: string;
  agendar_para: string;
  status: "agendado" | "enviando" | "erro";
  erro: string | null;
  assunto: string;
  para: string[];
  origem: string;
  agendado_por: string;
  updated_at: string;
}

/** o que a tela manda: os mesmos campos do envio na hora */
export interface EmailParaAgendar {
  account_id: string;
  para: string[];
  cc: string[];
  cco: string[];
  assunto: string;
  texto: string;
  html: string;
  historico_html?: string | null;
  historico_texto?: string | null;
  origem: string;
  referencia_id: string | null;
  cliente_id: string | null;
  department_id: string | null;
  anexos: { path: string; nome: string; mime: string; bucket?: string }[];
}

/** erro de RPC vem com a frase do banco; a tela mostra ela */
const frase = (err: any) => err?.message || "Não foi possível concluir.";

export async function agendarEmail(tenantId: string, quando: Date, email: EmailParaAgendar): Promise<string> {
  const { data, error } = await (supabase.rpc as any)("fn_email_agendar", {
    p_tenant_id: tenantId,
    p_quando: quando.toISOString(),
    p_email: email,
  });
  if (error) throw new Error(frase(error));
  return data as string;
}

/** pendentes e os que falharam nos últimos 7 dias; enviado some daqui e aparece na lista normal */
export function useEmailsAgendados() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ["emails_agendados", tid],
    enabled: !!tid,
    ...LISTA_AO_VIVO,
    queryFn: async () => {
      const seteDias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase.from("email_agendados" as any) as any)
        .select("id, agendar_para, status, erro, assunto, para, origem, agendado_por, updated_at")
        .eq("tenant_id", tid)
        .or(`status.in.(agendado,enviando),and(status.eq.erro,updated_at.gte.${seteDias})`)
        .order("agendar_para", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as EmailAgendado[];
    },
  });
}

export function useAcaoAgendado() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; acao: "reagendar" | "enviar_agora" | "cancelar"; quando?: Date }) => {
      const { error } = await (supabase.rpc as any)("fn_email_agendado_acao", {
        p_id: v.id,
        p_acao: v.acao,
        p_quando: v.quando ? v.quando.toISOString() : null,
      });
      if (error) throw new Error(frase(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emails_agendados"] });
      queryClient.invalidateQueries({ queryKey: ["emails_enviados"] });
    },
  });
}
