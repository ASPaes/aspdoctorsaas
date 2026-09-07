import { useAuth } from "@/contexts/AuthContext";
import { useUserPreferences } from "@/hooks/useUserPreferences";

/**
 * Como o operador se chama para o cliente.
 *
 * A régua é a assinatura que ele mesmo escolheu em Preferências
 * (`signature_name`); só quando ela está vazia é que se cai para o que o auth
 * sabe, e por último para o prefixo do e-mail. É a mesma ordem que o
 * preenchimento de macro do chat já usava — este hook existe para que os dois
 * lugares que precisam do nome não escrevam a cadeia duas vezes e se separem
 * com o tempo.
 *
 * NÃO é `profiles.funcionario_id → funcionarios.nome`: aquele é o nome no
 * cadastro de RH, que aparece em relatório. Aqui o que vale é como a pessoa
 * quer ser chamada na conversa.
 */
export function useAgentDisplayName(): string | null {
  const { user } = useAuth();
  const { preferences } = useUserPreferences();

  return (
    preferences?.signature_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    null
  );
}
