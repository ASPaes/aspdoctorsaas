import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Phone, User } from 'lucide-react';
import { toast } from 'sonner';
import { normalizeBRPhone, isValidBRPhone, maskBRPhoneLive } from '@/lib/phoneBR';
import { useWhatsAppInstances } from '../hooks/useWhatsAppInstances';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { useCreateDirectoryContact } from '../hooks/useCreateDirectoryContact';
import { useUpdateDirectoryContact } from '../hooks/useUpdateDirectoryContact';
import { ClienteSearchSelect, type SelectedCliente } from './ClienteSearchSelect';

export interface EditableContact {
  id: string;
  name: string | null;
  phone_number: string;
  notes: string | null;
  is_group?: boolean;
}

interface ContactDirectoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado após salvar; recebe o id do contato para seleção na lista. */
  onSaved?: (contactId: string) => void;
  /** Presente = modo edição. Ausente = modo criação. */
  contact?: EditableContact | null;
  /** Cliente já vinculado (modo edição), para pré-preencher. */
  initialCliente?: SelectedCliente | null;
}

const NO_INSTANCE = '__none__';

export function ContactDirectoryDialog({ open, onOpenChange, onSaved, contact, initialCliente }: ContactDirectoryDialogProps) {
  const isEdit = !!contact;
  const isGroup = !!contact?.is_group;

  const { instances } = useWhatsAppInstances();
  const { effectiveTenantId } = useTenantFilter();
  const createContact = useCreateDirectoryContact();
  const updateContact = useUpdateDirectoryContact();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [instanceId, setInstanceId] = useState<string>(NO_INSTANCE);
  const [cliente, setCliente] = useState<SelectedCliente | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(contact?.name ?? '');
    setPhone(contact?.phone_number ? maskBRPhoneLive(contact.phone_number) : '');
    setNotes(contact?.notes ?? '');
    setInstanceId(NO_INSTANCE);
    setCliente(initialCliente ?? null);
    setError(null);
  }, [open, contact, initialCliente]);

  const noTenant = !isEdit && !effectiveTenantId;
  const pending = createContact.isPending || updateContact.isPending;

  const handleSubmit = async () => {
    setError(null);

    if (name.trim().length < 2) {
      setError('Informe um nome (mínimo 2 caracteres).');
      return;
    }

    // Telefone: obrigatório/validado exceto grupos
    let normalized: string | null = null;
    if (!isGroup) {
      normalized = normalizeBRPhone(phone);
      if (!isValidBRPhone(normalized)) {
        setError('Telefone inválido. Use DDD + número (ex: (51) 99876-5432).');
        return;
      }
    }

    try {
      if (isEdit) {
        await updateContact.mutateAsync({
          contactId: contact!.id,
          name,
          phone: normalized,
          notes: notes.trim() ? notes.trim() : null,
          clienteId: cliente?.id ?? null,
        });
        toast.success('Contato atualizado.');
        onOpenChange(false);
        onSaved?.(contact!.id);
      } else {
        const result = await createContact.mutateAsync({
          name,
          phone: normalized!,
          clienteId: cliente?.id ?? null,
          instanceId: instanceId === NO_INSTANCE ? null : instanceId,
        });
        if (result.already_existed) {
          toast.info(cliente ? 'Esse número já estava na lista — vínculo atualizado.' : 'Esse número já estava na lista.');
        } else {
          toast.success(`Contato "${name.trim()}" criado.`);
        }
        onOpenChange(false);
        onSaved?.(result.contact_id);
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Erro ao salvar contato';
      setError(msg);
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? (isGroup ? 'Editar grupo' : 'Editar contato') : 'Adicionar contato'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Atualize os dados do contato e o cliente vinculado.'
              : 'Cadastre um contato no diretório e, opcionalmente, vincule a um cliente.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {noTenant && (
            <p className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 px-3 py-2">
              Selecione um tenant específico (topo da tela) para adicionar um contato.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="contact-name" className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Nome *
            </Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do contato"
              autoFocus
            />
          </div>

          {!isGroup && (
            <div className="space-y-2">
              <Label htmlFor="contact-phone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> Telefone *
              </Label>
              <Input
                id="contact-phone"
                value={phone}
                onChange={(e) => setPhone(maskBRPhoneLive(e.target.value))}
                placeholder="+55 (DD) 9XXXX-XXXX"
                inputMode="tel"
              />
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  Edite caso o número esteja com um dígito a mais (ex: 9 extra).
                </p>
              )}
            </div>
          )}

          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="contact-instance">Instância (opcional)</Label>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger id="contact-instance" className="h-9">
                  <SelectValue placeholder="Sem instância" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INSTANCE}>Sem instância</SelectItem>
                  {instances.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.display_name || inst.instance_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Vincular cliente (opcional)
            </Label>
            <ClienteSearchSelect value={cliente} onChange={setCliente} inputId="contact-cliente" />
          </div>

          {isEdit && (
            <div className="space-y-2">
              <Label htmlFor="contact-notes">Observações</Label>
              <Textarea
                id="contact-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Adicione observações..."
                rows={3}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={pending || noTenant}>
            {pending ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Salvar contato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
