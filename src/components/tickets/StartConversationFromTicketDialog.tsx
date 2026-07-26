import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PhoneInputBR } from "@/components/ui/PhoneInputBR";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { normalizeBRPhone, isValidBRPhone, formatBRPhone } from "@/lib/phoneBR";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, User, Building2, MessageCircle, AlertCircle } from "lucide-react";
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

interface ContatoOption {
  id: string;
  nome: string;
  /** Digits-only, já normalizado com DDI 55 — é o que vai para o RPC */
  phone: string;
  /** Formatado para exibição: +55 (DD) NNNNN-NNNN */
  display: string;
  detalhe: string;
}

/** Referência estável: evita re-disparar o efeito de pré-seleção a cada render */
const EMPTY_CONTATOS: { contatos: ContatoOption[]; invalidCount: number } = {
  contatos: [],
  invalidCount: 0,
};

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
  const [thirdPartyPhone, setThirdPartyPhone] = useState("");
  const [thirdPartyName, setThirdPartyName] = useState("");
  const [thirdPartyLabel, setThirdPartyLabel] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open && !instanceId && instances.length === 1) {
      setInstanceId(instances[0].id);
    }
  }, [open, instances, instanceId]);

  const { data: contatosData = EMPTY_CONTATOS } = useQuery({
    queryKey: ["ticket_start_conv_contatos", clienteId],
    enabled: !!clienteId && open,
    queryFn: async () => {
      if (!clienteId) return EMPTY_CONTATOS;

      const { data: cli } = await (supabase.from("clientes" as any) as any)
        .select("contato_nome, contato_fone, telefone_whatsapp, nome_fantasia")
        .eq("id", clienteId)
        .maybeSingle();

      const { data: contatos } = await (supabase.from("cliente_contatos" as any) as any)
        .select("id, nome, fone, cargo")
        .eq("cliente_id", clienteId)
        .not("fone", "is", null)
        .order("nome");

      const result: ContatoOption[] = [];
      let invalidCount = 0;

      // Normaliza para DDI 55 antes de ofertar: contato salvo sem o 55 passa a funcionar,
      // o mesmo número salvo com e sem DDI deduplica, e telefone quebrado não é oferecido.
      const push = (id: string, nome: string, rawPhone: string | null, detalhe: string) => {
        const digits = (rawPhone ?? "").replace(/\D/g, "");
        if (!digits) return;

        const phone = normalizeBRPhone(digits);
        if (!isValidBRPhone(phone)) {
          invalidCount++;
          return;
        }
        if (result.some((r) => r.phone === phone)) return;

        result.push({ id, nome, phone, display: formatBRPhone(phone), detalhe });
      };

      if (cli?.telefone_whatsapp) {
        push(
          "whatsapp_principal",
          cli.nome_fantasia ?? "Principal",
          cli.telefone_whatsapp,
          "WhatsApp principal",
        );
      }

      if (cli?.contato_nome && cli?.contato_fone) {
        push("contato_principal", cli.contato_nome, cli.contato_fone, "Contato principal");
      }

      (contatos ?? []).forEach((c: any) => {
        push(c.id, c.nome, c.fone, c.cargo ?? "Contato");
      });

      return { contatos: result, invalidCount };
    },
  });

  const clienteContatos = contatosData.contatos;
  const contatosDescartados = contatosData.invalidCount;

  // Contato único já vem marcado — mesmo padrão da instância única acima.
  useEffect(() => {
    if (open && mode === "client" && !selectedContactPhone && clienteContatos.length === 1) {
      setSelectedContactPhone(clienteContatos[0].phone);
      setSelectedContactName(clienteContatos[0].nome);
    }
  }, [open, mode, selectedContactPhone, clienteContatos]);

  const thirdPartyNormalized = normalizeBRPhone(thirdPartyPhone);
  const thirdPartyValid = isValidBRPhone(thirdPartyNormalized);

  const needInstance = !instanceId;
  const needContact = mode === "client" && !selectedContactPhone;
  const needPhone = mode === "third_party" && !thirdPartyValid;
  const canStart = !needInstance && !needContact && !needPhone;

  let hint: string | null = null;
  if (needInstance && needContact) hint = "Selecione a instância e o contato para continuar";
  else if (needInstance && needPhone) hint = "Selecione a instância e informe o telefone para continuar";
  else if (needInstance) hint = "Selecione a instância para continuar";
  else if (needContact) hint = "Selecione o contato para continuar";
  else if (needPhone) {
    hint = thirdPartyPhone.replace(/\D/g, "").length > 0
      ? "Telefone incompleto ou inválido"
      : "Informe o telefone para continuar";
  }

  const resetForm = () => {
    setMode("client");
    setInstanceId(instances.length === 1 ? instances[0].id : "");
    setSelectedContactPhone("");
    setSelectedContactName("");
    setThirdPartyPhone("");
    setThirdPartyName("");
    setThirdPartyLabel("");
  };

  const handleStart = async () => {
    if (!canStart) return;

    const phone = mode === "client" ? selectedContactPhone : thirdPartyNormalized;
    const contactName = mode === "client" ? selectedContactName : thirdPartyName.trim();
    const participantType = mode;
    const participantLabel = mode === "third_party" ? thirdPartyLabel.trim() || thirdPartyName.trim() : null;

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
                <div className="rounded-md border border-dashed p-4 text-center space-y-2.5">
                  <p className="text-xs text-muted-foreground">
                    {contatosDescartados > 0
                      ? "Nenhum contato do cliente tem telefone válido cadastrado"
                      : "Nenhum contato com telefone cadastrado"}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setMode("third_party")}
                  >
                    <Building2 className="h-3.5 w-3.5" /> Informar telefone manualmente
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Contato</Label>
                    {!selectedContactPhone && (
                      <span className="text-[11px] text-muted-foreground">Selecione um</span>
                    )}
                  </div>
                  <div
                    role="radiogroup"
                    aria-label="Contato do cliente"
                    className="space-y-1.5 max-h-64 overflow-y-auto"
                  >
                    {clienteContatos.map((c) => {
                      const selected = selectedContactPhone === c.phone;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            setSelectedContactPhone(c.phone);
                            setSelectedContactName(c.nome);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2.5 p-2.5 rounded-md border text-left text-sm transition-colors",
                            selected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted/50",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors",
                              selected ? "border-primary" : "border-muted-foreground/40",
                            )}
                          >
                            {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{c.nome}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {c.display} · {c.detalhe}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {mode === "third_party" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Telefone *</Label>
                <PhoneInputBR
                  value={thirdPartyPhone}
                  onChange={setThirdPartyPhone}
                  showError
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

          <div className="space-y-1.5">
            <Button
              onClick={handleStart}
              disabled={sending || !canStart}
              aria-describedby={hint ? "start-conv-hint" : undefined}
              className="w-full"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
              Iniciar conversa
            </Button>
            {hint && !sending && (
              <p
                id="start-conv-hint"
                className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                {hint}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { StartConversationFromTicketDialog };
