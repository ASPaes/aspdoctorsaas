import { supabase } from "@/integrations/supabase/client";

let cachedFuncionarioId: number | null | undefined = undefined;
let cachedForUserId: string | null = null;

/**
 * Retorna o funcionario_id (bigint) do usuário autenticado.
 * Mapeia auth.users.id → profiles.funcionario_id.
 * Faz cache em memória durante a sessão.
 * Retorna null se o usuário não tem funcionario vinculado (ex: super_admin sem funcionario).
 */
export async function getCurrentFuncionarioId(): Promise<number | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Cache hit
  if (cachedForUserId === user.id && cachedFuncionarioId !== undefined) {
    return cachedFuncionarioId;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("funcionario_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentFuncionarioId] erro:", error);
    return null;
  }

  cachedForUserId = user.id;
  cachedFuncionarioId = data?.funcionario_id ?? null;
  return cachedFuncionarioId;
}

/**
 * Limpa o cache. Chamar no logout.
 */
export function clearFuncionarioIdCache() {
  cachedFuncionarioId = undefined;
  cachedForUserId = null;
}
