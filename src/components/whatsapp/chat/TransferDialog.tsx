import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useConversationAssignment } from "../hooks/useConversationAssignment";
import { useAuth } from "@/contexts/AuthContext";

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  currentAssignee: string | null;
}

export function TransferDialog({ open, onOpenChange, conversationId, currentAssignee }: TransferDialogProps) {
  const [selectedUser, setSelectedUser] = useState("");
  const [reason, setReason] = useState("");
  const { user } = useAuth();
  const { data: tenantUsers = [] } = useTenantUsers();
  const { transferConversation, isTransferring } = useConversationAssignment();

  const availableUsers = tenantUsers.filter(u =>
    u.user_id !== currentAssignee && u.status === "ativo"
  );

  const handleTransfer = () => {
    if (!selectedUser) return;
    transferConversation(
      { conversationId, newAssignee: selectedUser, reason: reason || undefined },
      { onSuccess: () => { onOpenChange(false); setSelectedUser(""); setReason(""); } }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir Conversa</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Transferir para</Label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um agente..." />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>
                    {u.email} {u.user_id === user?.id ? "(eu)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Motivo (opcional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Cliente precisa de suporte técnico..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleTransfer} disabled={!selectedUser || isTransferring}>
            {isTransferring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
