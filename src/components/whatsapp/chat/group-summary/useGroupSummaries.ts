import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";

// DEM-0277: resumo de grupo por IA. Quem gera e a edge function
// summarize-whatsapp-group; a tela le whatsapp_group_summaries e so corrige ou
// apaga pelas RPCs wa_group_summary_save_edit / wa_group_summary_delete.

export const SECTIONS = [
  { key: "interacoes", label: "Interações realizadas" },
  { key: "treinamentos", label: "Treinamentos realizados" },
  { key: "duvidas", label: "Dúvidas e respostas" },
  { key: "pendencias_cliente", label: "Pendências do cliente" },
  { key: "pendencias_internas", label: "Pendências internas" },
  { key: "decisoes", label: "Decisões / definições" },
  { key: "proximos_passos", label: "Próximos passos" },
] as const;
export type SectionKey = typeof SECTIONS[number]["key"];

export interface SummaryItem {
  texto: string;
  msg_at: string | null;
  message_id: string | null;
}
export type Sections = Partial<Record<SectionKey, SummaryItem[]>>;

export type FilterType = "last_24h" | "period" | "attendance";

// Nivel de detalhe do resumo. O que existia antes de 22/09/2026 e "detalhado".
export type DetailLevel = "resumido" | "detalhado";
export const DETAIL_LEVELS: { key: DetailLevel; label: string; hint: string }[] = [
  { key: "resumido", label: "Resumido", hint: "O essencial, poucos itens por seção" },
  { key: "detalhado", label: "Detalhado", hint: "Tudo que foi tratado no período" },
];
export const LEVEL_LABEL: Record<DetailLevel, string> = { resumido: "Resumido", detalhado: "Detalhado" };

export interface GroupSummary {
  id: string;
  conversation_id: string;
  filter_type: FilterType;
  detail_level: DetailLevel;
  attendance_id: string | null;
  period_start: string;
  period_end: string;
  status: "generating" | "ready" | "failed";
  error_message: string | null;
  message_count: number;
  parts: number;
  sections: Sections | null;
  created_by: string;
  created_at: string;
  finished_at: string | null;
  edited_by: string | null;
  edited_at: string | null;
}

export interface SummaryFilter {
  filterType: FilterType;
  periodStart?: string;
  periodEnd?: string;
  attendanceId?: string | null;
}

export interface SummaryDuplicate {
  id: string;
  created_at: string;
  created_by_name: string | null;
}

export interface SummaryPreview {
  message_count: number;
  participants: number;
  audio_transcribed: number;
  audio_untranscribed: number;
  parts: number;
  period_start: string;
  period_end: string;
  duplicate: SummaryDuplicate | null;
  /** Um por nivel: gerar resumido nao esbarra no detalhado do mesmo periodo. */
  duplicates?: Partial<Record<DetailLevel, SummaryDuplicate | null>>;
}

async function invokeSummarize<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("summarize-whatsapp-group", { body });
  if (error) {
    // FunctionsHttpError: sem ler o context o usuario so veria "non-2xx status".
    const corpo = await (error as any)?.context?.json?.().catch?.(() => null);
    throw new Error(corpo?.message || "Não foi possível falar com o serviço de resumo.");
  }
  return data as T;
}

export function countPending(s: Sections | null) {
  return {
    cliente: s?.pendencias_cliente?.length ?? 0,
    interna: s?.pendencias_internas?.length ?? 0,
    decisoes: s?.decisoes?.length ?? 0,
  };
}

/** Resumos do grupo, mais novo primeiro. Enquanto algum gera, rele a cada 2s. */
export function useGroupSummaries(conversationId: string | null) {
  const query = useQuery({
    queryKey: ["group-summaries", conversationId],
    enabled: !!conversationId,
    queryFn: async () =>
      fetchAllRows<GroupSummary>(() =>
        (supabase.from("whatsapp_group_summaries" as any) as any)
          .select("id, conversation_id, filter_type, detail_level, attendance_id, period_start, period_end, status, error_message, message_count, parts, sections, created_by, created_at, finished_at, edited_by, edited_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
      ),
    refetchInterval: (q) =>
      (q.state.data as GroupSummary[] | undefined)?.some((s) => s.status === "generating") ? 2000 : false,
  });

  const summaries = query.data ?? [];
  const userIds = [...new Set(summaries.flatMap((s) => [s.created_by, s.edited_by]).filter(Boolean))] as string[];
  const names = useUserFirstNames(userIds);

  return { summaries, isLoading: query.isLoading, names };
}

/** user_id -> primeiro nome (profiles.funcionario_id -> funcionarios.nome). */
function useUserFirstNames(userIds: string[]) {
  const key = [...userIds].sort().join(",");
  const { data } = useQuery({
    queryKey: ["group-summary-user-names", key],
    enabled: userIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: profs } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionario_id")
        .in("user_id", userIds);
      const funcIds = (profs ?? []).map((p: any) => p.funcionario_id).filter(Boolean);
      const { data: funcs } = funcIds.length
        ? await (supabase.from("funcionarios" as any) as any).select("id, nome").in("id", funcIds)
        : { data: [] };
      const byFunc = new Map((funcs ?? []).map((f: any) => [f.id, String(f.nome ?? "").trim().split(/\s+/)[0]]));
      const out: Record<string, string> = {};
      for (const p of profs ?? []) {
        const n = byFunc.get(p.funcionario_id);
        if (n) out[p.user_id] = n as string;
      }
      return out;
    },
  });
  return data ?? {};
}

/** Contagem do que entra no periodo e aviso de resumo repetido. Nao chama IA. */
export function useSummaryPreview(conversationId: string | null, filter: SummaryFilter | null) {
  return useQuery({
    queryKey: ["group-summary-preview", conversationId, filter],
    enabled: !!conversationId && !!filter,
    staleTime: 30_000,
    retry: false,
    queryFn: () => invokeSummarize<SummaryPreview>({ action: "preview", conversationId, ...filter }),
  });
}

export function useGroupSummaryActions(conversationId: string | null) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["group-summaries", conversationId] });

  const generate = useMutation({
    mutationFn: ({ detailLevel, ...filter }: SummaryFilter & { detailLevel: DetailLevel }) =>
      invokeSummarize<{ id: string }>({ action: "generate", conversationId, detailLevel, ...filter }),
    onSettled: refresh,
  });

  const saveEdit = useMutation({
    mutationFn: async ({ id, sections }: { id: string; sections: Sections }) => {
      const { error } = await (supabase.rpc as any)("wa_group_summary_save_edit", { p_id: id, p_sections: sections });
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("wa_group_summary_delete", { p_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });

  return { generate, saveEdit, remove };
}
