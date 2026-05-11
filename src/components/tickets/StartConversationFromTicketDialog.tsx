import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Loader2, Phone, User, Building2, MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  ticketCode: string;
  clienteId: string | null;
  clienteNome?: string;
  departmentId?: string | null;
  onCreated?: () => void;
}

function StartConversationFromTicketDialog({
  open,
  onOpenChange,
  ticketId,
  ticketCode,
  clienteId,
  clienteNome,
  departmentId,
  onCreated,
}: Props) {
  const { instances } = useWhatsAppInstances();
  const { effectiveTenantId: tid } = useTenantFilter();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"client" | "third_party">("client");
  const [instanceId, setInstanceId] = useState("");
  const [selectedContactPhone, setSelectedContactPhone] = useState("");
  const [selectedContactName, setSelectedContactName] = useState("");
  const [thirdPartyPhone, setThirdPartyPhone] = useState("55");
  const [thirdPartyName, setThirdPartyName] = useState("");
  const [thirdPartyLabel, setThirdPartyLabel] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open && !instanceId && instances.length === 1) {
      setInstanceId(instances[0].id);
    }
  }, [open, instances, instanceId]);

  const { data: clienteContatos = [] } = useQuery({
    queryKey: ["ticket_start_conv_contatos", clienteId],
    enabled: !!clienteId && open,
    queryFn: async () => {
      if (!clienteId) return [];

      const { data: cli } = await (supabase.from("clientes" as any) as any)
        .select("contato_nome, contato_fone, telefone_whatsapp, nome_fantasia")
        .eq("id", clienteId)
        .maybeSingle();

      const { data: contatos } = await (supabase.from("cliente_contatos" as any) as any)
        .select("id, nome, fone, cargo")
        .eq("cliente_id", clienteId)
        .not("fone", "is", null)
        .order("nome");

      const result: Array<{ id: string; nome: string; phone: string; detalhe: string }> = [];

      if (cli?.telefone_whatsapp) {
        result.push({
          id: "whatsapp_principal",
          nome: cli.nome_fantasia ?? "Principal",
          phone: cli.telefone_whatsapp.replace(/\D/g, ""),
          detalhe: "WhatsApp principal",
        });
      }

      if (cli?.contato_nome && cli?.contato_fone) {
        const cleanPhone = cli.contato_fone.replace(/\D/g, "");
        if (!result.find((r) => r.phone === cleanPhone)) {
          result.push({
            id: "contato_principal",
            nome: cli.contato_nome,
            phone: cleanPhone,
            detalhe: "Contato principal",
          });
        }
      }

      (contatos ?? []).forEach((c: any) => {
        const cleanPhone = (c.fone ?? "").replace(/\D/g, "");
        if (cleanPhone.length >= 10 && !result.find((r) => r.phone === cleanPhone)) {
          result.push({
            id: c.id,
            nome: c.nome,
            phone: cleanPhone,
            detalhe: c.cargo ?? "Contato",
          });
        }
      });

      return result;
    },
  });

  const resetForm = () => {
    setMode("client");
    setInstanceId(instances.length === 1 ? instances[0].id : "");
    setSelectedContactPhone("");
    setSelectedContactName("");
    setThirdPartyPhone("55");
    setThirdPartyName("");
    setThirdPartyLabel("");
  };

  const handleStart = async () => {
    if (!instanceId) {
      toast.error("Selecione uma instância");
      return;
    }

    const phone = mode === "client" ? selectedContactPhone : thirdPartyPhone.replace(/\D/g, "");
    const contactName = mode === "client" ? selectedContactName : thirdPartyName.trim();
    const participantType = mode;
    const participantLabel = mode === "third_party" ? thirdPartyLabel.trim() || thirdPartyName.trim() : null;

    if (!phone || phone.length < 10) {
      toast.error("Telefone inválido");
      return;
    }

    setSending(true);
    try {
      const { data, error } = await (supabase.rpc as any)("start_conversation_from_ticket", {
        p_ticket_id: ticketId,
        p_instance_id: instanceId,
        p_phone: phone,
        p_contact_name: contactName || phone,
        p_participant_type: participantType,
        p_participant_label: participantLabel,
        p_department_id: departmentId || null,
      });
      if (error) throw error;

      toast.success("Conversa iniciada");
      onOpenChange(false);
      resetForm();
      onCreated?.();

      const convId = (data as any)?.conversation_id;
      if (convId) {
        navigate(`/whatsapp?conversation=${convId}`);
      }
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) resetForm();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Iniciar conversa
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Ticket {ticketCode}
            {clienteNome ? ` · ${clienteNome}` : ""}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Instância WhatsApp</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger className="h-9">
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

          <div className="space-y-1.5">
            <Label className="text-xs">Conversar com</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "client" | "third_party")} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="client" id="mode-client" />
                <Label htmlFor="mode-client" className="flex items-center gap-1.5 text-sm font-normal cursor-pointer">
                  <User className="h-3.5 w-3.5" /> Contato do cliente
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="third_party" id="mode-third" />
                <Label htmlFor="mode-third" className="flex items-center gap-1.5 text-sm font-normal cursor-pointer">
                  <Building2 className="h-3.5 w-3.5" /> Terceiro / Externo
                </Label>
              </div>
            </RadioGroup>
          </div>

          {mode === "client" && (
            <div className="space-y-1.5">
              {clienteContatos.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center border rounded-md">
                  Nenhum contato com telefone cadastrado
                </p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {clienteContatos.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedContactPhone(c.phone);
                        setSelectedContactName(c.nome);
                      }}
                      className={`w-full flex items-center gap-2 p-2.5 rounded-md border text-left text-sm transition-colors ${
                        selectedContactPhone === c.phone
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{c.nome}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.phone} · {c.detalhe}
                        </p>
                      </div>
                      {selectedContactPhone === c.phone && (
                        <Badge variant="secondary" className="text-[10px]">
                          Selecionado
                        </Badge>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === "third_party" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Telefone *</Label>
                <Input
                  value={thirdPartyPhone}
                  onChange={(e) => setThirdPartyPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="5549999999999"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nome</Label>
                <Input
                  value={thirdPartyName}
                  onChange={(e) => setThirdPartyName(e.target.value)}
                  placeholder="Nome do contato"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Identificação</Label>
                <Input
                  value={thirdPartyLabel}
                  onChange={(e) => setThirdPartyLabel(e.target.value)}
                  placeholder="Ex: Contabilidade Silva, TI do cliente"
                  className="h-9"
                />
                <p className="text-[11px] text-muted-foreground">
                  Aparece na lista de conversas vinculadas ao ticket
                </p>
              </div>
            </div>
          )}

          <Button onClick={handleStart} disabled={sending} className="w-full">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            Iniciar conversa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { StartConversationFromTicketDialog };
