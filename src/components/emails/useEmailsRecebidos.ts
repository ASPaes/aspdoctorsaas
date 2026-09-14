import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { LISTA_AO_VIVO } from "./useEmailsEnviados";

export type AcaoRecebido =
  | "pendente"
  | "ticket_aberto"
  | "resposta_ticket"
  | "ticket_reaberto"
  | "jornada"
  | "triagem"
  | "registrado"
  | "ignorado"
  | "erro";

export interface EmailRecebido {
  id: string;
  recebido_em: string;
  assunto: string | null;
  corpo_texto: string | null;
  de_email: string;
  de_nome: string | null;
  status: "vinculado" | "remetente_diferente" | "avulso" | "desconhecido";
  envio_id: string | null;
  cliente_id: string | null;
  referencia_id: string | null;
  origem: string | null;
  account_id: string | null;
  deleted_at: string | null;
  acao: AcaoRecebido | null;
  acao_detalhe: string | null;
  department_id: string | null;
  ticket_id: string | null;
  email_accounts?: { email: string; rotulo: string } | null;
  clientes?: { razao_social: string | null; nome_fantasia: string | null } | null;
  support_departments?: { name: string } | null;
  support_tickets?: { ticket_code: string | null } | null;
  email_envios?: { assunto: string; created_at: string } | null;
}

export interface FiltrosRecebidos {
  busca: string;
  contas: string[];
  acoes: string[];
  /** nulo = aba Geral */
  setor: string | null;
  periodo: { from: Date; to: Date };
  lixeira: boolean;
}

export const POR_PAGINA_RECEBIDOS = 50;

export type TomAcao = "ok" | "info" | "warn" | "violet" | "plain" | "erro";

export const ROTULO_ACAO: Record<AcaoRecebido, { texto: string; tom: TomAcao; ajuda: string }> = {
  ticket_aberto: {
    texto: "Ticket aberto",
    tom: "ok",
    ajuda: "O e-mail do cliente virou ticket na fila do setor.",
  },
  resposta_ticket: {
    texto: "Resposta",
    tom: "info",
    ajuda: "O cliente respondeu e a mensagem entrou no ticket.",
  },
  ticket_reaberto: {
    texto: "Ticket reaberto",
    tom: "info",
    ajuda: "O cliente respondeu a um ticket encerrado dentro do prazo, e ele voltou para a fila do setor.",
  },
  jornada: {
    texto: "Na jornada",
    tom: "violet",
    ajuda: "A mensagem entrou na jornada de onboarding do cliente.",
  },
  triagem: {
    texto: "Na triagem",
    tom: "warn",
    ajuda: "Precisa de um gestor: escolher o cliente e abrir o ticket, ou ignorar.",
  },
  registrado: {
    texto: "Registrado",
    tom: "plain",
    ajuda: "Guardado aqui, sem abrir ticket.",
  },
  ignorado: {
    texto: "Ignorado",
    tom: "plain",
    ajuda: "Não abriu ticket: remetente bloqueado, endereço que não abre ticket ou ignorado na triagem.",
  },
  pendente: {
    texto: "Processando",
    tom: "plain",
    ajuda: "Acabou de chegar. O robô termina de processar na próxima leitura.",
  },
  erro: {
    texto: "Tentando de novo",
    tom: "erro",
    ajuda: "Deu erro ao processar. O robô tenta de novo nas próximas leituras.",
  },
};

export const OPCOES_ACAO = (
  ["ticket_aberto", "resposta_ticket", "ticket_reaberto", "jornada", "triagem", "registrado", "ignorado", "erro"] as AcaoRecebido[]
).map((id) => ({ id, label: ROTULO_ACAO[id].texto }));

const limpar = (t: string) => t.replace(/[(),*%]/g, " ").trim();

export const nomeDoClienteRecebido = (e: EmailRecebido) =>
  e.clientes?.nome_fantasia || e.clientes?.razao_social || null;

/**
 * email_recebidos tem DUAS ligações com email_envios desde 13/09/2026
 * (envio_id e confirmacao_envio_id): toda ligação é nomeada, senão o PostgREST
 * recusa a consulta inteira. A de support_tickets é nomeada pelo mesmo motivo,
 * por prevenção.
 */
const COLUNAS =
  "id, recebido_em, assunto, corpo_texto, de_email, de_nome, status, envio_id, cliente_id, referencia_id, origem, account_id, deleted_at, " +
  "acao, acao_detalhe, department_id, ticket_id, email_accounts(email, rotulo), clientes(razao_social, nome_fantasia), " +
  "support_departments(name), support_tickets!email_recebidos_ticket_id_fkey(ticket_code), " +
  "email_envios!email_recebidos_envio_id_fkey(assunto, created_at)";

