// Dados do Envio em lote (DEM-0492).
//
// Toda escrita passa pelas RPCs `fn_bulk_send_create` / `fn_bulk_send_cancel`
// (migration 20260930100100): quem pode disparar, o ritmo e o portão por
// empresa moram lá. Aqui é só leitura e chamada.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { sugerirNomeNaMensagem } from "./nomeNaMensagem";

/** Ritmo padrão: um intervalo sorteado entre 5 e 30 s entre uma mensagem e a próxima. */
export const RITMO_PADRAO = { min: 5, max: 30 };

export interface EnvioLote {
  id: string;
  tenant_id: string;
  instance_id: string;
  created_by: string;
  titulo: string;
  content: string;
  message_type: "text" | "document";
  media_file_name: string | null;
  intervalo_min_s: number;
  intervalo_max_s: number;
  total: number;
  inicio_em: string;
  fim_previsto_em: string;
  canceled_at: string | null;
  created_at: string;
  pendentes: number;
  enviando: number;
  enviadas: number;
  falharam: number;
  canceladas: number;
}

export interface ItemEnvioLote {
  id: string;
  status: "pending" | "sending" | "sent" | "failed" | "canceled";
  scheduled_at: string;
  sent_at: string | null;
  last_error: string | null;
  attempts: number;
  conversation_id: string;
  nome: string;
  /** Texto como o cliente recebeu: {nome_cliente} já trocado, sem assinatura. */
  content: string;
  media_file_name: string | null;
  /** Mensagem gravada no chat quando saiu; é por ela que o PDF abre e baixa. */
  sent_message_id: string | null;
}

export type OrigemDestino = "grupos" | "contatos" | "clientes";

export interface Destino {
  conversationId: string;
  contactId: string;
  nomeContato: string;
  ehGrupo: boolean;
  nomeSugerido: string;
  clienteId: string | null;
  clienteNome: string | null;
  segmentoId: number | null;
}

/** Quem vê o botão: admin/head (ou super admin) numa empresa com o envio liberado. */
export function useEnvioLoteAcesso() {
  const { profile } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const ehSuper = profile?.is_super_admin === true;
  const role = profile?.role ?? "";
  const papelOk = ehSuper || role === "admin" || role === "head";

  const q = useQuery<boolean>({
    queryKey: ["envio-lote-liberado", effectiveTenantId],
    enabled: papelOk && !!effectiveTenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("tenants" as any) as any)
        .select("envio_lote_enabled")
        .eq("id", effectiveTenantId)
        .maybeSingle();
      if (error) return false;
      return !!(data as any)?.envio_lote_enabled;
    },
  });

  return {
    pode: papelOk && !!effectiveTenantId && q.data === true,
    // Só admin mexe no ritmo (decisão de 29/09). Head dispara no padrão.
    mudaRitmo: ehSuper || role === "admin",
    carregando: papelOk && !!effectiveTenantId && q.isLoading,
  };
}

export function useEnviosLote() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<EnvioLote[]>({
    queryKey: ["envio-lote", "lista", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("vw_whatsapp_bulk_sends" as any) as any)
        .select("*")
        .eq("tenant_id", tid)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as EnvioLote[];
    },
    // Enquanto algum lote está saindo, a lista acompanha. Parado, não consulta.
    refetchInterval: (query) => {
      const lista = (query.state.data || []) as EnvioLote[];
      return lista.some((e) => e.pendentes + e.enviando > 0) ? 5000 : false;
    },
  });
}

export function useItensEnvioLote(envioId: string | null) {
  return useQuery<ItemEnvioLote[]>({
    queryKey: ["envio-lote", "itens", envioId],
    enabled: !!envioId,
    queryFn: async () => {
      const linhas = await fetchAllRows<any>(() =>
        (supabase.from("whatsapp_scheduled_messages" as any) as any)
          .select("id, status, scheduled_at, sent_at, last_error, attempts, conversation_id, content, media_file_name, sent_message_id, whatsapp_conversations(whatsapp_contacts(name))")
          .eq("bulk_send_id", envioId)
          .order("scheduled_at", { ascending: true }),
      );
      return linhas.map((l) => ({
        id: l.id,
        status: l.status,
        scheduled_at: l.scheduled_at,
        sent_at: l.sent_at,
        last_error: l.last_error,
        attempts: l.attempts,
        conversation_id: l.conversation_id,
        nome: l.whatsapp_conversations?.whatsapp_contacts?.name || "Sem nome",
        content: l.content || "",
        media_file_name: l.media_file_name ?? null,
        sent_message_id: l.sent_message_id ?? null,
      }));
    },
    refetchInterval: (query) => {
      const itens = (query.state.data || []) as ItemEnvioLote[];
      return itens.some((i) => i.status === "pending" || i.status === "sending") ? 3000 : false;
    },
  });
}

/**
 * Conversas que podem receber pelo número escolhido. Grupo só recebe do número
 * que está dentro dele, então a lista é sempre a das conversas daquele número
 * (a RPC confere de novo).
 */
