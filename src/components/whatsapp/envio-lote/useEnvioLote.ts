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
import { chaveTelefone, telefoneValido } from "./destinosAvulsos";

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

export type OrigemDestino = "grupos" | "contatos" | "clientes" | "avulso";

export interface Destino {
  /** Chave da seleção: "conv:<id>" para grupo, "tel:<telefone sem o 9>" para pessoa. */
  chave: string;
  tipo: OrigemDestino;
  /** Só grupo: grupo só recebe do número que está dentro dele. */
  conversationId: string | null;
  /** Pessoa: normalizado (55 + DDD + número). A RPC acha ou cria a conversa. */
  telefone: string | null;
  contactId: string | null;
  nomeContato: string;
  ehGrupo: boolean;
  nomeSugerido: string;
  clienteId: string | null;
  clienteNome: string | null;
  segmentoId: number | null;
  clienteCancelado: boolean;
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
 * Quem pode receber o lote.
 *
 * - Grupos: as conversas de grupo do número escolhido. Grupo só recebe do
 *   número que está dentro dele, então esta é a única lista que muda com o número.
 * - Contatos e Clientes: o tenant inteiro, por telefone. Não importa por qual
 *   número a pessoa conversou antes: a RPC acha a conversa no número escolhido
 *   ou cria uma (fechada, sem dono).
 */
export function useDestinosLote(instanceId: string | null) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const pessoas = useQuery<{ contatos: Destino[]; clientes: Destino[]; segmentos: { id: number; nome: string }[] }>({
    queryKey: ["envio-lote", "pessoas", tid],
    enabled: !!tid,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [contatos, clientes, tenantRes] = await Promise.all([
        fetchAllRows<any>(() =>
          (supabase.from("whatsapp_contacts") as any)
            .select("id, name, phone_number, cliente_id, nome_na_mensagem")
            .eq("tenant_id", tid)
            .eq("is_group", false)
            .eq("is_active", true)
            .order("id"),
        ),
        fetchAllRows<any>(() =>
          (supabase.from("clientes") as any)
            .select("id, nome_fantasia, razao_social, segmento_id, cancelado, telefone_whatsapp, telefone_whatsapp_contato, contato_nome")
            .eq("tenant_id", tid)
            .order("id"),
        ),
        (supabase.from("tenants" as any) as any).select("nome").eq("id", tid).maybeSingle(),
      ]);
      const nomeEmpresa = (tenantRes as any)?.data?.nome ?? null;

      const cliPorId = new Map<string, any>(clientes.map((c) => [c.id, c]));
      const nomeCliente = (c: any) => (c?.nome_fantasia || c?.razao_social || "").trim() || null;

      // Contato: só telefone de verdade. LID (14-15 dígitos) não é número.
      const listaContatos: Destino[] = [];
      const contatosPorCliente = new Map<string, Destino[]>();
      const vistos = new Set<string>();
      for (const ct of contatos) {
        const tel = String(ct.phone_number || "").replace(/\D/g, "");
        if (tel.length < 10 || tel.length > 13) continue;
        const chave = "tel:" + chaveTelefone(tel);
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        const cli = ct.cliente_id ? cliPorId.get(ct.cliente_id) : null;
        const d: Destino = {
          chave,
          tipo: "contatos",
          conversationId: null,
          telefone: tel,
          contactId: ct.id,
          nomeContato: ct.name && ct.name !== ct.phone_number ? ct.name : "Sem nome",
          ehGrupo: false,
          nomeSugerido: sugerirNomeNaMensagem({ nomeContato: ct.name !== ct.phone_number ? ct.name : "", ehGrupo: false, nomeEmpresa, nomeGuardado: ct.nome_na_mensagem }),
          clienteId: cli?.id ?? null,
          clienteNome: nomeCliente(cli),
          segmentoId: cli?.segmento_id ?? null,
          clienteCancelado: cli?.cancelado === true,
        };
        listaContatos.push(d);
        if (cli) contatosPorCliente.set(cli.id, [...(contatosPorCliente.get(cli.id) || []), d]);
      }

      // Cliente: os contatos de WhatsApp ligados a ele; sem nenhum, o WhatsApp
      // do cadastro. Sem telefone nenhum, aparece desabilitado para a conferência.
      const listaClientes: Destino[] = [];
      for (const c of clientes) {
        const ligados = contatosPorCliente.get(c.id);
        if (ligados?.length) {
          ligados.forEach((d) => listaClientes.push({ ...d, tipo: "clientes" }));
          continue;
        }
        const tel = telefoneValido(c.telefone_whatsapp || "") || telefoneValido(c.telefone_whatsapp_contato || "");
        const nome = nomeCliente(c) || "Sem nome";
        listaClientes.push({
          chave: tel ? "tel:" + chaveTelefone(tel) : "sem-tel:" + c.id,
          tipo: "clientes",
          conversationId: null,
          telefone: tel,
          contactId: null,
          nomeContato: (c.contato_nome || "").trim() || nome,
          ehGrupo: false,
          nomeSugerido: sugerirNomeNaMensagem({ nomeContato: (c.contato_nome || "").trim() || nome, ehGrupo: false, nomeEmpresa }),
          clienteId: c.id,
          clienteNome: nome,
          segmentoId: c.segmento_id ?? null,
          clienteCancelado: c.cancelado === true,
        });
      }

      let segmentos: { id: number; nome: string }[] = [];
      const usados = [...new Set(clientes.map((c) => c.segmento_id).filter((s) => s != null))];
      if (usados.length) {
        const { data } = await (supabase.from("segmentos") as any).select("id, nome").in("id", usados).order("nome");
        segmentos = data || [];
      }

      const porNome = (a: Destino, b: Destino) =>
        (a.clienteNome || a.nomeContato).localeCompare(b.clienteNome || b.nomeContato, "pt-BR");
      listaContatos.sort((a, b) => a.nomeContato.localeCompare(b.nomeContato, "pt-BR"));
      listaClientes.sort(porNome);
      return { contatos: listaContatos, clientes: listaClientes, segmentos };
    },
  });

  const grupos = useQuery<Destino[]>({
    queryKey: ["envio-lote", "grupos", tid, instanceId],
    enabled: !!tid && !!instanceId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [convs, tenantRes] = await Promise.all([
        fetchAllRows<any>(() =>
          (supabase.from("whatsapp_conversations") as any)
            .select("id, instance_id, current_instance_id, whatsapp_contacts!inner(id, name, is_active, nome_na_mensagem)")
            .eq("tenant_id", tid)
            .eq("is_group", true)
            .order("last_message_at", { ascending: false, nullsFirst: false }),
        ),
        (supabase.from("tenants" as any) as any).select("nome").eq("id", tid).maybeSingle(),
      ]);
      const nomeEmpresa = (tenantRes as any)?.data?.nome ?? null;
      const vistos = new Set<string>();
      const lista: Destino[] = [];
      for (const c of convs) {
        const ct = c.whatsapp_contacts;
        if (c.instance_id !== instanceId && c.current_instance_id !== instanceId) continue;
        if (ct?.is_active === false || vistos.has(ct.id)) continue;
        vistos.add(ct.id);
        lista.push({
          chave: "conv:" + c.id,
          tipo: "grupos",
          conversationId: c.id,
          telefone: null,
          contactId: ct.id,
          nomeContato: ct.name || "Sem nome",
          ehGrupo: true,
          nomeSugerido: sugerirNomeNaMensagem({ nomeContato: ct.name, ehGrupo: true, nomeEmpresa, nomeGuardado: ct.nome_na_mensagem }),
          clienteId: null,
          clienteNome: null,
          segmentoId: null,
          clienteCancelado: false,
        });
      }
      lista.sort((a, b) => a.nomeContato.localeCompare(b.nomeContato, "pt-BR"));
      return lista;
    },
  });

  return {
    grupos: grupos.data ?? [],
    contatos: pessoas.data?.contatos ?? [],
    clientes: pessoas.data?.clientes ?? [],
    segmentos: pessoas.data?.segmentos ?? [],
    carregandoGrupos: grupos.isLoading,
    carregandoPessoas: pessoas.isLoading,
  };
}

/** Item de p_destinos da fn_bulk_send_create: grupo por conversa, pessoa por telefone. */
export type DestinoRpc =
  | { conversation_id: string; nome: string }
  | { telefone: string; nome: string; nome_contato?: string; cliente_id?: string | null };

export interface NovoEnvio {
  instanceId: string;
  conteudo: string;
  destinos: DestinoRpc[];
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
      return data as {
        bulk_send_id: string; total: number; inicio_em: string; fim_previsto_em: string;
        ignorados?: { telefone: string; nome: string | null; motivo: string }[];
      };
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
