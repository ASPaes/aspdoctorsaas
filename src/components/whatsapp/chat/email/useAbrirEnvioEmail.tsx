import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MailX } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import type { ConversationWithContact } from "../../hooks/useWhatsAppConversations";
import { buscarContasDeEnvio, chaveContasDeEnvio } from "./useEmailChatDados";

// A tela carrega o editor (TipTap/ProseMirror) e o seletor de emoji. Fora do
// bundle principal: o cabeçalho do chat está em toda conversa, o e-mail não.
const carregarTela = () => import("./EnviarEmailChatDialog");
const EnviarEmailChatDialog = lazy(() => carregarTela().then((m) => ({ default: m.EnviarEmailChatDialog })));

/**
 * Botão "Enviar e-mail" do chat (cabeçalho e painel Detalhes).
 *
 * Confere as contas de envio NO CLIQUE, antes de abrir a tela (pedido do
 * Alexandre, 15/09/2026): sem conta disponível a tela nem abre, então a IA não
 * gera texto à toa e ninguém descobre só no fim que não tem remetente. No lugar
 * aparece um aviso dizendo a quem pedir; quem pode configurar ganha o atalho.
 */
export function useAbrirEnvioEmail(conversation: ConversationWithContact) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { can, rbacEnabled } = usePermissions();

  const [aberto, setAberto] = useState(false);
  /** montada depois da 1ª abertura e mantida: fechar e reabrir não baixa de novo */
  const [jaAbriu, setJaAbriu] = useState(false);
  const [semConta, setSemConta] = useState(false);
  const [verificando, setVerificando] = useState(false);

  // mesmo portão da aba E-mail em Configurações › Canais
  const podeConfigurar =
    profile?.is_super_admin === true || (rbacEnabled ? can("cfg.email", "view") : profile?.role === "admin");

  const abrir = async () => {
    if (verificando) return;
    const tenantId = conversation.tenant_id;
    const userId = user?.id ?? null;
    const superAdmin = profile?.is_super_admin === true;
    setVerificando(true);
    // o arquivo da tela começa a baixar junto com a conferência das contas
    void carregarTela().catch(() => undefined);
    try {
      const r = await queryClient.fetchQuery({
        queryKey: chaveContasDeEnvio(tenantId, userId, superAdmin),
        queryFn: () => buscarContasDeEnvio(tenantId, userId, superAdmin),
        staleTime: 60_000,
      });
      if (r.contas.length === 0) {
        setSemConta(true);
      } else {
        setJaAbriu(true);
        setAberto(true);
      }
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível conferir as contas de e-mail. Tente de novo.");
    } finally {
      setVerificando(false);
    }
  };

  const elementos = (
    <>
      {jaAbriu && (
        <Suspense fallback={null}>
          <EnviarEmailChatDialog open={aberto} onOpenChange={setAberto} conversation={conversation} />
        </Suspense>
      )}

      <AlertDialog open={semConta} onOpenChange={setSemConta}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <MailX className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              E-mail ainda não configurado
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Não há nenhuma conta de e-mail liberada para você enviar mensagens pelo chat.</p>
                {podeConfigurar ? (
                  <p>
                    Cadastre uma conta, ou ligue uma conta que já existe a você ou ao seu setor, em{" "}
                    <span className="font-medium text-foreground">Configurações › Atendimento › Canais › E-mail</span>.
                  </p>
                ) : (
                  <p>
                    Peça ao administrador da empresa ou ao responsável pelo seu setor para configurar uma conta de
                    e-mail para você ou para o seu setor. Depois disso, é só clicar em Enviar e-mail de novo.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {podeConfigurar ? (
              <>
                <AlertDialogCancel>Fechar</AlertDialogCancel>
                <AlertDialogAction onClick={() => navigate("/configuracoes?section=email")}>
                  Abrir configurações de e-mail
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction>Entendi</AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return { abrir, verificando, elementos };
}
