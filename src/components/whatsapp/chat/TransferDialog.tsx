import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, User, Building2 } from "lucide-react";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useConversationAssignment } from "../hooks/useConversationAssignment";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  currentAssignee: string | null;
}

function useFuncionariosLookup() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ["funcionarios-lookup-map", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return new Map((data ?? []).map(f => [f.id, f.nome]));
    },
  });
}

function useDepartments() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ["support-departments-transfer", tid],
    enabled: !!tid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function TransferDialog({ open, onOpenChange, conversationId, currentAssignee }: TransferDialogProps) {
  const [tab, setTab] = useState<string>("agent");
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedDept, setSelectedDept] = useState("");
  const [reason, setReason] = useState("");
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { data: tenantUsers = [] } = useTenantUsers();
  const { data: funcMap } = useFuncionariosLookup();
  const { data: departments = [] } = useDepartments();
  const { transferConversation, transferToDepartment, isTransferring, isTransferringDepartment } = useConversationAssignment();

  const isAdminOrHead = profile?.role === "admin" || profile?.is_super_admin;

  const availableUsers = tenantUsers.filter(u =>
    u.user_id !== currentAssignee && u.status === "ativo"
  );

  const getDisplayName = (u: typeof tenantUsers[0]) => {
    const funcName = u.funcionario_id ? funcMap?.get(u.funcionario_id) : null;
    return funcName ?? u.email;
  };

  const handleTransferAgent = () => {
    if (!selectedUser) return;
    transferConversation(
      { conversationId, newAssignee: selectedUser, reason: reason || undefined },
      { onSuccess: () => { onOpenChange(false); setSelectedUser(""); setReason(""); } }
    );
  };

  const handleTransferDept = () => {
    if (!selectedDept) return;
    transferToDepartment(
      { conversationId, departmentId: selectedDept, reason: reason || undefined },
      { onSuccess: () => { onOpenChange(false); setSelectedDept(""); setReason(""); } }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir Conversa</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="agent" className="gap-1.5">
              <User className="h-3.5 w-3.5" /> Agente
            </TabsTrigger>
            {isAdminOrHead && (
              <TabsTrigger value="department" className="gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> Setor
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="agent" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Transferir para</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um agente..." />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((u) => (
                    <SelectItem key={u.user_id} value={u.user_id}>
                      {getDisplayName(u)} {u.user_id === user?.id ? "(eu)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          {isAdminOrHead && (
            <TabsContent value="department" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Transferir para setor</Label>
                <Select value={selectedDept} onValueChange={setSelectedDept}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um setor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                A conversa será desvinculada do agente atual e voltará para a fila do setor selecionado.
              </p>
            </TabsContent>
          )}
        </Tabs>

        <div className="space-y-2">
          <Label>Motivo (opcional)</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: Cliente precisa de suporte técnico..."
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {tab === "agent" ? (
            <Button onClick={handleTransferAgent} disabled={!selectedUser || isTransferring}>
              {isTransferring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Transferir
            </Button>
          ) : (
            <Button onClick={handleTransferDept} disabled={!selectedDept || isTransferringDepartment}>
              {isTransferringDepartment ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Transferir Setor
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