export function useEmailsRecebidos(filtros: FiltrosRecebidos, pagina: number) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["emails_recebidos", tid, filtros, pagina],
    enabled: !!tid,
    ...LISTA_AO_VIVO,
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
        .select(COLUNAS, { count: "exact" })
        .eq("tenant_id", tid)
        .gte("recebido_em", filtros.periodo.from.toISOString())
        .lte("recebido_em", filtros.periodo.to.toISOString())
        .order("recebido_em", { ascending: false })
        .range(pagina * POR_PAGINA_RECEBIDOS, pagina * POR_PAGINA_RECEBIDOS + POR_PAGINA_RECEBIDOS - 1);

      q = filtros.lixeira ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
      if (filtros.setor) q = q.eq("department_id", filtros.setor);
      if (filtros.contas.length) q = q.in("account_id", filtros.contas);
      // sem filtro escolhido, o ignorado (propaganda bloqueada, endereço desligado) fica fora
      if (filtros.acoes.length) q = q.in("acao", filtros.acoes);
      else q = q.neq("acao", "ignorado");

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

/** contagem por setor e da triagem, para as abas e o atalho; respeita o período */
export function useContagemRecebidos(periodo: { from: Date; to: Date }, lixeira: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["emails_recebidos_contagem", tid, periodo.from.toISOString(), periodo.to.toISOString(), lixeira],
    enabled: !!tid,
    ...LISTA_AO_VIVO,
    queryFn: async () => {
      const linhas = await fetchAllRows<{ department_id: string | null; acao: string | null }>(() => {
        let q = (supabase.from("email_recebidos" as any) as any)
          .select("department_id, acao")
          .eq("tenant_id", tid)
          .gte("recebido_em", periodo.from.toISOString())
          .lte("recebido_em", periodo.to.toISOString())
          .neq("acao", "ignorado");
        q = lixeira ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
        return q;
      });

      const porSetor = new Map<string, number>();
      let triagem = 0;
      for (const l of linhas) {
        if (l.department_id) porSetor.set(l.department_id, (porSetor.get(l.department_id) ?? 0) + 1);
        if (l.acao === "triagem") triagem++;
      }
      return { total: linhas.length, porSetor: Object.fromEntries(porSetor) as Record<string, number>, triagem };
    },
  });
}

/** caixas sendo lidas (registrar respostas ou endereço que abre ticket), e quando cada uma rodou */
export function useEstadoDaLeitura() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["emails_estado_leitura", tid],
    enabled: !!tid,
    ...LISTA_AO_VIVO,
    queryFn: async () => {
      const [contas, rotas, estados] = await Promise.all([
        (supabase.from("email_accounts" as any) as any)
          .select("id, rotulo, email, receber_respostas, ativo")
          .eq("tenant_id", tid)
          .eq("ativo", true),
        (supabase.from("email_enderecos_destino" as any) as any)
          .select("account_id")
          .eq("tenant_id", tid)
          .eq("abre_ticket", true),
        (supabase.from("email_ingestao_estado" as any) as any)
          .select("account_id, ultima_leitura, ultimo_erro")
          .eq("tenant_id", tid),
      ]);
      if (contas.error) throw contas.error;

      const abremTicket = new Set(((rotas.data ?? []) as { account_id: string }[]).map((r) => r.account_id));
      const porConta = new Map<string, any>((estados.data ?? []).map((e: any) => [e.account_id, e]));
      return ((contas.data ?? []) as any[])
        .filter((c) => c.receber_respostas || abremTicket.has(c.id))
        .map((c) => ({
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos"] });
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos_contagem"] });
    },
  });
}

/** Triagem: gestor escolhe o cliente (e o setor, se precisar) e abre o ticket, ou ignora */
export function useResolverTriagem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; acao: "abrir_ticket" | "ignorar"; clienteId?: string | null; setorId?: string | null }) => {
      const { data, error } = await (supabase.rpc as any)("fn_email_triagem_resolver", {
        p_recebido_id: p.id,
        p_acao: p.acao,
        p_cliente_id: p.clienteId ?? null,
        p_department_id: p.setorId ?? null,
      });
      if (error) throw error;
      return data as { ok: boolean; acao: string; ticket_id?: string; ticket_code?: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos"] });
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos_contagem"] });
    },
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
        tickets_abertos?: number;
        resultados?: { conta: string; lidas: number; registradas: number; ignoradas: number; erro?: string; ocupada?: boolean }[];
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos"] });
      queryClient.invalidateQueries({ queryKey: ["emails_recebidos_contagem"] });
      queryClient.invalidateQueries({ queryKey: ["emails_estado_leitura"] });
    },
  });
}
