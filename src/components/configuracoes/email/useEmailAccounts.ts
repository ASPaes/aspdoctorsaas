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
  /** DEPRECATED: primeiro de `setor_ids`, mantido só para a tela antiga */
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
  receber_respostas: boolean;
  aceitar_cliente_cadastrado: boolean;
  descartar_automaticos: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
  /** vêm de email_account_setores / email_account_usuarios */
  setor_ids: string[];
  user_ids: string[];
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
  setor_ids: string[];
  user_ids: string[];
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
  receber_respostas: boolean;
  aceitar_cliente_cadastrado: boolean;
  descartar_automaticos: boolean;
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
 * `fn_email_account_delete`: são elas que falam com o Vault, onde a senha mora,
 * e que gravam os setores e usuários de cada conta. Nunca escrever a senha nem
 * as ligações direto na tabela. Alternar ativa/padrão é UPDATE comum, coberto
 * pelo RLS (só admin ou head escreve).
 */
export function useEmailAccounts() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["email_accounts", tid] });

  const accountsQuery = useQuery({
    queryKey: ["email_accounts", tid],
    enabled: !!tid,
    queryFn: async () => {
      const doTenant = (q: any) => (tid ? q.eq("tenant_id", tid) : q);

      const [contas, setores, usuarios] = await Promise.all([
        doTenant(
          (supabase.from("email_accounts" as any) as any)
            .select("*")
            .order("is_default", { ascending: false })
            .order("rotulo", { ascending: true }),
        ),
        doTenant((supabase.from("email_account_setores" as any) as any).select("account_id, setor_id")),
        doTenant((supabase.from("email_account_usuarios" as any) as any).select("account_id, user_id")),
      ]);
      for (const r of [contas, setores, usuarios]) if (r.error) throw r.error;

      const agrupar = (linhas: any[], campo: string) => {
        const m = new Map<string, string[]>();
        for (const l of linhas ?? []) m.set(l.account_id, [...(m.get(l.account_id) ?? []), l[campo]]);
        return m;
      };
      const setoresPorConta = agrupar(setores.data, "setor_id");
      const usuariosPorConta = agrupar(usuarios.data, "user_id");

      return ((contas.data ?? []) as any[]).map((c) => ({
        ...c,
        setor_ids: setoresPorConta.get(c.id) ?? [],
        user_ids: usuariosPorConta.get(c.id) ?? [],
      })) as EmailAccount[];
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
        p_imap_host: input.imap_host,
        p_imap_port: input.imap_port,
        p_imap_security: input.imap_security,
        p_imap_username: input.imap_username,
        p_is_default: input.is_default,
        p_ativo: input.ativo,
        p_setor_ids: input.setor_ids,
        p_user_ids: input.user_ids,
      });
      if (error) throw error;

      // As três chaves de leitura são colunas comuns e ficam fora da RPC de
      // propósito: mexer na assinatura dela de novo obrigaria a derrubar e
      // recriar a função em produção. O RLS de UPDATE já é o mesmo portão
      // (admin ou head), que é exatamente quem chega neste diálogo.
      const { error: erroLeitura } = await (supabase.from("email_accounts" as any) as any)
        .update({
          receber_respostas: input.receber_respostas,
          aceitar_cliente_cadastrado: input.aceitar_cliente_cadastrado,
          descartar_automaticos: input.descartar_automaticos,
        })
        .eq("id", data as string);
      if (erroLeitura) throw erroLeitura;

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
      if (error) throw new Error(await mensagemDoErro(error));
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as EmailTestResult;
    },
    onSettled: invalidate,
  });

  /**
   * Envio de verdade pela send-email. O tenant vai explícito, o da própria
   * conta, para o super admin conseguir testar conta de outro tenant.
   */
  const sendEmail = useMutation({
    mutationFn: async (input: {
      account_id: string;
      tenant_id: string;
      to: string;
      subject: string;
      html: string;
      origem: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("send-email", { body: input });
      if (error) throw new Error(await mensagemDoErro(error));
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as EnvioResultado;
    },
  });

  return {
    accounts: accountsQuery.data ?? [],
    isLoading: accountsQuery.isLoading,
    setores: setoresQuery.data ?? [],
    saveAccount,
    deleteAccount,
    updateFlags,
    testAccount,
    sendEmail,
  };
}

export interface EnvioResultado {
  ok: boolean;
  mensagem: string;
  envio_id: string | null;
  message_id: string;
  conta: string;
}

/**
 * Em resposta 4xx, `functions.invoke` devolve só "Edge Function returned a
 * non-2xx status code" e esconde o motivo, que está no JSON do corpo.
 */
async function mensagemDoErro(error: any): Promise<string> {
  try {
    const corpo = await error?.context?.json?.();
    if (corpo?.error) return String(corpo.error);
  } catch {
    // corpo não era JSON
  }
  return error?.message || "Falha ao falar com o servidor.";
}
