import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";

interface ReconnectInstanceDialogProps {
  instance: { id: string; instance_name: string; display_name: string | null };
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export const ReconnectInstanceDialog = ({ instance, open, onOpenChange }: ReconnectInstanceDialogProps) => {
  const { testConnection } = useWhatsAppInstances();
  const [loading, setLoading] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const resetAll = () => {
    clearPoll();
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setLoading(false);
    setQrBase64(null);
    setPairingCode(null);
    setErrorMsg(null);
    setWarningMsg(null);
    setConnected(false);
  };

  const fetchQr = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setWarningMsg(null);
    setQrBase64(null);
    setPairingCode(null);
    try {
      const { data, error } = await supabase.functions.invoke("reconnect-whatsapp-instance", {
        body: { instanceId: instance.id },
      });
      if (error) throw error;
      if (data?.base64) {
        setQrBase64(data.base64);
        setPairingCode(data.pairingCode ?? null);
      } else if (data?.pairingCode) {
        setPairingCode(data.pairingCode);
      } else if (data?.warning || data?.count === 0) {
        setWarningMsg("Não foi possível gerar o QR agora. Tente novamente.");
      } else if (data?.success === false) {
        setErrorMsg(data?.error || "Falha ao gerar QR Code.");
      } else {
        setWarningMsg("Não foi possível gerar o QR agora. Tente novamente.");
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Não foi possível gerar o QR agora. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [instance.id]);

  // Disparar geração quando abrir
  useEffect(() => {
    if (open) {
      resetAll();
      fetchQr();
    } else {
      resetAll();
    }
    return () => {
      clearPoll();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Polling de status
  useEffect(() => {
    clearPoll();
    if (!open || connected) return;
    if (!qrBase64 && !pairingCode) return;

    pollRef.current = setInterval(async () => {
      try {
        const res: any = await testConnection.mutateAsync(instance.id);
        if (res?.connected === true) {
          setConnected(true);
          clearPoll();
          toast.success("Instância conectada!");
          closeTimerRef.current = setTimeout(() => {
            onOpenChange(false);
          }, 1500);
        }
      } catch {
        // silencioso
      }
    }, 4000);

    return () => clearPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, qrBase64, pairingCode, connected, instance.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reconectar instância</DialogTitle>
          <DialogDescription>
            {instance.display_name || instance.instance_name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {loading && (
            <div className="flex flex-col items-center gap-2 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
            </div>
          )}

          {!loading && connected && (
            <div className="flex flex-col items-center gap-2 py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-base font-medium">Conectado!</p>
            </div>
          )}

          {!loading && !connected && qrBase64 && (
            <>
              <div className="bg-white p-3 rounded-lg">
                <img src={qrBase64} alt="QR Code" className="w-64 h-64" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho e escaneie.
              </p>
              {pairingCode && (
                <p className="text-xs text-muted-foreground text-center">
                  Ou use o código: <span className="font-mono font-semibold">{pairingCode}</span>
                </p>
              )}
              <Button variant="outline" size="sm" onClick={fetchQr} disabled={loading}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Gerar novo QR
              </Button>
            </>
          )}

          {!loading && !connected && !qrBase64 && pairingCode && (
            <>
              <div className="bg-muted p-4 rounded-lg w-full">
                <p className="text-3xl font-mono font-bold text-center tracking-widest">
                  {pairingCode}
                </p>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Ou conecte por código: WhatsApp &gt; Aparelhos conectados &gt; Conectar com número de telefone.
              </p>
              <Button variant="outline" size="sm" onClick={fetchQr} disabled={loading}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Gerar novo código
              </Button>
            </>
          )}

          {!loading && !connected && !qrBase64 && !pairingCode && (errorMsg || warningMsg) && (
            <div className="flex flex-col items-center gap-3 py-6">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-center text-muted-foreground">
                {errorMsg || warningMsg}
              </p>
              <Button variant="outline" size="sm" onClick={fetchQr}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar novamente
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
