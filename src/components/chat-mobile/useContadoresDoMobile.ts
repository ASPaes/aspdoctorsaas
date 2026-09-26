import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Números dos cards da tela inicial do telefone.
 *
 * ⚠️ **É a carteira da PESSOA, não o movimento da empresa.** Até 25/09/2026 estes
 * números contavam tudo do tenant: o card de Tickets marcava 99+ e o de Chat 7 para
 * quem não tinha nenhum dos dois no nome. Número que não é seu não é aviso, é ruído —
 * e some a diferença entre "tem coisa te esperando" e "a empresa está movimentada".
 *
 * O dono de cada coisa:
 *   - chat        → `support_attendances.assigned_to` (não a conversa: o dono mora no
 *                   atendimento, ver a regra de distribuição)
 *   - tickets     → `support_tickets.responsavel_user_id`
 *   - implantação → `onboarding_journeys.responsavel_user_id`
 *   - e-mails     → não tem dono; o que existe é setor. Conta os não lidos dos setores
 *                   de que a pessoa participa, e nada quando ela não está em nenhum.
 *
 * ⚠️ NÃO usa `whatsapp_pill_counts`. Aquela RPC é a consulta mais cara do sistema —
 * medida em 22/09/2026 em 5.490 chamadas/hora a 198ms, ~30% de um núcleo só para os
 * números das abas do chat. Pendurá-la na tela de abertura, que todo mundo vê a cada
 * vez que abre o app, multiplicaria isso. Aqui cada número é um `count` com
 * `head: true`: o servidor devolve só o total, sem trafegar linha nenhuma.
 *
 * Cada contagem é uma query própria de propósito — uma falhar (RLS, tabela que o
 * tenant não usa) não pode derrubar as outras, e a tela tem que abrir mesmo sem
 * número.
 */

const CADENCIA_MS = 60_000;

/** Atendimento aberto: o que ainda está com alguém. `closed` é 99% da tabela. */
const ATENDIMENTO_ABERTO = ["in_progress", "waiting"];

function useContagem(chave: string, pronto: boolean, consulta: () => any, tid: string | null, uid: string | null) {
  return useQuery({
    queryKey: ["mobile-home", chave, tid, uid],
    enabled: pronto,
    // A tela inicial é de passagem: a pessoa abre e entra num módulo. Um minuto
    // de validade evita refazer a conta a cada ida e volta pelo gesto de voltar.
    staleTime: CADENCIA_MS,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { count, error } = await consulta();
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useContadoresDoMobile() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const pronto = !!tid && !!uid;

  const chat = useContagem("chat", pronto, () =>
    (supabase.from("support_attendances" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .eq("assigned_to", uid)
      .in("status", ATENDIMENTO_ABERTO)
  , tid, uid);

  // Aberto = sem conclusão e não apagado. É o que a tabela sabe dizer sem
  // depender da configuração de status de cada tenant (`ticket_statuses` é por
  // tenant, e "aberto" não é um valor fixo lá).
  const tickets = useContagem("tickets", pronto, () =>
    (supabase.from("support_tickets" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .eq("responsavel_user_id", uid)
      .is("concluido_em", null)
      .is("deleted_at", null)
  , tid, uid);

  const implantacao = useContagem("implantacao", pronto, () =>
    (supabase.from("onboarding_journeys" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .eq("responsavel_user_id", uid)
      .is("concluido_em", null)
  , tid, uid);

  /** Os setores da pessoa. É o mesmo lugar de onde a tela de E-mails tira as pastas. */
  const setores = useQuery({
    queryKey: ["mobile-home", "meus-setores", tid, uid],
    enabled: pronto,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_department_members" as any) as any)
        .select("department_id")
        .eq("tenant_id", tid)
        .eq("user_id", uid)
        .eq("is_active", true);
      if (error) throw error;
      return ((data ?? []) as any[]).map((m) => m.department_id).filter(Boolean) as string[];
    },
  });
  const meusSetores = setores.data ?? [];

  const emails = useQuery({
    queryKey: ["mobile-home", "emails", tid, meusSetores.join(",")],
    // Sem setor não há caixa nenhuma para a pessoa: zero, sem ir ao banco.
    enabled: pronto && meusSetores.length > 0,
    staleTime: CADENCIA_MS,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { count, error } = await (supabase.from("email_recebidos" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tid)
        .in("department_id", meusSetores)
        .is("lido_em", null)
        .is("deleted_at", null)
        .is("arquivado_em", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  return {
    chat: chat.data ?? 0,
    tickets: tickets.data ?? 0,
    implantacao: implantacao.data ?? 0,
    emails: emails.data ?? 0,
    carregando:
      chat.isLoading || tickets.isLoading || implantacao.isLoading || setores.isLoading || emails.isLoading,
  };
}
