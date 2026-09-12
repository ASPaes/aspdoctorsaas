import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface EmailRecebido {
  id: string;
  recebido_em: string;
  assunto: string | null;
  corpo_texto: string | null;
  de_email: string;
  de_nome: string | null;
  status: "vinculado" | "remetente_diferente" | "avulso";
  envio_id: string | null;
  cliente_id: string | null;
  referencia_id: string | null;
  origem: string | null;
  account_id: string | null;
  deleted_at: string | null;
  email_accounts?: { email: string; rotulo: string } | null;
  clientes?: { razao_social: string | null; nome_fantasia: string | null } | null;
  email_envios?: { assunto: string; created_at: string } | null;
}

export interface FiltrosRecebidos {
  busca: string;
  contas: string[];
  situacoes: string[];
  periodo: { from: Date; to: Date };
  lixeira: boolean;
}

export const POR_PAGINA_RECEBIDOS = 50;

export const ROTULO_STATUS: Record<string, { texto: string; ajuda: string }> = {
  vinculado: {
    texto: "Vinculado",
    ajuda: "Respondeu a um e-mail nosso e veio do endereço esperado.",
  },
  remetente_diferente: {
    texto: "Remetente diferente",
    ajuda: "Respondeu a um e-mail nosso, mas de outro endereço. Não entra no histórico do atendimento sem alguém confirmar.",
  },
  avulso: {
    texto: "E-mail novo",
    ajuda: "Não é resposta: veio de um endereço que está na ficha de um cliente.",
  },
};

const limpar = (t: string) => t.replace(/[(),*%]/g, " ").trim();

export const nomeDoClienteRecebido = (e: EmailRecebido) =>
  e.clientes?.nome_fantasia || e.clientes?.razao_social || null;

export function useEmailsRecebidos(filtros: FiltrosRecebidos, pagina: number) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["emails_recebidos", tid, filtros, pagina],
    enabled: !!tid,
    queryFn: async () => {
      const busca = limpar(filtros.busca);

      let clienteIds: string[] = [];
      if (busca.length >= 2) {
        const { data: clientes } = await (supabase.from("clientes" as any) as any)
          .select("id")
          .eq("tenant_id", tid)
          .or(`razao_social.ilike.%${busca}%,nome_fantasia.ilike.%${busca}%`)
          .limit(200);
        clienteIds = (clientes ?? []).map((c: any) => c.id);
      }

      let q = (supabase.from("email_recebidos" as any) as any)
        .select(
          "id, recebido_em, assunto, corpo_texto, de_email, de_nome, status, envio_id, cliente_id, referencia_id, origem, account_id, deleted_at, email_accounts(email, rotulo), clientes(razao_social, nome_fantasia), email_envios(assunto, created_at)",
          { count: "exact" },
        )
        .eq("tenant_id", tid)
        .gte("recebido_em", filtros.periodo.from.toISOString())
        .lte("recebido_em", filtros.periodo.to.toISOString())
        .order("recebido_em", { ascending: false })
        .range(pagina * POR_PAGINA_RECEBIDOS, pagina * POR_PAGINA_RECEBIDOS + POR_PAGINA_RECEBIDOS - 1);

      q = filtros.lixeira ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
      if (filtros.contas.length) q = q.in("account_id", filtros.contas);
      if (filtros.situacoes.length) q = q.in("status", filtros.situacoes);

      if (busca.length >= 2) {
        const partes = [`assunto.ilike.%${busca}%`, `de_email.ilike.%${busca}%`, `corpo_texto.ilike.%${busca}%`];
        if (clienteIds.length) partes.push(`cliente_id.in.(${clienteIds.join(",")})`);
        q = q.or(partes.join(","));
      }

      const { data, error, count } = await q;
      if (error) throw error;
      return { linhas: (data ?? []) as EmailRecebido[], total: count ?? 0 };
    },
  });
}

/** quantas caixas estão com a leitura ligada, e quando cada uma rodou */
export function useEstadoDaLeitura() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["emails_estado_leitura", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data: contas, error } = await (supabase.from("email_accounts" as any) as any)
        .select("id, rotulo, email, receber_respostas, ativo")
        .eq("tenant_id", tid)
        .eq("receber_respostas", true);
      if (error) throw error;

      const { data: estados } = await (supabase.from("email_ingestao_estado" as any) as any)
        .select("account_id, ultima_leitura, ultimo_erro")
        .eq("tenant_id", tid);

      const porConta = new Map<string, any>((estados ?? []).map((e: any) => [e.account_id, e]));
      return ((contas ?? []) as any[]).map((c) => ({
        ...c,
        ultima_leitura: porConta.get(c.id)?.ultima_leitura ?? null,
        ultimo_erro: porConta.get(c.id)?.ultimo_erro ?? null,
      }));
    },
  });
}

export function useLixeiraRecebidos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, acao }: { ids: string[]; acao: "lixeira" | "restaurar" | "excluir" }) => {
      const { data, error } = await (supabase.rpc as any)("fn_email_recebidos_lixeira", {
        p_ids: ids,
        p_acao: acao,
      });
      if (error) throw error;
      const r = (Array.isArray(data) ? data[0] : data) ?? { afetados: 0, bloqueados: 0 };
      return r as { afetados: number; bloqueados: number };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["emails_recebidos"] }),
  });
}

/** manda o robô ler agora, sem esperar o horário */
export function useLerAgora() {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ler-emails-recebidos", {
        body: { tenant_id: tid },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as {
        caixas: number;
        mensagem?: string;
        resultados?: { conta: string; lidas: number; registradas: number; ignoradas: number; erro?: string }[];
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos"] });
      queryClient.invalidateQueries({ queryKey: ["emails_estado_leitura"] });
    },
  });
}
