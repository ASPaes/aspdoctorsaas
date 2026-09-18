import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Macros de e-mail: tabelas da migration 20260918030000.
 * RLS: todo membro ativo do tenant lê; só admin e gestor grava (igual às
 * outras abas de e-mail). O uso é contado pela fn_email_macro_usada.
 *
 * O tenant é sempre passado por quem chama: na tela de envio vem do chat ou do
 * chamado, e na aba Macros do filtro de tenant (super admin simulando).
 */

export const BUCKET_MACRO = "email-macro-anexos";

export interface AnexoMacro {
  id: string;
  path: string;
  nome: string;
  mime: string;
  tamanho: number;
  ordem: number;
}

export interface EmailMacro {
  id: string;
  tenant_id: string;
  titulo: string;
  atalho: string | null;
  categoria: string | null;
  assunto: string | null;
  corpo_html: string;
  department_ids: string[];
  ativo: boolean;
  usos: number;
  ultimo_uso_em: string | null;
  updated_at: string;
  anexos: AnexoMacro[];
  /** quantas vezes QUEM ESTÁ LOGADO usou: é o que ordena "Mais usadas por você" */
  meusUsos: number;
}

const tabela = (nome: string) => supabase.from(nome as any) as any;

export const chaveMacros = (tenantId: string | null) => ["email-macros", tenantId] as const;

export function useEmailMacros(tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: chaveMacros(tenantId),
    enabled: enabled && !!tenantId,
    staleTime: 60_000,
    queryFn: async (): Promise<EmailMacro[]> => {
      const [macros, anexos, usos] = await Promise.all([
        tabela("email_macros")
          .select("id, tenant_id, titulo, atalho, categoria, assunto, corpo_html, department_ids, ativo, usos, ultimo_uso_em, updated_at")
          .eq("tenant_id", tenantId)
          .order("titulo"),
        tabela("email_macro_anexos")
          .select("id, macro_id, path, nome, mime, tamanho, ordem")
          .eq("tenant_id", tenantId)
          .order("ordem"),
        // RLS devolve só as linhas de quem está logado
        tabela("email_macro_usos").select("macro_id, usos").eq("tenant_id", tenantId),
      ]);
      if (macros.error) throw macros.error;
      if (anexos.error) throw anexos.error;

      const anexosPorMacro = new Map<string, AnexoMacro[]>();
      for (const a of (anexos.data ?? []) as any[]) {
        const lista = anexosPorMacro.get(a.macro_id) ?? [];
        lista.push({ id: a.id, path: a.path, nome: a.nome, mime: a.mime, tamanho: Number(a.tamanho) || 0, ordem: a.ordem });
        anexosPorMacro.set(a.macro_id, lista);
      }
      const meus = new Map<string, number>(
        ((usos.error ? [] : usos.data) ?? []).map((u: any) => [u.macro_id, Number(u.usos) || 0]),
      );

      return ((macros.data ?? []) as any[]).map((m) => ({
        ...m,
        department_ids: m.department_ids ?? [],
        anexos: anexosPorMacro.get(m.id) ?? [],
        meusUsos: meus.get(m.id) ?? 0,
      }));
    },
  });
}

/** conta o uso sem travar a tela: se falhar, o e-mail segue igual */
export async function registrarUsoDaMacro(macroId: string) {
  const { error } = await supabase.rpc("fn_email_macro_usada" as any, { p_macro_id: macroId } as any);
  if (error) console.warn("[macros de e-mail] uso não contado:", error.message);
}

export async function baixarAnexoDaMacro(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET_MACRO).download(path);
  if (error || !data) throw new Error("Não foi possível abrir o anexo da macro.");
  return data;
}

/** o banco responde com o nome da trava; a tela responde com o que fazer */
export function mensagemDaMacro(err: any): string {
  const m = `${err?.message ?? ""} ${err?.details ?? ""}`;
  if (m.includes("email_macros_atalho_unico")) return "Já existe uma macro com esse atalho.";
  if (m.includes("email_macros_atalho")) return "O atalho aceita só letras minúsculas sem acento, números, - e _ (até 30).";
  if (m.includes("email_macros_titulo")) return "Dê um nome para a macro (até 120 letras).";
  if (m.includes("email_macros_assunto")) return "O assunto passa de 300 letras.";
  if (m.includes("email_macros_corpo")) return "O texto da macro está grande demais.";
  if (m.includes("row-level security") || err?.code === "42501") return "Só administrador ou gestor cadastra macro.";
  return err?.message || "Não foi possível salvar a macro.";
}

export interface ArquivoNovo {
  /** chave estável na lista da tela */
  chave: string;
  arquivo: File;
}

export interface MacroParaSalvar {
  id?: string;
  tenant_id: string;
  titulo: string;
  atalho: string | null;
  categoria: string | null;
  assunto: string | null;
  corpo_html: string;
  department_ids: string[];
  ativo: boolean;
  /** anexos que ficam, na ordem da tela */
  anexosMantidos: AnexoMacro[];
  /** arquivos novos, na ordem, depois dos mantidos */
  arquivosNovos: ArquivoNovo[];
}