export function useDestinosLote(instanceId: string | null) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<{ destinos: Destino[]; segmentos: { id: number; nome: string }[] }>({
    queryKey: ["envio-lote", "destinos", tid, instanceId],
    enabled: !!tid && !!instanceId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [convs, tenantRes] = await Promise.all([
        fetchAllRows<any>(() =>
          (supabase.from("whatsapp_conversations") as any)
            .select("id, instance_id, current_instance_id, is_group, whatsapp_contacts!inner(id, name, is_active, cliente_id, nome_na_mensagem)")
            .eq("tenant_id", tid)
            .order("last_message_at", { ascending: false, nullsFirst: false }),
        ),
        (supabase.from("tenants" as any) as any).select("nome").eq("id", tid).maybeSingle(),
      ]);
      const nomeEmpresa = (tenantRes as any)?.data?.nome ?? null;

      const doNumero = convs.filter(
        (c) =>
          (c.instance_id === instanceId || c.current_instance_id === instanceId) &&
          c.whatsapp_contacts?.is_active !== false,
      );

      // Uma conversa por contato: a mais recente (a lista já vem nessa ordem).
      const vistos = new Set<string>();
      const unicas = doNumero.filter((c) => {
        const k = c.whatsapp_contacts.id;
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      });

      const clienteIds = [...new Set(unicas.map((c) => c.whatsapp_contacts.cliente_id).filter(Boolean))] as string[];
      const clientes = new Map<string, { nome: string; segmento_id: number | null }>();
      for (let i = 0; i < clienteIds.length; i += 200) {
        const { data } = await (supabase.from("clientes") as any)
          .select("id, nome_fantasia, razao_social, segmento_id")
          .eq("tenant_id", tid)
          .in("id", clienteIds.slice(i, i + 200));
        for (const c of data || []) {
          clientes.set(c.id, { nome: c.nome_fantasia || c.razao_social || "", segmento_id: c.segmento_id ?? null });
        }
      }

      let segmentos: { id: number; nome: string }[] = [];
      if (clientes.size > 0) {
        const usados = [...new Set([...clientes.values()].map((c) => c.segmento_id).filter((s) => s != null))];
        if (usados.length) {
          const { data } = await (supabase.from("segmentos") as any).select("id, nome").in("id", usados).order("nome");
          segmentos = data || [];
        }
      }

      const destinos: Destino[] = unicas.map((c) => {
        const ct = c.whatsapp_contacts;
        const cli = ct.cliente_id ? clientes.get(ct.cliente_id) : undefined;
        const ehGrupo = c.is_group === true;
        return {
          conversationId: c.id,
          contactId: ct.id,
          nomeContato: ct.name || "Sem nome",
          ehGrupo,
          nomeSugerido: sugerirNomeNaMensagem({
            nomeContato: ct.name,
            ehGrupo,
            nomeEmpresa,
            nomeGuardado: ct.nome_na_mensagem,
          }),
          clienteId: ct.cliente_id ?? null,
          clienteNome: cli?.nome || null,
          segmentoId: cli?.segmento_id ?? null,
        };
      });

      destinos.sort((a, b) => a.nomeContato.localeCompare(b.nomeContato, "pt-BR"));
      return { destinos, segmentos };
    },
  });
}

export interface NovoEnvio {
  instanceId: string;
  conteudo: string;
  destinos: { conversation_id: string; nome: string }[];
  anexo: { storagePath: string; mime: string; nome: string; tamanho: number } | null;
  intervaloMin: number;
  intervaloMax: number;
  inicioEm: Date | null;
}

export function useCriarEnvioLote() {
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  return useMutation({
    mutationFn: async (e: NovoEnvio) => {
      const { data, error } = await (supabase.rpc as any)("fn_bulk_send_create", {
        p_tenant_id: tid,
        p_instance_id: e.instanceId,
        p_content: e.conteudo,
        p_destinos: e.destinos,
        p_storage_path: e.anexo?.storagePath ?? null,
        p_media_mimetype: e.anexo?.mime ?? null,
        p_media_file_name: e.anexo?.nome ?? null,
        p_media_size_bytes: e.anexo?.tamanho ?? null,
        p_intervalo_min_s: e.intervaloMin,
        p_intervalo_max_s: e.intervaloMax,
        p_inicio_em: e.inicioEm ? e.inicioEm.toISOString() : null,
        p_titulo: null,
      });
      if (error) throw new Error(error.message);
      return data as { bulk_send_id: string; total: number; inicio_em: string; fim_previsto_em: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["envio-lote"] });
    },
  });
}

export function useCancelarEnvioLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (envioId: string) => {
      const { data, error } = await (supabase.rpc as any)("fn_bulk_send_cancel", { p_bulk_send_id: envioId });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["envio-lote"] });
    },
  });
}

/** Sobe o PDF para <tenant>/lote/ pela edge function (upload direto não funciona neste projeto). */
export async function subirPdfDoLote(tenantId: string, arquivo: File) {
  const mime = arquivo.type || "application/pdf";
  const { data, error } = await supabase.functions.invoke("get-media-upload-url", {
    body: { tenantId, pasta: "lote", mediaMimetype: mime, fileName: arquivo.name },
  });
  if (error) {
    // Resposta não-2xx: o motivo está no corpo, não em `error.message`
    // ("Edge Function returned a non-2xx status code").
    let motivo = "";
    try { motivo = (await (error as any).context?.json())?.error || ""; } catch { /* corpo não é JSON */ }
    throw new Error(motivo ? `Falha ao preparar o upload do PDF: ${motivo}` : "Falha ao preparar o upload do PDF.");
  }
  if (!data?.path || !data?.token) throw new Error(data?.error || "Falha ao preparar o upload do PDF.");
  if (!String(data.path).includes("/lote/")) {
    // A edge function antiga ignora `pasta` e manda para emails/, que a
    // purge-email-anexos limpa. Melhor falhar aqui do que perder o anexo depois.
    throw new Error("O servidor ainda não aceita anexo de envio em lote. Tente de novo em alguns minutos.");
  }
  const { error: erroUpload } = await supabase.storage
    .from("whatsapp-media")
    .uploadToSignedUrl(data.path as string, data.token as string, arquivo, { contentType: mime });
  if (erroUpload) throw new Error(erroUpload.message || "Falha no upload do PDF.");
  return { storagePath: data.path as string, mime, nome: arquivo.name, tamanho: arquivo.size };
}
