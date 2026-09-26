import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/supabasePaginate';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { toast } from 'sonner';

// Leitura e escrita da régua de cobrança.
//
// A régua NÃO envia nada hoje: o motor (`fin-regua-motor`) só simula, e a chave
// `fin_regua_liberada` nasce falsa em todo tenant. Esta tela é o que torna isso
// visível, em vez de viver em SQL — inclusive o estado do freio, que é a
// primeira coisa que alguém precisa saber ao abrir a página.

export interface FinToque {
  id: string;
  tenant_id: string;
  dias_offset: number;
  rotulo: string;
  mensagem: string;
  template_name: string | null;
  template_language: string;
  ativo: boolean;
}

export interface FinReguaEstado {
  liberada: boolean;
  instance_id: string | null;
  instancia_nome: string | null;
  instancia_modo: string | null;
  telefones_teste: string[];
  opt_outs: number;
  envios: number;
}

/**
 * O rótulo que uma pessoa usa para falar do toque.
 *
 * `dias_offset` é a verdade no banco, mas ninguém pensa "offset menos três":
 * pensa "três dias antes". A conversão mora aqui para as duas telas falarem
 * igual.
 */
export function rotuloOffset(dias: number): string {
  if (dias === 0) return 'No dia do vencimento';
  if (dias < 0) return `${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'} antes`;
  return `${dias} ${dias === 1 ? 'dia' : 'dias'} depois`;
}

export function useFinToques() {
  const { effectiveTenantId } = useTenantFilter();
  const tid = effectiveTenantId;

  return useQuery({
    queryKey: ['fin-regua-toques', tid],
    enabled: !!tid,
    queryFn: async () => {
      const linhas = await fetchAllRows<FinToque>(() =>
        (supabase.from('fin_regua_toques' as any) as any)
          .select('id, tenant_id, dias_offset, rotulo, mensagem, template_name, template_language, ativo')
          .eq('tenant_id', tid)
          .order('dias_offset'),
      );
      return linhas;
    },
  });
}

export function useFinReguaEstado() {
  const { effectiveTenantId } = useTenantFilter();
  const tid = effectiveTenantId;

  return useQuery({
    queryKey: ['fin-regua-estado', tid],
    enabled: !!tid,
    queryFn: async (): Promise<FinReguaEstado> => {
      const { data: cfg } = await (supabase.from('configuracoes' as any) as any)
        .select('fin_regua_liberada, fin_regua_telefones_teste, fin_regua_instance_id')
        .eq('tenant_id', tid)
        .maybeSingle();

      // Sem embed: `whatsapp_conversations` tem duas FKs para instância e o
      // PostgREST devolve ambiguidade. Aqui é uma consulta simples, mas o
      // hábito de buscar a instância à parte é o que evita a armadilha.
      let nome: string | null = null;
      let modo: string | null = null;
      if (cfg?.fin_regua_instance_id) {
        const { data: inst } = await (supabase.from('whatsapp_instances' as any) as any)
          .select('instance_name, provider_type, is_active')
          .eq('id', cfg.fin_regua_instance_id)
          .maybeSingle();
        nome = inst?.instance_name ?? null;
        modo = inst ? (inst.provider_type === 'meta_cloud' ? 'oficial' : inst.provider_type) : null;
      }

      const { count: optOuts } = await (supabase.from('fin_cobranca_optout' as any) as any)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tid)
        .is('revogado_em', null);

      const { count: envios } = await (supabase.from('fin_cobranca_envios' as any) as any)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tid);

      return {
        liberada: cfg?.fin_regua_liberada === true,
        instance_id: cfg?.fin_regua_instance_id ?? null,
        instancia_nome: nome,
        instancia_modo: modo,
        telefones_teste: cfg?.fin_regua_telefones_teste ?? [],
        opt_outs: optOuts ?? 0,
        envios: envios ?? 0,
      };
    },
  });
}

export function useSalvarToque() {
  const qc = useQueryClient();
  const { effectiveTenantId } = useTenantFilter();

  return useMutation({
    mutationFn: async (toque: Partial<FinToque> & { id?: string }) => {
      if (toque.id) {
        const { error } = await (supabase.from('fin_regua_toques' as any) as any)
          .update({
            rotulo: toque.rotulo,
            mensagem: toque.mensagem,
            template_name: toque.template_name || null,
            ativo: toque.ativo,
          })
          .eq('id', toque.id);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase.from('fin_regua_toques' as any) as any).insert({
        tenant_id: effectiveTenantId,
        dias_offset: toque.dias_offset,
        rotulo: toque.rotulo,
        mensagem: toque.mensagem,
        template_name: toque.template_name || null,
        ativo: toque.ativo ?? true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-regua-toques'] });
      toast.success('Toque salvo');
    },
    onError: (e: any) => {
      // A mensagem crua do Postgres é o que diz se foi a chave única (dois
      // toques no mesmo dia) ou a policy. Esconder isso faria o usuário tentar
      // de novo sem saber o que mudar.
      toast.error(e?.message ?? 'Não consegui salvar o toque');
    },
  });
}

export function useApagarToque() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('fin_regua_toques' as any) as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-regua-toques'] });
      toast.success('Toque removido');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Não consegui remover'),
  });
}

export interface InstanciaDisponivel {
  id: string;
  instance_name: string;
  provider_type: string;
  is_active: boolean;
  status: string | null;
  oficial: boolean;
}

/**
 * Instâncias por onde a régua pode sair.
 *
 * Mostra as INATIVAS também, marcadas: esconder a instância que acabou de cair
 * faria a cobrança parar sem ninguém entender por quê. Melhor ver que ela está
 * lá e desconectada.
 */
export function useInstanciasDaRegua() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<InstanciaDisponivel[]>({
    queryKey: ['fin-regua-instancias', tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data } = await (supabase.from('whatsapp_instances' as any) as any)
        .select('id, instance_name, provider_type, is_active, status')
        .eq('tenant_id', tid)
        .order('is_active', { ascending: false })
        .order('instance_name');
      return (data ?? []).map((i: any) => ({
        ...i,
        // O número da Meta é uma instância como as outras aqui — só muda o
        // provedor. Trocar de um para o outro é trocar a escolha, nada mais.
        oficial: i.provider_type === 'meta_cloud',
      }));
    },
  });
}

/**
 * Troca o número por onde a régua envia.
 *
 * ⚠️ Só super admin consegue: o gatilho `fn_fin_protege_chaves_de_liberacao`
 * barra no banco, não só na tela. Se a gravação falhar com "Só super admin",
 * é essa trava falando, e ela está certa.
 */
export function useSalvarCanalDaRegua() {
  const qc = useQueryClient();
  const { effectiveTenantId } = useTenantFilter();

  return useMutation({
    mutationFn: async (instanceId: string | null) => {
      const { error } = await (supabase.from('configuracoes' as any) as any)
        .update({ fin_regua_instance_id: instanceId })
        .eq('tenant_id', effectiveTenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-regua-estado'] });
      toast.success('Número da cobrança atualizado');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Não consegui salvar o número'),
  });
}
