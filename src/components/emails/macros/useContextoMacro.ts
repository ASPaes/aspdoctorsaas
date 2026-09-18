import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentDisplayName } from "@/hooks/useAgentDisplayName";
import { montarValores, type DadosDaMacro, type ValoresMacro } from "./camposMacro";

/**
 * De onde vêm os campos automáticos na tela Enviar e-mail. Cada tela (chat,
 * chamado, jornada) diz o que já sabe; o resto sai do cadastro do cliente.
 */
export interface ContextoMacro {
  tenantId: string;
  clienteId: string | null;
  /** setor do atendimento ou do chamado */
  departmentId: string | null;
  /** contato do chamado ou nome do contato no WhatsApp; sem ele, o do cadastro */
  contatoNome: string | null;
  numeroAtendimento: string | null;
  numeroChamado: string | null;
  assuntoChamado: string | null;
}

export function useContextoMacro(ctx: ContextoMacro, enabled: boolean) {
  const { user, profile } = useAuth();
  const atendente = useAgentDisplayName();

  const consulta = useQuery({
    queryKey: ["email-macro-contexto", ctx.tenantId, ctx.clienteId, ctx.departmentId, user?.id ?? null],
    enabled: enabled && !!ctx.tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const [cli, setor, membros] = await Promise.all([
        ctx.clienteId
          ? (supabase.from("clientes" as any) as any)
              .select(
                "nome_fantasia, razao_social, cnpj, codigo_sequencial, email, telefone_contato, telefone_whatsapp, contato_nome, dia_vencimento_mrr, cidades(nome), estados(sigla)",
              )
              .eq("id", ctx.clienteId)
              .eq("tenant_id", ctx.tenantId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        ctx.departmentId
          ? (supabase.from("support_departments" as any) as any).select("name").eq("id", ctx.departmentId).maybeSingle()
          : Promise.resolve({ data: null }),
        user?.id
          ? (supabase.from("support_department_members" as any) as any)
              .select("department_id")
              .eq("tenant_id", ctx.tenantId)
              .eq("user_id", user.id)
              .eq("is_active", true)
          : Promise.resolve({ data: [] }),
      ]);
      return {
        cliente: (cli as any)?.data ?? null,
        setorNome: ((setor as any)?.data?.name as string | undefined) ?? null,
        meusSetores: (((membros as any)?.data ?? []) as { department_id: string }[]).map((m) => m.department_id),
      };
    },
  });

  const c = consulta.data?.cliente;
  const dados: DadosDaMacro = useMemo(
    () => ({
      contatoNome: ctx.contatoNome || c?.contato_nome || null,
      nomeFantasia: c?.nome_fantasia ?? null,
      razaoSocial: c?.razao_social ?? null,
      cnpj: c?.cnpj ?? null,
      codigoCliente: c?.codigo_sequencial ?? null,
      cidade: c?.cidades?.nome ?? null,
      uf: c?.estados?.sigla ?? null,
      emailCliente: c?.email ?? null,
      telefone: c?.telefone_contato || c?.telefone_whatsapp || null,
      diaVencimento: c?.dia_vencimento_mrr ?? null,
      atendente,
      setor: consulta.data?.setorNome ?? null,
      numeroAtendimento: ctx.numeroAtendimento,
      numeroChamado: ctx.numeroChamado,
      assuntoChamado: ctx.assuntoChamado,
    }),
    [c, consulta.data?.setorNome, atendente, ctx.contatoNome, ctx.numeroAtendimento, ctx.numeroChamado, ctx.assuntoChamado],
  );

  // a saudação e a data são as da hora em que a lista é aberta
  const valores: ValoresMacro = useMemo(() => montarValores(dados), [dados]);

  const papel = profile?.role ?? "";
  return {
    valores,
    carregando: consulta.isLoading,
    meusSetores: consulta.data?.meusSetores ?? [],
    /** admin, gestor e super admin: veem todas e podem salvar macro */
    podeCadastrar: profile?.is_super_admin === true || papel === "admin" || papel === "head",
  };
}

export type { ValoresMacro };
