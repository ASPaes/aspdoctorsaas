// Dados das fases 2 a 5 do Envio em lote (DEM-0492): grupos de envio, mensagens
// prontas, recorrência, descadastrados, funil e limite por número.
//
// Toda escrita passa pelas RPCs da migration 20261002100100 (permissão, portão
// e regras moram lá). Aqui é só leitura e chamada.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { fetchAllRows } from "@/lib/supabasePaginate";
import type { FiltrosClientes } from "@/lib/filtrosClientes";

const rpc = async <T,>(nome: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await (supabase.rpc as any)(nome, args);
  if (error) throw new Error(error.message);
  return data as T;
};

// ---------------------------------------------------------------------------
// Grupos de envio (F3)
// ---------------------------------------------------------------------------
export interface GrupoEnvio {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: "fixa" | "dinamica";
  filtros: FiltrosClientes | null;
  membros: number;
  updated_at: string;
  last_used_at: string | null;
}

export interface MembroGrupo {
  member_id: string | null;
  conversation_id: string | null;
  telefone: string | null;
  nome_contato: string | null;
  nome_na_mensagem: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  vars: Record<string, string> | null;
  eh_grupo: boolean;
  instancia_ok: boolean;
}

/** Item de p_membros da fn_bulk_list_save. */
export type MembroParaSalvar =
  | { conversation_id: string; nome_contato?: string; nome_na_mensagem?: string }
  | { telefone: string; nome_contato?: string; nome_na_mensagem?: string; cliente_id?: string | null; vars?: Record<string, string> | null };

export function useGruposEnvio() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<GrupoEnvio[]>({
    queryKey: ["envio-lote", "grupos-envio", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("whatsapp_bulk_lists" as any) as any)
        .select("id, nome, descricao, tipo, filtros, updated_at, last_used_at, whatsapp_bulk_list_members(count)")
        .eq("tenant_id", tid)
        .order("nome");
      if (error) throw error;
      return (data || []).map((l: any) => ({
        ...l,
        membros: l.whatsapp_bulk_list_members?.[0]?.count ?? 0,
      }));
    },
  });
}

/** Quem está no grupo agora (dinâmico: resolvido pelos filtros na hora). */
export function useMembrosGrupo(listId: string | null, instanceId: string | null) {
  return useQuery<MembroGrupo[]>({
    queryKey: ["envio-lote", "membros", listId, instanceId],
    enabled: !!listId,
    queryFn: () => rpc<MembroGrupo[]>("fn_bulk_list_resolve", { p_list_id: listId, p_instance_id: instanceId }),
  });
}

export async function resolverGrupo(listId: string, instanceId: string | null) {
  return rpc<MembroGrupo[]>("fn_bulk_list_resolve", { p_list_id: listId, p_instance_id: instanceId });
}

export function useSalvarGrupo() {
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  return useMutation({
    mutationFn: (g: {
      id?: string | null; nome: string; descricao?: string | null; tipo?: "fixa" | "dinamica";
      filtros?: FiltrosClientes | null; membros?: MembroParaSalvar[] | null; modo?: "substituir" | "adicionar";
    }) =>
      rpc<string>("fn_bulk_list_save", {
        p_tenant_id: tid,
        p_list_id: g.id ?? null,
        p_nome: g.nome,
        p_descricao: g.descricao ?? null,
        p_tipo: g.tipo ?? "fixa",
        p_filtros: g.filtros ?? null,
        p_membros: g.membros ?? null,
        p_modo: g.modo ?? "substituir",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote"] }),
  });
}

export function useRemoverMembros() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { listId: string; ids: string[] }) =>
      rpc<number>("fn_bulk_list_remove_members", { p_list_id: a.listId, p_member_ids: a.ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote"] }),
  });
}

export function useApagarGrupo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<void>("fn_bulk_list_delete", { p_list_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote"] }),
  });
}

// ---------------------------------------------------------------------------
// Mensagens prontas (F4)
// ---------------------------------------------------------------------------
export interface MensagemPronta {
  id: string;
  titulo: string;
  content: string;
  storage_path: string | null;
  media_mimetype: string | null;
  media_file_name: string | null;
  media_size_bytes: number | null;
  template_id: string | null;
  template_params: string[] | Record<string, string> | null;
  updated_at: string;
}

