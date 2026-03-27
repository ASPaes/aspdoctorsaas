import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save } from "lucide-react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserPreferencesDialog({ open, onOpenChange }: Props) {
  const { preferences, isLoading, upsertAsync, isUpdating } = useUserPreferences();

  const [signatureName, setSignatureName] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [visualEnabled, setVisualEnabled] = useState(true);

  useEffect(() => {
    if (open && !isLoading) {
      setSignatureName(preferences.signature_name ?? "");
      setSoundEnabled(preferences.sound_enabled);
      setVisualEnabled(preferences.visual_notifications_enabled);
    }
  }, [open, isLoading, preferences]);

  const handleSave = async () => {
    try {
      await upsertAsync({
        signature_name: signatureName.trim() || null,
        sound_enabled: soundEnabled,
        visual_notifications_enabled: visualEnabled,
      });
      toast.success("Preferências salvas!");
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao salvar preferências: " + (err.message || "Erro desconhecido"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Preferências do Usuário</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="signature-name">Nome na assinatura</Label>
            <Input
              id="signature-name"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder="Ex: João Silva"
            />
            <p className="text-xs text-muted-foreground">
              Nome exibido como assinatura nas mensagens do chat.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Som de alerta</Label>
              <p className="text-xs text-muted-foreground">
                Tocar som ao receber novas mensagens.
              </p>
            </div>
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Notificação visual</Label>
              <p className="text-xs text-muted-foreground">
                Exibir notificações visuais de novas mensagens.
              </p>
            </div>
            <Switch checked={visualEnabled} onCheckedChange={setVisualEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={isUpdating}>
            {isUpdating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
