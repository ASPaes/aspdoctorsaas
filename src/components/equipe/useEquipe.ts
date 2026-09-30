import { useCallback, useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeSharedChannel } from "@/lib/realtimeChannelPool";
import type { Anexo, Conversa, Mensagem, Pessoa, CanalAberto, Fio, MensagemComCanal, Ref, Cartao } from "./tipos";
import { alternarReacao, atualizarMensagem, mesclarMensagem, previaDe, type PaginasMsgs } from "./equipeUtils";

// Tabelas e RPCs ainda fora do types.ts gerado.
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any)(fn, args);
const tabela = (nome: string) => (supabase.from(nome as any) as any);

export const chaves = {
  conversas: (tid: string | null) => ["equipe", "conversas", tid] as const,
  pessoas: (tid: string | null) => ["equipe", "pessoas", tid] as const,
  msgs: (canalId: string | null) => ["equipe", "msgs", canalId] as const,
  /** respostas de um fio: mesmo formato paginado (uma página, decrescente) */
  fio: (raizId: string | null) => ["equipe", "fio", raizId] as const,
  fios: (tid: string | null) => ["equipe", "fios", tid] as const,
  fixadas: (canalId: string | null) => ["equipe", "fixadas", canalId] as const,
  salvos: (tid: string | null) => ["equipe", "salvos", tid] as const,
  abertos: (tid: string | null) => ["equipe", "abertos", tid] as const,
};

const POR_PAGINA = 50;

// ------------------------------------------------------------------ leitura

export function useEquipeConversas() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: chaves.conversas(tid),
    enabled: !!tid,
    staleTime: 30_000,
    queryFn: async (): Promise<Conversa[]> => {
      const { data, error } = await rpc("equipe_minhas_conversas", { p_tenant_id: tid });
      if (error) throw error;
      return (data ?? []) as Conversa[];
    },
  });
}

export function useMeusFios() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: chaves.fios(tid),
    enabled: !!tid,
    staleTime: 30_000,
    queryFn: async (): Promise<Fio[]> => {
      const { data, error } = await rpc("equipe_meus_fios", { p_tenant_id: tid });
      if (error) throw error;
      return (data ?? []) as Fio[];
    },
  });
}

/**
 * Total para o menu: não lidas fora das conversas silenciadas, menções sempre, e fios.
 * `soPessoal` (tela inicial do celular): só o que está no nome da pessoa, ou seja,
 * conversa direta, menção e fio. Canal aberto não conta ali (regra de 26/09).
 */
export function useEquipeNaoLidas(opts: { soPessoal?: boolean } = {}): number {
  const { data } = useEquipeConversas();
  const { data: fios } = useMeusFios();
  const soPessoal = !!opts.soPessoal;
  return useMemo(
    () => (data ?? []).reduce((s, c) => {
      const direta = c.tipo === "dm" || c.tipo === "grupo";
      if (soPessoal) return s + (direta && !c.silenciado ? c.nao_lidas : c.mencoes);
      return s + (c.silenciado ? c.mencoes : c.nao_lidas);
    }, 0) + (fios ?? []).reduce((s, f) => s + f.nao_lidas, 0),
    [data, fios, soPessoal],
  );
}

export function useEquipePessoas() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const q = useQuery({
    queryKey: chaves.pessoas(tid),
    enabled: !!tid,
    staleTime: 45_000,
    // presença muda devagar (turno/pausa): 1 min basta e não pesa no banco
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<Pessoa[]> => {
      const { data, error } = await rpc("equipe_pessoas", { p_tenant_id: tid });
      if (error) throw error;
      return (data ?? []) as Pessoa[];
    },
  });
  const mapa = useMemo(() => new Map((q.data ?? []).map((p) => [p.user_id, p])), [q.data]);
  return { ...q, pessoas: q.data ?? [], mapa };
}

/** Canais que eu enxergo mas não estou dentro (públicos e setores, para admin/head). */
export function useCanaisAbertos(ativo: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: chaves.abertos(tid),
    enabled: !!tid && ativo,
    queryFn: async (): Promise<CanalAberto[]> => {
      const { data, error } = await tabela("equipe_canais")
        .select("id, tipo, nome, descricao, privado, department_id")
        .eq("tenant_id", tid)
        .in("tipo", ["canal", "setor"])
        .is("arquivado_em", null)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as CanalAberto[];
    },
  });
}

