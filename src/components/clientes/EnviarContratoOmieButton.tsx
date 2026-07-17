import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { Send, Loader2, AlertTriangle } from "lucide-react";

interface Props {
  tenantId: string | null | undefined;
  contratoId: string;
  createdAt: string | null | undefined;
}

type DryRunOk = {
  ok: true;
  operacao: "criar" | "alterar";
  aviso?: string;
  cliente_seria_enviado?: any;
  contrato_seria_enviado?: any;
  cliente_pendente_no_omie?: boolean;
  contrato_dry_run?: any;
};

export default function EnviarContratoOmieButton({ tenantId, contratoId, createdAt }: Props) {
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunOk | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorTitle, setErrorTitle] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [errorList, setErrorList] = useState<string[] | null>(null);
  const qc = useQueryClient();

  // Gate: só mostra se há data de corte configurada e o contrato é posterior.
  const { data: dataCorte, isLoading: cutoffLoading } = useQuery({
    queryKey: ["omie-data-corte", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("omie_integration" as any) as any)
        .select("integrar_a_partir_de")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data?.integrar_a_partir_de ?? null) as string | null;
    },
  });

  if (cutoffLoading) return null;
  if (!dataCorte) return null;
  if (!createdAt) return null;
  const created = createdAt.slice(0, 10);
  const corte = dataCorte.slice(0, 10);
  if (created < corte) return null;

  const showError = (title: string, msg: string, list?: string[]) => {
    setErrorTitle(title);
    setErrorMsg(msg);
    setErrorList(list ?? null);
    setErrorOpen(true);
  };

  const invokeCall = async (modo: "dry_run" | "criar") => {
    return await supabase.functions.invoke("omie-integration-call", {
      body: { acao: "criar_cliente_contrato", contrato_id: contratoId, modo },
    });
  };

  const handlePreview = async () => {
    if (!contratoId) return;
    setSending(true);
    try {
      const { data, error } = await invokeCall("dry_run");
      // FunctionsHttpError não lança quando ok:false com HTTP 200; para 4xx/5xx com body JSON,
      // supabase-js retorna error + o body em (error as any).context.
      const body: any = data ?? (error as any)?.context ?? null;

      if (body?.ok === true) {
        setDryRun(body as DryRunOk);
        return;
      }

      if (body?.bloqueado === "validacao" && Array.isArray(body?.erros)) {
        showError(
          "Não é possível enviar este contrato",
          "Corrija os pontos abaixo antes de reenviar:",
          body.erros.map((e: any) => (typeof e === "string" ? e : e?.mensagem ?? JSON.stringify(e))),
        );
        return;
      }

      const msg = body?.error || body?.detalhe || error?.message || "Resposta inesperada do servidor.";
      showError("Não é possível enviar este contrato", String(msg));
    } catch (e: any) {
      showError("Falha ao preparar o envio", e?.message ?? "Erro desconhecido.");
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const { data, error } = await invokeCall("criar");
      const body: any = data ?? (error as any)?.context ?? null;

      if (body?.ok === true) {
        setDryRun(null);
        const aviso = body?.aviso;
        if (aviso) {
          toast.warning(String(aviso));
        } else {
          const opTxt = body?.operacao === "alterar" ? "atualizado" : "criado";
          toast.success(`Contrato ${opTxt} no Omie com sucesso.`);
        }
        qc.invalidateQueries({ queryKey: ["contratos"] });
        qc.invalidateQueries({ queryKey: ["contrato", contratoId] });
        qc.invalidateQueries({ queryKey: ["omie-sync-fila"] });
        return;
      }

      // Erros específicos do passo criar
      const etapa = body?.etapa;
      const msg = body?.error || body?.aviso || body?.detalhe || error?.message || "Falha ao enviar ao Omie.";
      const title =
        etapa === "cliente"
          ? "Falha ao enviar o cliente ao Omie"
          : etapa === "contrato"
          ? "Falha ao enviar o contrato ao Omie"
          : "Falha ao enviar ao Omie";
      setDryRun(null);
      showError(title, String(msg));
    } catch (e: any) {
      setDryRun(null);
      showError("Falha ao enviar ao Omie", e?.message ?? "Erro desconhecido.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={handlePreview} disabled={sending}>
        {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
        Enviar para Omie
      </Button>

      <AlertDialog
        open={!!dryRun}
        onOpenChange={(v) => {
          if (!confirming && !v) setDryRun(null);
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dryRun?.operacao === "alterar"
                ? "Confirmar atualização no Omie"
                : "Confirmar envio ao Omie"}
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {dryRun?.aviso ??
                (dryRun?.operacao === "alterar"
                  ? "Este contrato já existe no Omie e será atualizado."
                  : "O cliente e o contrato serão enviados ao Omie.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              disabled={confirming}
            >
              {confirming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {dryRun?.operacao === "alterar" ? "Confirmar atualização" : "Confirmar envio"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={errorOpen} onOpenChange={setErrorOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {errorTitle}
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {errorMsg}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {errorList && errorList.length > 0 && (
            <ul className="list-disc pl-6 text-sm space-y-1 max-h-64 overflow-auto">
              {errorList.map((e, i) => (
                <li key={i} className="break-words">{e}</li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogAction>Entendi</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
