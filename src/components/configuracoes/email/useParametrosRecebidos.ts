import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * Parâmetros de Recebidos: o que o robô faz com o e-mail novo de cliente.
 *
 * Tabelas da migration 20260913230000 (etapa 1). RLS: todo membro ativo lê,
 * só admin ou head grava. Quem decide ticket, triagem e jornada é
 * fn_email_processar_recebido; esta tela só guarda as escolhas.
 */

export type DestinoEmail = "suporte" | "onboarding";

export interface EnderecoDestino {
  id: string;
  account_id: string;
  endereco: string;
  abre_ticket: boolean;
  /** abre ticket também quando o endereço só está em cópia */
  aceita_copia: boolean;
  destino: DestinoEmail;
  department_id: string | null;
}

export interface RegraAssunto {
  id: string;
  palavras: string[];
  destino: DestinoEmail;
  department_id: string | null;
  ordem: number;
  ativo: boolean;
}

export interface RemetenteBloqueado {
  id: string;
  padrao: string;
}

export interface ParametrosRecebidos {
  aceitar_dominio_cliente: boolean;
  dias_reabrir: number;
  confirmar_abertura: boolean;
}

export interface SetorTicket {
  id: string;
  name: string;
  usa_tickets: boolean;
}

export interface EstadoCaixa {
  account_id: string;
  ultima_leitura: string | null;
  ultimo_erro: string | null;
  falhas_seguidas: number;
}

/** o mesmo padrão que o banco usa para tenant sem linha de parâmetros */
export const PADRAO_PARAMETROS: ParametrosRecebidos = {
  aceitar_dominio_cliente: true,
  dias_reabrir: 7,
  confirmar_abertura: true,
};

const tabela = (nome: string) => supabase.from(nome as any) as any;

/** o banco responde com o nome da trava; a tela responde com o que fazer */
export function mensagemDoBanco(err: any): string {
  const m = `${err?.message ?? ""} ${err?.details ?? ""}`;
  if (m.includes("email_enderecos_destino_setor")) return "Escolha o setor antes de ligar a abertura de ticket.";
  if (m.includes("email_enderecos_destino_endereco")) return "Endereço de e-mail inválido.";
  if (m.includes("email_enderecos_destino_unico")) return "Esse endereço já está cadastrado.";
  if (m.includes("email_remetentes_bloqueados_padrao")) {
    return "Use um endereço completo (nome@empresa.com.br) ou um domínio começando com @.";
  }
  if (m.includes("email_remetentes_bloqueados_unico")) return "Esse remetente já está bloqueado.";
  if (m.includes("email_regras_assunto_palavras")) return "Informe de 1 a 20 palavras.";
  if (m.includes("email_regras_assunto_setor")) return "Escolha o setor da regra.";
  if (m.includes("email_recebidos_parametros_dias")) return "O prazo vai de 0 a 90 dias.";
  if (m.includes("row-level security") || err?.code === "42501") {
    return "Só administrador ou gestor altera estes parâmetros.";
  }
  return err?.message || "Não foi possível salvar.";
}

export function useParametrosRecebidos() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const chave = ["email_parametros_recebidos", tid];
  const invalidar = () => queryClient.invalidateQueries({ queryKey: chave });

  const consulta = useQuery({
    queryKey: chave,
    enabled: !!tid,
    queryFn: async () => {
      const [parametros, enderecos, regras, bloqueados, setores, iniciais, estado] = await Promise.all([
        tabela("email_recebidos_parametros")
          .select("aceitar_dominio_cliente, dias_reabrir, confirmar_abertura")
          .eq("tenant_id", tid)
          .maybeSingle(),
        tabela("email_enderecos_destino")
          .select("id, account_id, endereco, abre_ticket, aceita_copia, destino, department_id")
          .eq("tenant_id", tid)
          .order("created_at"),
        tabela("email_regras_assunto")
          .select("id, palavras, destino, department_id, ordem, ativo")
          .eq("tenant_id", tid)
          .order("ordem")
          .order("created_at"),
        tabela("email_remetentes_bloqueados").select("id, padrao").eq("tenant_id", tid).order("created_at"),
        tabela("support_departments")
          .select("id, name, usa_tickets")
          .eq("tenant_id", tid)
          .eq("is_active", true)
          .order("sort_order")
          .order("name"),
        tabela("ticket_statuses")
          .select("department_id")
          .eq("tenant_id", tid)
          .eq("is_initial", true)
          .eq("is_active", true),
        tabela("email_ingestao_estado")
          .select("account_id, ultima_leitura, ultimo_erro, falhas_seguidas")
          .eq("tenant_id", tid),
      ]);
      for (const r of [parametros, enderecos, regras, bloqueados, setores, iniciais]) {
        if (r.error) throw r.error;
      }

      return {
        parametros: { ...PADRAO_PARAMETROS, ...(parametros.data ?? {}) } as ParametrosRecebidos,
        enderecos: (enderecos.data ?? []) as EnderecoDestino[],
        regras: (regras.data ?? []) as RegraAssunto[],
        bloqueados: (bloqueados.data ?? []) as RemetenteBloqueado[],
        setores: (setores.data ?? []) as SetorTicket[],
        setoresComStatusInicial: [
          ...new Set(((iniciais.data ?? []) as { department_id: string }[]).map((s) => s.department_id)),
        ],
        // o estado da leitura só chega para admin e head (RLS); para os outros fica vazio
        estado: (estado.error ? [] : (estado.data ?? [])) as EstadoCaixa[],
      };
    },
  });

  const salvarParametros = useMutation({
    mutationFn: async (mudanca: Partial<ParametrosRecebidos>) => {
      const atual = consulta.data?.parametros ?? PADRAO_PARAMETROS;
      const { error } = await tabela("email_recebidos_parametros").upsert(
        { tenant_id: tid, ...atual, ...mudanca, updated_at: new Date().toISOString() },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const salvarEndereco = useMutation({
    mutationFn: async (e: Omit<EnderecoDestino, "id">) => {
      const { error } = await tabela("email_enderecos_destino").upsert(
        {
          tenant_id: tid,
          account_id: e.account_id,
          endereco: e.endereco.trim().toLowerCase(),
          abre_ticket: e.abre_ticket,
          aceita_copia: e.aceita_copia,
          destino: e.destino,
          department_id: e.department_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,endereco" },
      );
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const removerEndereco = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tabela("email_enderecos_destino").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const criarRegra = useMutation({
    mutationFn: async (r: { palavras: string[]; department_id: string }) => {
      const ordem = (consulta.data?.regras ?? []).reduce((maior: number, x: RegraAssunto) => Math.max(maior, x.ordem + 1), 0);
      const { error } = await tabela("email_regras_assunto").insert({
        tenant_id: tid,
        palavras: r.palavras,
        destino: "suporte",
        department_id: r.department_id,
        ordem,
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const removerRegra = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tabela("email_regras_assunto").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const bloquear = useMutation({
    mutationFn: async (padrao: string) => {
      const { error } = await tabela("email_remetentes_bloqueados").insert({
        tenant_id: tid,
        padrao: padrao.trim().toLowerCase(),
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const desbloquear = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tabela("email_remetentes_bloqueados").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  return {
    dados: consulta.data,
    isLoading: consulta.isLoading,
    erro: consulta.error,
    salvarParametros,
    salvarEndereco,
    removerEndereco,
    criarRegra,
    removerRegra,
    bloquear,
    desbloquear,
  };
}
