import { useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Pencil, Trash2, Copy, Link, PowerOff, QrCode, RotateCcw, History } from "lucide-react";
import { toast } from "sonner";
import { EditInstanceDialog } from "./EditInstanceDialog";
import { ReconnectInstanceDialog } from "./ReconnectInstanceDialog";
import { RecoverMessagesDialog } from "./RecoverMessagesDialog";

interface Instance {
  id: string;
  instance_name: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  provider_type: string;
  instance_id_external: string | null;
  created_at: string;
  tenant_id: string;
  webhook_url: string | null;
  updated_at: string;
  ignore_group_messages?: boolean;
  meta_phone_number_id?: string | null;
  is_active?: boolean;
}

interface InstanceCardProps {
  instance: Instance;
}

export const InstanceCard = ({ instance }: InstanceCardProps) => {
  const { testConnection, deleteInstance, updateInstance, setActive } = useWhatsAppInstances();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const isActive = instance.is_active !== false;
  const supportsQr = instance.provider_type === 'self_hosted' || instance.provider_type === 'cloud';

  const handleToggleIgnoreGroups = async (checked: boolean) => {
    try {
      await updateInstance.mutateAsync({ id: instance.id, updates: { ignore_group_messages: checked } });
      toast.success(checked ? "Mensagens de grupo serão ignoradas" : "Mensagens de grupo serão processadas");
    } catch {
      toast.error("Erro ao atualizar configuração");
    }
  };

  const handleToggleActive = (checked: boolean) => {
    if (!checked) {
      setShowDeactivateDialog(true);
    } else {
      setActive.mutate(
        { id: instance.id, active: true },
        {
          onSuccess: () => toast.success("Instância ativada. Edite-a para reinserir as credenciais."),
          onError: (e: any) => toast.error(e?.message || "Erro ao ativar instância"),
        }
      );
    }
  };

  const confirmDeactivate = () => {
    setActive.mutate(
      { id: instance.id, active: false },
      {
        onSuccess: () => {
          toast.success("Instância desativada e desconectada do provedor");
          setShowDeactivateDialog(false);
        },
        onError: (e: any) => toast.error(e?.message || "Erro ao desativar instância"),
      }
    );
  };

  const base = import.meta.env.VITE_SUPABASE_URL;
  const webhookUrl = instance.provider_type === 'zapi'
    ? `${base}/functions/v1/zapi-webhook`
    : instance.provider_type === 'meta_cloud'
      ? `${base}/functions/v1/meta-webhook`
      : `${base}/functions/v1/evolution-webhook`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success("URL copiada!");
  };

  const handleTestConnection = async () => {
    try {
      await testConnection.mutateAsync(instance.id);
      toast.success("Conexão testada com sucesso!");
    } catch {
      toast.error("Falha ao testar conexão");
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      const { data, error } = await supabase.functions.invoke('restart-whatsapp-instance', {
        body: { instanceId: instance.id },
      });
      if (error) {
        toast.error("Falha ao reiniciar: " + (error.message || "Erro desconhecido"));
        return;
      }
      const result = data as any;
      if (result?.event_confirmed === true) {
        toast.success("Restart confirmado — instância reconectou e os eventos voltaram a chegar.");
      } else if (result?.restarted === true) {
        toast.warning(result?.message || "Instância reiniciada, mas a reconexão não foi confirmada.", { duration: 10000 });
      } else {
        toast.error("Falha ao reiniciar: " + (result?.message || "Resposta inesperada"));
      }
    } catch (e: any) {
      toast.error("Falha ao reiniciar: " + (e?.message || "Erro desconhecido"));
    } finally {
      setRestarting(false);
      setShowRestartDialog(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteInstance.mutateAsync(instance.id);
      toast.success("Instância excluída com sucesso");
      setShowDeleteDialog(false);
    } catch {
      toast.error("Erro ao excluir instância");
    }
  };

  const getStatusColor = () => {
    if (!isActive) return "bg-muted-foreground";
    switch (instance.status) {
      case "connected": return "bg-green-500";
      case "connecting": return "bg-yellow-500";
      default: return "bg-red-500";
    }
  };

  const getStatusText = () => {
    if (!isActive) return "Inativa";
    switch (instance.status) {
      case "connected": return "Conectado";
      case "connecting": return "Conectando";
      default: return "Desconectado";
    }
  };

  const getProviderLabel = () => {
    switch (instance.provider_type) {
      case 'zapi': return 'Z-API';
      case 'meta_cloud': return 'Meta Cloud';
      case 'cloud': return 'Evolution Cloud';
      default: return 'Evolution';
    }
  };

  return (
    <>
      <Card className={!isActive ? "opacity-70" : ""}>
        <CardHeader className="p-3 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 min-w-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${getStatusColor()}`} />
                <span className="truncate">{instance.display_name || instance.instance_name}</span>
              </CardTitle>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {instance.instance_name}
                </Badge>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {getProviderLabel()}
                </Badge>
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <Switch
                checked={isActive}
                disabled={setActive.isPending}
                onCheckedChange={handleToggleActive}
                aria-label="Ativar/desativar instância"
              />
              <span className="text-[10px] text-muted-foreground">
                {isActive ? "Ativa" : "Inativa"}
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3 pt-0 space-y-2">
          <div className="text-xs flex items-center justify-between">
            <span><span className="text-muted-foreground">Status:</span> <span className="font-medium">{getStatusText()}</span></span>
            <span className="text-muted-foreground">{new Date(instance.created_at).toLocaleDateString("pt-BR")}</span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link className="h-3 w-3" />
              <span>Webhook:</span>
            </div>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 bg-muted px-1.5 py-1 rounded text-[10px] truncate select-all font-mono">
                {webhookUrl}
              </code>
              <Button size="sm" variant="ghost" onClick={copyWebhookUrl} className="h-7 w-7 p-0 shrink-0">
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <Label htmlFor={`ignore-groups-${instance.id}`} className="text-xs cursor-pointer">
              Ignorar grupos (@g.us)
            </Label>
            <Switch
              id={`ignore-groups-${instance.id}`}
              checked={instance.ignore_group_messages !== false}
              onCheckedChange={handleToggleIgnoreGroups}
              disabled={!isActive}
            />
          </div>
        </CardContent>

        <CardFooter className="p-3 pt-0 flex gap-1.5">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={handleTestConnection} disabled={testConnection.isPending || !isActive}>
            <RefreshCw className={`h-3.5 w-3.5 ${testConnection.isPending ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setShowEditDialog(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {supportsQr && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setShowQrDialog(true)}
              title="Reconectar (QR Code)"
              disabled={!isActive}
            >
              <QrCode className="h-3.5 w-3.5" />
            </Button>
          )}
          {supportsQr && isActive && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setShowRestartDialog(true)}
              title="Reiniciar instância"
              disabled={restarting}
            >
              <RotateCcw className={`h-3.5 w-3.5 ${restarting ? "animate-spin" : ""}`} />
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </CardFooter>
      </Card>

      <AlertDialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PowerOff className="h-5 w-5 text-destructive" />
              Desativar instância?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A instância será desconectada do provedor ({getProviderLabel()}) e suas credenciais (API Key, Tokens) serão <strong>permanentemente apagadas</strong>.
              <br /><br />
              O histórico de conversas e mensagens será preservado, mas para reativar você precisará editar a instância e reinserir todas as credenciais.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setActive.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeactivate}
              disabled={setActive.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {setActive.isPending ? "Desativando..." : "Desativar e apagar credenciais"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir instância?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Todas as conversas e mensagens associadas a esta instância serão removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRestartDialog} onOpenChange={setShowRestartDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reiniciar instância?</AlertDialogTitle>
            <AlertDialogDescription>
              A sessão será reiniciada no servidor Evolution. As conversas e mensagens não são afetadas. A verificação leva até 30 segundos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restarting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestart} disabled={restarting}>
              {restarting ? "Reiniciando..." : "Reiniciar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditInstanceDialog instance={instance} open={showEditDialog} onOpenChange={setShowEditDialog} />

      <ReconnectInstanceDialog instance={instance} open={showQrDialog} onOpenChange={setShowQrDialog} />
    </>
  );
};
