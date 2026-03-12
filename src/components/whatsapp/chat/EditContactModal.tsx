import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useWhatsAppActions } from '../hooks/useWhatsAppActions';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { maskPhoneBR } from '@/lib/masks';

interface EditContactModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string;
  contactNotes?: string | null;
  onSuccess?: () => void;
  isNewContact?: boolean;
}

interface ContactFormData { name: string; notes: string; }

export function EditContactModal({ open, onOpenChange, contactId, contactName, contactPhone, contactNotes, onSuccess, isNewContact }: EditContactModalProps) {
  const { updateContact, isUpdatingContact } = useWhatsAppActions();
  const [isSaving, setIsSaving] = useState(false);
  const { register, handleSubmit, formState: { errors }, reset } = useForm<ContactFormData>({
    defaultValues: { name: contactName, notes: contactNotes || '' },
  });

  useEffect(() => {
    if (open) reset({ name: contactName, notes: contactNotes || '' });
  }, [open, contactName, contactNotes, reset]);

  const onSubmit = async (data: ContactFormData) => {
    if (isNewContact) {
      // Create new contact in whatsapp_contacts
      setIsSaving(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          toast.error('Usuário não autenticado');
          return;
        }
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('user_id', user.id)
          .eq('status', 'ativo')
          .maybeSingle();

        if (!profile?.tenant_id) {
          toast.error('Tenant não encontrado');
          return;
        }

        // Check if contact already exists with this phone
        const digits = contactPhone.replace(/\D/g, '');
        const { data: existing } = await supabase
          .from('whatsapp_contacts')
          .select('id, name')
          .eq('tenant_id', profile.tenant_id)
          .eq('phone_number', digits)
          .maybeSingle();

        if (existing) {
          // Update existing contact name/notes
          await supabase
            .from('whatsapp_contacts')
            .update({
              name: data.name,
              notes: data.notes || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          toast.success(`Contato "${data.name}" atualizado`);
        } else {
          // Create new contact
          const { error } = await supabase
            .from('whatsapp_contacts')
            .insert({
              phone_number: digits,
              name: data.name,
              notes: data.notes || null,
              tenant_id: profile.tenant_id,
              is_group: false,
            });
          if (error) throw error;
          toast.success(`Contato "${data.name}" salvo com sucesso`);
        }

        onOpenChange(false);
        onSuccess?.();
      } catch (err: any) {
        console.error('Error saving contact:', err);
        toast.error('Erro ao salvar contato');
      } finally {
        setIsSaving(false);
      }
    } else {
      updateContact(
        { contactId, data: { name: data.name, notes: data.notes || null } },
        { onSuccess: () => { onOpenChange(false); onSuccess?.(); } }
      );
    }
  };

  const saving = isNewContact ? isSaving : isUpdatingContact;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{isNewContact ? 'Salvar Contato' : 'Editar Contato'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={contactPhone ? maskPhoneBR(contactPhone) : ''} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input id="name" {...register('name', { required: 'Nome é obrigatório', minLength: { value: 2, message: 'Mínimo 2 caracteres' } })} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea id="notes" {...register('notes')} placeholder="Adicione observações..." rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