export function useMensagensProntas() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<MensagemPronta[]>({
    queryKey: ["envio-lote", "modelos", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("whatsapp_bulk_models" as any) as any)
        .select("id, titulo, content, storage_path, media_mimetype, media_file_name, media_size_bytes, template_id, template_params, updated_at")
        .eq("tenant_id", tid)
        .order("titulo");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useSalvarMensagemPronta() {
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  return useMutation({
    mutationFn: (m: {
      id?: string | null; titulo: string; content: string;
      anexo?: { storagePath: string; mime: string; nome: string; tamanho: number } | null;
      templateId?: string | null; templateParams?: string[] | Record<string, string> | null;
    }) =>
      rpc<string>("fn_bulk_model_save", {
        p_tenant_id: tid,
        p_model_id: m.id ?? null,
        p_titulo: m.titulo,
        p_content: m.content,
        p_storage_path: m.anexo?.storagePath ?? null,
        p_media_mimetype: m.anexo?.mime ?? null,
        p_media_file_name: m.anexo?.nome ?? null,
        p_media_size_bytes: m.anexo?.tamanho ?? null,
        p_template_id: m.templateId ?? null,
        p_template_params: m.templateParams ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote", "modelos"] }),
  });
}

export function useApagarMensagemPronta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<void>("fn_bulk_model_delete", { p_model_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote", "modelos"] }),
  });
}

// ---------------------------------------------------------------------------
// Recorrência (F4)
// ---------------------------------------------------------------------------
export type Frequencia = "mensal" | "semanal" | "diaria";
export type AjusteDiaUtil = "proximo" | "anterior" | "manter";

export interface Recorrencia {
  id: string;
  titulo: string;
  ativo: boolean;
  instance_id: string;
  list_id: string;
  model_id: string;
  frequencia: Frequencia;
  dia_mes: number | null;
  dias_semana: number[] | null;
  hora: string;
  ajuste_dia_util: AjusteDiaUtil;
  intervalo_min_s: number;
  intervalo_max_s: number;
  proxima_em: string | null;
  ultima_em: string | null;
  ultimo_bulk_id: string | null;
  ultimo_erro: string | null;
  lista_nome: string | null;
  modelo_titulo: string | null;
}

export interface RegraRecorrencia {
  frequencia: Frequencia;
  diaMes: number;
  diasSemana: number[];
  hora: string; // "HH:mm"
  ajuste: AjusteDiaUtil;
}

export function useRecorrencias() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<Recorrencia[]>({
    queryKey: ["envio-lote", "recorrencias", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("whatsapp_bulk_recurrences" as any) as any)
        .select("*, whatsapp_bulk_lists(nome), whatsapp_bulk_models(titulo)")
        .eq("tenant_id", tid)
        .order("proxima_em", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []).map((r: any) => ({
        ...r,
        lista_nome: r.whatsapp_bulk_lists?.nome ?? null,
        modelo_titulo: r.whatsapp_bulk_models?.titulo ?? null,
      }));
    },
  });
}

export function useSalvarRecorrencia() {
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  return useMutation({
    mutationFn: (r: {
      id?: string | null; titulo: string; instanceId: string; listId: string; modelId: string;
      regra: RegraRecorrencia; intervaloMin: number; intervaloMax: number; ativo?: boolean;
    }) =>
      rpc<{ id: string; proxima_em: string }>("fn_bulk_recurrence_save", {
        p_tenant_id: tid,
        p_id: r.id ?? null,
        p_titulo: r.titulo,
        p_instance_id: r.instanceId,
        p_list_id: r.listId,
        p_model_id: r.modelId,
        p_frequencia: r.regra.frequencia,
        p_dia_mes: r.regra.frequencia === "mensal" ? r.regra.diaMes : null,
        p_dias_semana: r.regra.frequencia === "semanal" ? r.regra.diasSemana : null,
        p_hora: r.regra.hora,
        p_ajuste: r.regra.ajuste,
        p_intervalo_min_s: r.intervaloMin,
        p_intervalo_max_s: r.intervaloMax,
        p_ativo: r.ativo ?? true,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote"] }),
  });
}

export function useAtivarRecorrencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string; ativo: boolean }) => rpc<string | null>("fn_bulk_recurrence_set_active", { p_id: a.id, p_ativo: a.ativo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote", "recorrencias"] }),
  });
}

