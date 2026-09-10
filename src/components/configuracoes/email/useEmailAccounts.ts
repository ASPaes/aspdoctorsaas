import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import type { EmailSecurity } from "./emailProviders";

export interface EmailAccount {
  id: string;
  tenant_id: string;
  rotulo: string;
  from_name: string | null;
  email: string;
  provider: string;
  setor_id: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_security: EmailSecurity;
  smtp_username: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_security: EmailSecurity | null;
  imap_username: string | null;
  is_default: boolean;
  ativo: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailTestResult {
  ok: boolean;
  mensagem: string;
  smtp: { ok: boolean; erro?: string };
  imap: { ok: boolean; erro?: string } | null;
}

export interface EmailAccountInput {
  id?: string | null;
  rotulo: string;
  from_name: string | null;
  email: string;
  provider: string;
  setor_id: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_security: EmailSecurity;
  smtp_username: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_security: EmailSecurity | null;
  imap_username: string | null;
  is_default: boolean;
  ativo: boolean;
  /** vazio em edição = mantém a senha que já está no Vault */
  senha: string;
}

interface Setor {
  id: string;
  name: string;
}

/**
 * Contas de e-mail do tenant.
 *
 * Gravar e apagar passam pelas RPCs `fn_email_account_save` /
 * `fn_email_account_delete`: são elas que falam com o Vault, onde a senha mora.
 * Nunca escrever a senha direto na tabela. Alternar ativa/padrão é UPDATE
 * comum, coberto pelo RLS (só admin ou head escreve).
 */
export function useEmailAccounts() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["email_accounts", tid] });

  const accountsQuery = useQuery({
    queryKey: ["email_accounts", tid],
    enabled: !!tid,
    queryFn: async () => {
      let q = (supabase.from("email_accounts" as any) as any)
        .select("*")
        .order("is_default", { ascending: false })
        .order("rotulo", { ascending: true });
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EmailAccount[];
    },
  });

  const setoresQuery = useQuery({
    queryKey: ["email_accounts_setores", tid],
    enabled: !!tid,
    queryFn: async () => {
      let q = (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Setor[];
    },
  });

  const saveAccount = useMutation({
    mutationFn: async (input: EmailAccountInput) => {
      if (!tid) throw new Error("Selecione um tenant antes de cadastrar a conta.");
      const { data, error } = await (supabase.rpc as any)("fn_email_account_save", {
        p_rotulo: input.rotulo,
        p_email: input.email,
        p_provider: input.provider,
        p_smtp_host: input.smtp_host,
        p_smtp_port: input.smtp_port,
        p_smtp_security: input.smtp_security,
        p_smtp_username: input.smtp_username,
        p_senha: input.senha || null,
        p_id: input.id ?? null,
        p_tenant_id: tid,
        p_from_name: input.from_name,
        p_setor_id: input.setor_id,
        p_imap_host: input.imap_host,
        p_imap_port: input.imap_port,
        p_imap_security: input.imap_security,
        p_imap_username: input.imap_username,
        p_is_default: input.is_default,
        p_ativo: input.ativo,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const deleteAccount = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("fn_email_account_delete", { p_id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateFlags = useMutation({
    mutationFn: async ({ id, ativo, is_default }: { id: string; ativo?: boolean; is_default?: boolean }) => {
      const patch: Record<string, boolean> = {};
      if (ativo !== undefined) patch.ativo = ativo;
      if (is_default !== undefined) patch.is_default = is_default;
      const { error } = await (supabase.from("email_accounts" as any) as any)
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /**
   * Abre SMTP e IMAP de verdade pela edge function. Ela guarda o resultado em
   * `last_test_*` na conta, por isso o invalidate no fim.
   */
  const testAccount = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("test-email-account", {
        body: { account_id: id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as EmailTestResult;
    },
    onSettled: invalidate,
  });

  return {
    accounts: accountsQuery.data ?? [],
    isLoading: accountsQuery.isLoading,
    setores: setoresQuery.data ?? [],
    saveAccount,
    deleteAccount,
    updateFlags,
    testAccount,
  };
}
