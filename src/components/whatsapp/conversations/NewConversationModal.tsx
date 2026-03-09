import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useCreateConversation } from "../hooks/useCreateConversation";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (conversationId: string) => void;
}

export function NewConversationModal({ open, onOpenChange, onCreated }: Props) {
  const { instances } = useWhatsAppInstances();
  const createConversation = useCreateConversation();
  const [instanceId, setInstanceId] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");

  const handleCreate = () => {
    if (!instanceId || !phone.trim()) {
      toast.error("Preencha instância e telefone");
      return;
    }

    const cleanPhone = phone.replace(/\D/g, "");
    createConversation.mutate(
      { instanceId, phoneNumber: cleanPhone, contactName: name.trim() || cleanPhone },
      {
        onSuccess: (data) => {
          toast.success("Conversa criada com sucesso");
          onOpenChange(false);
          setPhone("");
          setName("");
          onCreated?.(data.conversation.id);
        },
        onError: () => toast.error("Erro ao criar conversa"),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Conversa</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Instância</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a instância" />
              </SelectTrigger>
              <SelectContent>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.display_name || inst.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Telefone</Label>
            <Input
              placeholder="5511999999999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Nome (opcional)</Label>
            <Input
              placeholder="Nome do contato"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button onClick={handleCreate} disabled={createConversation.isPending} className="w-full">
            {createConversation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Iniciar Conversa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