export function useMensagensDoCanal(canalId: string | null) {
  return useInfiniteQuery({
    queryKey: chaves.msgs(canalId),
    enabled: !!canalId,
    initialPageParam: null as string | null,
    staleTime: Infinity, // o Realtime mantém o cache em dia
    queryFn: async ({ pageParam }): Promise<Mensagem[]> => {
      let q = tabela("equipe_mensagens")
        .select("*")
        .eq("canal_id", canalId)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(POR_PAGINA);
      if (pageParam) q = q.lt("created_at", pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Mensagem[];
    },
    getNextPageParam: (ultima) =>
      ultima.length < POR_PAGINA ? undefined : ultima[ultima.length - 1]?.created_at ?? undefined,
  });
}

/** A mensagem de origem de um fio (quando ela não está no cache do canal). */
export function useMensagem(id: string | null, inicial?: Mensagem) {
  return useQuery({
    queryKey: ["equipe", "msg", id],
    enabled: !!id,
    initialData: inicial,
    staleTime: 60_000, // o Realtime e as ações atualizam esta consulta
    queryFn: async (): Promise<Mensagem | null> => {
      const { data, error } = await tabela("equipe_mensagens").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Mensagem | null;
    },
  });
}

/** Respostas de um fio. Fio é curto: tudo de uma vez, até 500. */
export function useRespostasDoFio(raizId: string | null) {
  return useQuery({
    queryKey: chaves.fio(raizId),
    enabled: !!raizId,
    staleTime: Infinity,
    queryFn: async (): Promise<PaginasMsgs> => {
      const { data, error } = await tabela("equipe_mensagens")
        .select("*")
        .eq("parent_id", raizId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return { pages: [(data ?? []) as Mensagem[]], pageParams: [null] };
    },
  });
}

export function useFixadas(canalId: string | null) {
  return useQuery({
    queryKey: chaves.fixadas(canalId),
    enabled: !!canalId,
    staleTime: 60_000,
    queryFn: async (): Promise<Mensagem[]> => {
      const { data, error } = await tabela("equipe_mensagens")
        .select("*")
        .eq("canal_id", canalId)
        .not("fixada_em", "is", null)
        .order("fixada_em", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Mensagem[];
    },
  });
}

export function useSalvos() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const q = useQuery({
    queryKey: chaves.salvos(tid),
    enabled: !!tid,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MensagemComCanal[]> => {
      const { data, error } = await rpc("equipe_meus_salvos", { p_tenant_id: tid });
      if (error) throw error;
      return (data ?? []) as MensagemComCanal[];
    },
  });
  const ids = useMemo(() => new Set((q.data ?? []).map((m) => m.id)), [q.data]);
  return { ...q, ids };
}

export function useBuscaMensagens(termo: string) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const t = termo.trim();
  return useQuery({
    queryKey: ["equipe", "busca", tid, t],
    enabled: !!tid && t.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<MensagemComCanal[]> => {
      const { data, error } = await rpc("equipe_buscar", { p_tenant_id: tid, p_termo: t, p_limite: 30 });
      if (error) throw error;
      return (data ?? []) as MensagemComCanal[];
    },
  });
}

/**
 * Cartões vivos de uma mensagem. Ticket e atendimento mudam o tempo todo
 * (status, fila, responsável): relê a cada minuto enquanto a aba está aberta.
 */
export function useCartoes(refs: Ref[] | null | undefined) {
  const lista = (refs ?? []).filter((r) => r?.tipo && r?.id);
  const chave = lista.map((r) => `${r.tipo}:${r.id}`).sort().join(",");
  const vivo = lista.some((r) => r.tipo !== "cliente");
  const q = useQuery({
    queryKey: ["equipe", "cartoes", chave],
    enabled: lista.length > 0,
    staleTime: 30_000,
    refetchInterval: vivo ? 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<Cartao[]> => {
      const { data, error } = await rpc("equipe_cartoes", { p_refs: lista });
      if (error) throw error;
      return (data ?? []) as Cartao[];
    },
  });
  const porChave = useMemo(() => new Map((q.data ?? []).map((c) => [`${c.tipo}:${c.id}`, c])), [q.data]);
  return { ...q, lista, porChave };
}

/** Converte códigos de ticket digitados (TK-2026-0418) em anexos. */
export async function refsDosCodigos(texto: string, tid: string | null): Promise<Ref[]> {
  const codigos = [...new Set((texto.match(/\bTK-\d{4}-\d{3,}(?:-\d+)?\b/gi) ?? []).map((c) => c.toUpperCase()))].slice(0, 5);
  if (!tid || codigos.length === 0) return [];
  const { data } = await tabela("support_tickets").select("id").eq("tenant_id", tid).in("ticket_code", codigos).is("deleted_at", null);
  return ((data ?? []) as { id: string }[]).map((t) => ({ tipo: "ticket" as const, id: t.id }));
}

// ------------------------------------------------------------------ tempo real

/**
 * Um canal Realtime por tenant, compartilhado por lista, menu e conversa aberta.
 * A RLS do Realtime entrega só o que a pessoa pode ler: DM alheia nunca chega.
 * Monte uma vez por tela (AppLayout); várias montagens reaproveitam o canal.
 */
export function useEquipeTempoReal() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // agrupa rajadas: 10 mensagens seguidas = 1 releitura
  const recarregar = useCallback((chave: QueryKey) => {
    const k = JSON.stringify(chave);
    clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(() => qc.invalidateQueries({ queryKey: chave }), 1200);
  }, [qc]);

  useEffect(() => {
    if (!tid || !user?.id) return;
    let caiu = false;
    const sair = subscribeSharedChannel(
      `equipe-${tid}`,
      (ch) => {
        ch.on("postgres_changes",
          { event: "*", schema: "public", table: "equipe_mensagens", filter: `tenant_id=eq.${tid}` },
          (payload: any) => {
            const m = payload.new as Mensagem;
            if (!m?.id) return;
            const novo = payload.eventType === "INSERT";
            const eu = user.id;
            const chave = m.parent_id ? chaves.fio(m.parent_id) : chaves.msgs(m.canal_id);
            qc.setQueryData<PaginasMsgs>(chave, (d) =>
              novo ? mesclarMensagem(d, m) : atualizarMensagem(d, m.id, (x) => ({ ...x, ...m })));

            // A lista e os fios são corrigidos AQUI, com o próprio evento. Reler
            // do banco a cada mensagem faria todo mundo online consultar ao mesmo
            // tempo (100 pessoas = 100 consultas por mensagem no #geral). Só relê
            // quando aparece algo que a tela ainda não conhece.
            if (m.parent_id) {
              if (!novo) return;
              let conhecido = false;
              qc.setQueryData<Fio[]>(chaves.fios(tid), (l) => l?.map((f) => {
                if (f.raiz_id !== m.parent_id) return f;
                conhecido = true;
                const meu = m.autor_id === eu;
                return {
                  ...f, respostas: f.respostas + 1, ultima_resposta_em: m.created_at,
                  nao_lidas: meu ? f.nao_lidas : f.nao_lidas + 1,
                  mencoes: !meu && m.mencoes?.includes(eu) ? f.mencoes + 1 : f.mencoes,
                };
              }));
              if (!conhecido) {
                // fio novo para mim? só se eu escrevi, fui mencionado ou participo da raiz
                const raiz = qc.getQueryData<PaginasMsgs>(chaves.msgs(m.canal_id))?.pages.flat().find((x) => x.id === m.parent_id);
                if (m.autor_id === eu || m.mencoes?.includes(eu) || raiz?.autor_id === eu || raiz?.respondentes?.includes(eu)) {
                  recarregar(chaves.fios(tid));
                }
              }
              return;
            }

            // raiz alterada: contagem do fio, fixar, editar, reação
            qc.setQueryData<Mensagem | null>(["equipe", "msg", m.id], (x) => (x ? { ...x, ...m } : x));
            if (!novo) {
              recarregar(chaves.fixadas(m.canal_id));
              if (m.apagada_em) {
                qc.setQueryData<Conversa[]>(chaves.conversas(tid), (l) => l?.map((c) =>
                  c.id === m.canal_id && c.ultima_mensagem_em === m.created_at ? { ...c, previa: "Mensagem apagada" } : c));
              }
              return;
            }
            let conhecida = false;
            qc.setQueryData<Conversa[]>(chaves.conversas(tid), (l) => {
              if (!l) return l;
              const out = l.map((c) => {
                if (c.id !== m.canal_id) return c;
                conhecida = true;
                const meu = m.autor_id === eu;
                return {
                  ...c, ultima_mensagem_em: m.created_at, previa: previaDe(m), previa_autor: m.autor_id,
                  nao_lidas: meu ? c.nao_lidas : c.nao_lidas + 1,
                  mencoes: !meu && (m.mencoes?.includes(eu) || m.menciona_todos) ? c.mencoes + 1 : c.mencoes,
                  arquivado: c.arquivado,
                };
              });
              return out.sort((a, b) => (b.ultima_mensagem_em ?? "").localeCompare(a.ultima_mensagem_em ?? ""));
            });
            // conversa que eu ainda não tinha na lista (DM nova, canal novo, entrei agora)
            if (!conhecida) recarregar(chaves.conversas(tid));
          });
      },
      (status) => {
        // postgres_changes não tem replay: voltou de queda, relê tudo
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") caiu = true;
        if (status === "SUBSCRIBED" && caiu) {
          caiu = false;
          qc.invalidateQueries({ queryKey: ["equipe"] });
        }
      },
    );
    const t = timers.current;
    return () => {
      sair();
      Object.values(t).forEach(clearTimeout);
    };
  }, [tid, user?.id, qc, recarregar]);
}

