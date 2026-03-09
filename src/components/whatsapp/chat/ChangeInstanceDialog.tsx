import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useChangeInstance } from "../hooks/useChangeInstance";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationWithContact;
}

export function ChangeInstanceDialog({ open, onOpenChange, conversation }: Props) {
  const { instances } = useWhatsAppInstances();
  const changeInstance = useChangeInstance();
  const [targetInstanceId, setTargetInstanceId] = useState<string>("");

  const availableInstances = instances.filter(i => i.id !== conversation.instance_id);
  const currentInstance = instances.find(i => i.id === conversation.instance_id);

  const handleConfirm = () => {
    if (!targetInstanceId) return;
    changeInstance.mutate(
      {
        conversationId: conversation.id,
        currentContactId: conversation.contact_id,
        targetInstanceId,
        tenantId: conversation.tenant_id,
      },
      {
        onSuccess: () => {
          setTargetInstanceId("");
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Trocar Instância</DialogTitle>
          <DialogDescription>
            As mensagens serão preservadas. Próximas mensagens serão enviadas pela nova instância.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Instância atual</p>
            <p className="text-sm font-medium">
              {currentInstance?.display_name || currentInstance?.instance_name || "—"}
              {currentInstance?.phone_number && (
                <span className="text-muted-foreground ml-1">({currentInstance.phone_number})</span>
              )}
            </p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-1">Nova instância</p>
            <Select value={targetInstanceId} onValueChange={setTargetInstanceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a instância" />
              </SelectTrigger>
              <SelectContent>
                {availableInstances.map(inst => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.display_name || inst.instance_name}
                    {inst.phone_number ? ` (${inst.phone_number})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!targetInstanceId || changeInstance.isPending}>
            {changeInstance.isPending ? "Trocando..." : "Trocar Instância"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