export function useApagarRecorrencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<void>("fn_bulk_recurrence_delete", { p_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote", "recorrencias"] }),
  });
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "Todo dia 10, às 09:00 (fim de semana ou feriado: próximo dia útil)". */
export function descreverRegra(r: { frequencia: Frequencia; dia_mes?: number | null; dias_semana?: number[] | null; hora: string; ajuste_dia_util?: AjusteDiaUtil }) {
  const hora = r.hora.slice(0, 5);
  let base = "";
  if (r.frequencia === "mensal") base = r.dia_mes === 31 ? `Todo último dia do mês, às ${hora}` : `Todo dia ${r.dia_mes} do mês, às ${hora}`;
  else if (r.frequencia === "semanal") base = `Toda ${(r.dias_semana || []).slice().sort().map((d) => DIAS[d]).join(", ")}, às ${hora}`;
  else base = `Todo dia útil, às ${hora}`;
  if (r.frequencia === "diaria" || !r.ajuste_dia_util) return base;
  const aj = { proximo: "vai para o próximo dia útil", anterior: "volta para o dia útil anterior", manter: "sai assim mesmo" }[r.ajuste_dia_util];
  return `${base}. Se cair em fim de semana ou feriado, ${aj}.`;
}

// ---------------------------------------------------------------------------
// Descadastrados, limite por número e funil (F5)
// ---------------------------------------------------------------------------
export interface Descadastrado {
  id: string;
  telefone: string;
  nome: string | null;
  origem: "resposta" | "manual";
  mensagem: string | null;
  created_at: string;
}

export function useDescadastrados() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<Descadastrado[]>({
    queryKey: ["envio-lote", "descadastrados", tid],
    enabled: !!tid,
    queryFn: () =>
      fetchAllRows<Descadastrado>(() =>
        (supabase.from("whatsapp_bulk_optouts" as any) as any)
          .select("id, telefone, nome, origem, mensagem, created_at")
          .eq("tenant_id", tid)
          .order("created_at", { ascending: false }),
      ),
  });
}

export function useDescadastrar() {
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  return useMutation({
    mutationFn: (a: { telefone: string; nome?: string }) =>
      rpc<void>("fn_bulk_optout_save", { p_tenant_id: tid, p_telefone: a.telefone, p_nome: a.nome ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote", "descadastrados"] }),
  });
}

export function useRecadastrar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<void>("fn_bulk_optout_delete", { p_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envio-lote", "descadastrados"] }),
  });
}

export function useLimiteNumero() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { instanceId: string; limite: number | null }) =>
      rpc<void>("fn_bulk_instance_limit", { p_instance_id: a.instanceId, p_limite: a.limite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "instances"] }),
  });
}

export interface Funil {
  enviadas: number;
  entregues: number;
  lidas: number;
  responderam: number;
  responderam_ids: string[];
}

export function useFunil(envioId: string | null, ativo: boolean) {
  return useQuery<Funil | null>({
    queryKey: ["envio-lote", "funil", envioId],
    enabled: !!envioId,
    queryFn: () => rpc<Funil | null>("fn_bulk_send_funil", { p_bulk_send_id: envioId }),
    // Entregue/lida/respondeu mudam depois que a mensagem sai.
    refetchInterval: ativo ? 15000 : 60000,
  });
}

/** Templates aprovados do número oficial. */
export function useTemplatesAprovados(instanceId: string | null, ehMeta: boolean) {
  return useQuery<any[]>({
    queryKey: ["envio-lote", "templates", instanceId],
    enabled: !!instanceId && ehMeta,
    queryFn: async () => {
      const { data, error } = await (supabase.from("whatsapp_meta_templates" as any) as any)
        .select("id, name, language, category, status, body_text, header_type, components")
        .eq("instance_id", instanceId)
        .eq("status", "APPROVED")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });
}
