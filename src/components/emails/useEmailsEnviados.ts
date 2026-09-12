import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface EmailEnviado {
  id: string;
  created_at: string;
  assunto: string;
  remetente: string;
  para: string[];
  cc: string[];
  origem: string;
  status: string;
  erro: string | null;
  referencia_id: string | null;
  cliente_id: string | null;
  department_id: string | null;
  account_id: string | null;
  deleted_at: string | null;
  email_accounts?: { email: string; rotulo: string } | null;
  clientes?: { razao_social: string | null; nome_fantasia: string | null } | null;
  support_departments?: { name: string } | null;
}

export interface FiltrosEnviados {
  busca: string;
  setores: string[];
  origens: string[];
  contas: string[];
  situacoes: string[];
  periodo: { from: Date; to: Date };
  lixeira: boolean;
}

export const POR_PAGINA = 50;

/** o `.or()` do PostgREST quebra com vírgula e parêntese soltos no valor */
const limpar = (t: string) => t.replace(/[(),*%]/g, " ").trim();

export const nomeDoCliente = (e: EmailEnviado) =>
  e.clientes?.nome_fantasia || e.clientes?.razao_social || null;

/** rótulos de origem que a tela mostra; o resto aparece como veio */
export const ROTULO_ORIGEM: Record<string, string> = {
  chat_close: "Chat",
  chat: "Chat",
  ticket: "Ticket A",
  ticket_close: "Ticket A",
  onboarding: "Ticket O",
  teste: "Teste",
  manual: "Manual",
};

export function useEmailsEnviados(filtros: FiltrosEnviados, pagina: number) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["emails_enviados", tid, filtros, pagina],
    enabled: !!tid,
    queryFn: async () => {
      const busca = limpar(filtros.busca);

      // busca por nome de cliente e por número de ticket resolvem antes, porque
      // são tabelas diferentes; depois viram filtro por id
      let clienteIds: string[] = [];
      let referenciaIds: string[] = [];
      if (busca.length >= 2) {
        const { data: clientes } = await (supabase.from("clientes" as any) as any)
          .select("id")
          .eq("tenant_id", tid)
          .or(`razao_social.ilike.%${busca}%,nome_fantasia.ilike.%${busca}%`)
          .limit(200);
        clienteIds = (clientes ?? []).map((c: any) => c.id);

        if (/^tk[-\s]?/i.test(busca) || /^\d{3,}$/.test(busca)) {
          const { data: tickets } = await (supabase.from("support_tickets" as any) as any)
            .select("id")
            .eq("tenant_id", tid)
            .ilike("codigo", `%${busca}%`)
            .limit(200);
          referenciaIds = (tickets ?? []).map((t: any) => t.id);
        }
      }

      let q = (supabase.from("email_envios" as any) as any)
        .select(
          "id, created_at, assunto, remetente, para, cc, origem, status, erro, referencia_id, cliente_id, department_id, account_id, deleted_at, email_accounts(email, rotulo), clientes(razao_social, nome_fantasia), support_departments(name)",
          { count: "exact" },
        )
        .eq("tenant_id", tid)
        .gte("created_at", filtros.periodo.from.toISOString())
        .lte("created_at", filtros.periodo.to.toISOString())
        .order("created_at", { ascending: false })
        .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);

      q = filtros.lixeira ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
      if (filtros.setores.length) q = q.in("department_id", filtros.setores);
      if (filtros.origens.length) q = q.in("origem", filtros.origens);
      if (filtros.contas.length) q = q.in("account_id", filtros.contas);
      if (filtros.situacoes.length) q = q.in("status", filtros.situacoes);

      if (busca.length >= 2) {
        const partes = [`assunto.ilike.%${busca}%`, `remetente.ilike.%${busca}%`];
        if (busca.includes("@")) partes.push(`para.cs.{"${busca}"}`);
        if (clienteIds.length) partes.push(`cliente_id.in.(${clienteIds.join(",")})`);
        if (referenciaIds.length) partes.push(`referencia_id.in.(${referenciaIds.join(",")})`);
        q = q.or(partes.join(","));
      }

      const { data, error, count } = await q;
      if (error) throw error;
      return { linhas: (data ?? []) as EmailEnviado[], total: count ?? 0 };
    },
  });
}

/** opções dos filtros: contas e setores do tenant */
export function useOpcoesFiltro() {
  const { effectiveTenantId: tid } = useTenantFilter();

  const contas = useQuery({
    queryKey: ["emails_filtro_contas", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("email_accounts" as any) as any)
        .select("id, rotulo, email")
        .eq("tenant_id", tid)
        .order("rotulo");
      if (error) throw error;
      return (data ?? []) as { id: string; rotulo: string; email: string }[];
    },
  });

  const setores = useQuery({
    queryKey: ["emails_filtro_setores", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  return { contas: contas.data ?? [], setores: setores.data ?? [] };
}

/**
 * Lixeira: mover, restaurar ou excluir de vez. A trava do vínculo com
 * atendimento ou ticket mora na RPC, não aqui.
 */
export function useLixeiraEnviados() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, acao }: { ids: string[]; acao: "lixeira" | "restaurar" | "excluir" }) => {
      const { data, error } = await (supabase.rpc as any)("fn_email_envios_lixeira", {
        p_ids: ids,
        p_acao: acao,
      });
      if (error) throw error;
      const r = (Array.isArray(data) ? data[0] : data) ?? { afetados: 0, bloqueados: 0 };
      return r as { afetados: number; bloqueados: number };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["emails_enviados"] }),
  });
}