function extensao(nome: string): string {
  const e = (nome.split(".").pop() || "").toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(e) ? e : "bin";
}

export function useSalvarMacro() {
  const queryClient = useQueryClient();

  const salvar = useMutation({
    mutationFn: async (m: MacroParaSalvar): Promise<string> => {
      const linha = {
        tenant_id: m.tenant_id,
        titulo: m.titulo.trim(),
        atalho: m.atalho?.trim() || null,
        categoria: m.categoria?.trim() || null,
        assunto: m.assunto?.trim() || null,
        corpo_html: m.corpo_html,
        department_ids: m.department_ids,
        ativo: m.ativo,
      };

      let id = m.id;
      if (id) {
        const { error } = await tabela("email_macros").update(linha).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await tabela("email_macros").insert(linha).select("id").single();
        if (error) throw error;
        id = (data as any).id as string;
      }

      // 1. sobe os arquivos novos (a pasta de cima é o tenant: é o que a policy confere)
      const subidos: Omit<AnexoMacro, "id" | "ordem">[] = [];
      for (const { arquivo } of m.arquivosNovos) {
        const path = `${m.tenant_id}/${crypto.randomUUID()}.${extensao(arquivo.name)}`;
        const { error } = await supabase.storage
          .from(BUCKET_MACRO)
          .upload(path, arquivo, { upsert: false, contentType: arquivo.type || "application/octet-stream" });
        if (error) throw new Error(`Falha ao subir "${arquivo.name}": ${error.message}`);
        subidos.push({ path, nome: arquivo.name, mime: arquivo.type || "application/octet-stream", tamanho: arquivo.size });
      }

      // 2. o que saiu da lista: tira do banco e do bucket
      const { data: atuais, error: atuaisErr } = await tabela("email_macro_anexos").select("id, path").eq("macro_id", id);
      if (atuaisErr) throw atuaisErr;
      const ficam = new Set(m.anexosMantidos.map((a) => a.id));
      const saem = ((atuais ?? []) as { id: string; path: string }[]).filter((a) => !ficam.has(a.id));
      if (saem.length) {
        const { error } = await tabela("email_macro_anexos").delete().in("id", saem.map((a) => a.id));
        if (error) throw error;
        // arquivo que não sai do bucket só ocupa espaço: não trava o salvar
        const { error: rmErr } = await supabase.storage.from(BUCKET_MACRO).remove(saem.map((a) => a.path));
        if (rmErr) console.warn("[macros de e-mail] arquivo não apagado:", rmErr.message);
      }

      // 3. ordem dos que ficaram e os novos
      for (const [i, a] of m.anexosMantidos.entries()) {
        if (a.ordem === i) continue;
        const { error } = await tabela("email_macro_anexos").update({ ordem: i }).eq("id", a.id);
        if (error) throw error;
      }
      if (subidos.length) {
        const base = m.anexosMantidos.length;
        const { error } = await tabela("email_macro_anexos").insert(
          subidos.map((s, i) => ({ ...s, tenant_id: m.tenant_id, macro_id: id, ordem: base + i })),
        );
        if (error) throw error;
      }
      return id!;
    },
    onSettled: (_d, _e, m) => queryClient.invalidateQueries({ queryKey: chaveMacros(m.tenant_id) }),
  });

  const alternarAtiva = useMutation({
    mutationFn: async ({ macro, ativo }: { macro: EmailMacro; ativo: boolean }) => {
      const { error } = await tabela("email_macros").update({ ativo }).eq("id", macro.id);
      if (error) throw error;
    },
    onSettled: (_d, _e, v) => queryClient.invalidateQueries({ queryKey: chaveMacros(v.macro.tenant_id) }),
  });

  const apagar = useMutation({
    mutationFn: async (macro: EmailMacro) => {
      const { error } = await tabela("email_macros").delete().eq("id", macro.id);
      if (error) throw error;
      if (macro.anexos.length) {
        const { error: rmErr } = await supabase.storage.from(BUCKET_MACRO).remove(macro.anexos.map((a) => a.path));
        if (rmErr) console.warn("[macros de e-mail] arquivo não apagado:", rmErr.message);
      }
    },
    onSettled: (_d, _e, macro) => queryClient.invalidateQueries({ queryKey: chaveMacros(macro.tenant_id) }),
  });

  return { salvar, alternarAtiva, apagar };
}

/** atalho digitado vira o formato aceito: "Boas Vindas!" → "boas-vindas" */
export function normalizarAtalho(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 30);
}

/**
 * Quem vê a macro na tela de envio: sem setor = todos; com setor, quem é de
 * algum deles, ou quando o e-mail é de um deles. Admin, gestor e super admin
 * veem todas (são eles que cadastram).
 */
export function macroVisivel(
  macro: Pick<EmailMacro, "department_ids" | "ativo">,
  meusSetores: string[],
  setorDoEmail: string | null,
  veTodas: boolean,
): boolean {
  if (!macro.ativo) return false;
  if (veTodas || macro.department_ids.length === 0) return true;
  return macro.department_ids.some((d) => meusSetores.includes(d) || d === setorDoEmail);
}