// ------------------------------------------------------------------ escrita

/** Onde a mensagem mora no cache: lista do canal ou respostas do fio. */
const chaveDe = (m: { canal_id: string; parent_id: string | null }) =>
  m.parent_id ? chaves.fio(m.parent_id) : chaves.msgs(m.canal_id);

export function useEquipeAcoes() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const eu = user?.id ?? "";

  /** Atualiza a mensagem onde ela estiver: lista do canal ou do fio, e a consulta avulsa da raiz. */
  const mexer = (m: { id: string; canal_id: string; parent_id: string | null }, fn: (x: Mensagem) => Mensagem) => {
    qc.setQueryData<PaginasMsgs>(chaveDe(m), (d) => atualizarMensagem(d, m.id, fn));
    if (!m.parent_id) qc.setQueryData<Mensagem | null>(["equipe", "msg", m.id], (x) => (x ? fn(x) : x));
  };

  const enviar = useMutation({
    mutationFn: async (v: { canalId: string; parentId: string | null; corpo: string; mencoes: string[]; todos: boolean; refs: Ref[]; anexos: Anexo[]; tempId: string }) => {
      const { data, error } = await rpc("equipe_enviar", {
        p_canal_id: v.canalId, p_corpo: v.corpo, p_parent_id: v.parentId,
        p_mencoes: v.mencoes, p_menciona_todos: v.todos, p_refs: v.refs, p_anexos: v.anexos,
      });
      if (error) throw error;
      return data as Mensagem;
    },
    onMutate: (v) => {
      const temp: Mensagem = {
        id: v.tempId, tenant_id: tid ?? "", canal_id: v.canalId, autor_id: eu, parent_id: v.parentId,
        tipo: "texto", corpo: v.corpo, anexos: v.anexos, refs: v.refs, mencoes: v.mencoes, menciona_todos: v.todos,
        reacoes: {}, respostas: 0, ultima_resposta_em: null, respondentes: [], editada_em: null,
        apagada_em: null, apagada_por: null, fixada_em: null, fixada_por: null,
        created_at: new Date().toISOString(), _pendente: true,
      };
      qc.setQueryData<PaginasMsgs>(chaveDe(temp), (d) => mesclarMensagem(d, temp));
    },
    onSuccess: (msg, v) => {
      qc.setQueryData<PaginasMsgs>(chaveDe(msg), (d) => mesclarMensagem(d, msg, v.tempId));
      qc.invalidateQueries({ queryKey: v.parentId ? chaves.fios(tid) : chaves.conversas(tid) });
    },
    onError: (_e, v) => {
      qc.setQueryData<PaginasMsgs>(chaveDe({ canal_id: v.canalId, parent_id: v.parentId }), (d) =>
        atualizarMensagem(d, v.tempId, (m) => ({ ...m, _pendente: false, _falhou: true })));
    },
  });

  const editar = useMutation({
    mutationFn: async (v: { msg: Mensagem; corpo: string; mencoes: string[] }) => {
      const { data, error } = await rpc("equipe_editar", { p_mensagem_id: v.msg.id, p_corpo: v.corpo, p_mencoes: v.mencoes });
      if (error) throw error;
      return data as Mensagem;
    },
    onSuccess: (msg) => mexer(msg, (m) => ({ ...m, ...msg })),
  });

  const apagar = useMutation({
    mutationFn: async (v: { msg: Mensagem }) => {
      const { error } = await rpc("equipe_apagar", { p_mensagem_id: v.msg.id });
      if (error) throw error;
    },
    onSuccess: (_d, v) => mexer(v.msg, (m) => ({ ...m, corpo: "", reacoes: {}, fixada_em: null, apagada_em: new Date().toISOString() })),
  });

  const reagir = useMutation({
    mutationFn: async (v: { msg: Mensagem; emoji: string }) => {
      const { data, error } = await rpc("equipe_reagir", { p_mensagem_id: v.msg.id, p_emoji: v.emoji });
      if (error) throw error;
      return data as Record<string, string[]>;
    },
    onMutate: (v) => mexer(v.msg, (m) => ({ ...m, reacoes: alternarReacao(m.reacoes ?? {}, v.emoji, eu) })),
    onSuccess: (reacoes, v) => mexer(v.msg, (m) => ({ ...m, reacoes })),
    onError: (_e, v) => qc.invalidateQueries({ queryKey: chaveDe(v.msg) }),
  });

  const fixar = useMutation({
    mutationFn: async (v: { msg: Mensagem; fixar: boolean }) => {
      const { error } = await rpc("equipe_fixar", { p_mensagem_id: v.msg.id, p_fixar: v.fixar });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      mexer(v.msg, (m) => ({ ...m, fixada_em: v.fixar ? new Date().toISOString() : null, fixada_por: v.fixar ? eu : null }));
      qc.invalidateQueries({ queryKey: chaves.fixadas(v.msg.canal_id) });
    },
  });

  const salvar = useMutation({
    mutationFn: async (v: { msg: { id: string }; salvar: boolean }) => {
      const { error } = await rpc("equipe_salvar", { p_mensagem_id: v.msg.id, p_salvar: v.salvar });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chaves.salvos(tid) }),
  });

  const marcarLido = useCallback(async (canalId: string) => {
    // zera na hora na lista; o banco confirma em seguida
    qc.setQueryData<Conversa[]>(chaves.conversas(tid), (l) =>
      l?.map((c) => (c.id === canalId ? { ...c, nao_lidas: 0, mencoes: 0 } : c)));
    const { error } = await rpc("equipe_marcar_lido", { p_canal_id: canalId });
    if (error) console.warn("[equipe] marcar lido falhou", error);
  }, [qc, tid]);

  const marcarFioLido = useCallback(async (raizId: string) => {
    qc.setQueryData<Fio[]>(chaves.fios(tid), (l) =>
      l?.map((f) => (f.raiz_id === raizId ? { ...f, nao_lidas: 0, mencoes: 0 } : f)));
    const { error } = await rpc("equipe_marcar_fio_lido", { p_raiz_id: raizId });
    if (error) console.warn("[equipe] marcar fio lido falhou", error);
  }, [qc, tid]);

  const recarregar = useCallback(() => qc.invalidateQueries({ queryKey: chaves.conversas(tid) }), [qc, tid]);

  const abrirDm = useCallback(async (userIds: string[]): Promise<string> => {
    const { data, error } = await rpc("equipe_abrir_dm", { p_tenant_id: tid, p_user_ids: userIds });
    if (error) throw error;
    await recarregar();
    return data as string;
  }, [tid, recarregar]);

  const criarCanal = useCallback(async (v: { nome: string; descricao: string; privado: boolean; membros: string[] }): Promise<string> => {
    const { data, error } = await rpc("equipe_criar_canal", {
      p_tenant_id: tid, p_nome: v.nome, p_descricao: v.descricao, p_privado: v.privado, p_membros: v.membros,
    });
    if (error) throw error;
    await recarregar();
    qc.invalidateQueries({ queryKey: chaves.abertos(tid) });
    return data as string;
  }, [tid, qc, recarregar]);

  const simples = useCallback(async (fn: string, args: Record<string, unknown>) => {
    const { error } = await rpc(fn, args);
    if (error) throw error;
    await recarregar();
  }, [recarregar]);

  return {
    enviar, editar, apagar, reagir, fixar, salvar, marcarLido, marcarFioLido, abrirDm, criarCanal,
    entrar: (canalId: string) => simples("equipe_entrar", { p_canal_id: canalId }),
    sair: (canalId: string) => simples("equipe_sair", { p_canal_id: canalId }),
    silenciar: (canalId: string, silenciar: boolean) => simples("equipe_silenciar", { p_canal_id: canalId, p_silenciar: silenciar }),
    adicionarMembros: (canalId: string, ids: string[]) => simples("equipe_adicionar_membros", { p_canal_id: canalId, p_user_ids: ids }),
  };
}

/** Membros de um canal manual/dm/grupo (para o cabeçalho e "adicionar pessoas"). */
export function useMembrosDoCanal(canalId: string | null, ativo: boolean) {
  return useQuery({
    queryKey: ["equipe", "membros", canalId],
    enabled: !!canalId && ativo,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await tabela("equipe_membros")
        .select("user_id")
        .eq("canal_id", canalId)
        .is("saiu_em", null);
      if (error) throw error;
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    },
  });
}

/** Mensagem de erro do banco em português de gente. */
export function mensagemDeErro(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  if (/permission denied/i.test(msg)) return "Você não tem permissão para isso.";
  return msg || "Não foi possível concluir. Tente de novo.";
}
