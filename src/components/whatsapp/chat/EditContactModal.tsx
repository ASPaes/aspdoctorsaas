import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useWhatsAppActions } from '../hooks/useWhatsAppActions';
import { useClienteSearch } from '../hooks/useClienteSearch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { maskPhoneBR } from '@/lib/masks';
import { Link2, Search, Loader2, X, Building2 } from 'lucide-react';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkedCliente, setLinkedCliente] = useState<{ id: string; label: string } | null>(null);
  const { results: searchResults, isLoading: isSearching } = useClienteSearch(searchOpen ? searchTerm : '');

  const { register, handleSubmit, formState: { errors }, reset } = useForm<ContactFormData>({
    defaultValues: { name: contactName, notes: contactNotes || '' },
  });

  useEffect(() => {
    if (open) {
      reset({ name: contactName, notes: contactNotes || '' });
      setLinkedCliente(null);
      setSearchOpen(false);
      setSearchTerm('');
    }
  }, [open, contactName, contactNotes, reset]);

  const onSubmit = async (data: ContactFormData) => {
    if (isNewContact) {
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

        const digits = contactPhone.replace(/\D/g, '');
        const { data: existing } = await supabase
          .from('whatsapp_contacts')
          .select('id, name')
          .eq('tenant_id', profile.tenant_id)
          .eq('phone_number', digits)
          .maybeSingle();

        if (existing) {
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

        // If a cliente was linked, sync the phone to cliente_contatos
        if (linkedCliente) {
          const { data: existingContato } = await supabase
            .from('cliente_contatos')
            .select('id')
            .eq('cliente_id', linkedCliente.id)
            .eq('fone', digits)
            .maybeSingle();

          if (!existingContato) {
            await supabase
              .from('cliente_contatos')
              .insert({
                cliente_id: linkedCliente.id,
                nome: data.name,
                fone: digits,
                tenant_id: profile.tenant_id,
              });
          }
          toast.success(`Contato vinculado ao cliente ${linkedCliente.label}`);
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

            {/* Vincular empresa */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                Vincular empresa
              </Label>
              {linkedCliente ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
                  <Link2 className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium truncate flex-1">{linkedCliente.label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setLinkedCliente(null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={searchTerm}
                      onChange={(e) => { setSearchTerm(e.target.value); setSearchOpen(true); }}
                      onFocus={() => setSearchOpen(true)}
                      placeholder="Buscar por nome, CNPJ ou código..."
                      className="text-sm pl-8"
                    />
                  </div>
                  {searchOpen && searchTerm.length >= 2 && (
                    <div className="border border-border rounded-md max-h-36 overflow-y-auto">
                      {isSearching && (
                        <div className="flex justify-center py-2">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      {searchResults.length > 0 && searchResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-accent text-xs flex items-center justify-between gap-2 transition-colors"
                          onClick={() => {
                            setLinkedCliente({
                              id: c.id,
                              label: `#${c.codigo_sequencial} — ${c.nome_fantasia || c.razao_social || 'Sem nome'}`,
                            });
                            setSearchOpen(false);
                            setSearchTerm('');
                          }}
                        >
                          <span className="truncate">
                            <span className="text-muted-foreground">#{c.codigo_sequencial}</span>{' '}
                            {c.nome_fantasia || c.razao_social}
                          </span>
                          <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                      {!isSearching && searchResults.length === 0 && (
                        <p className="text-[11px] text-muted-foreground text-center py-2">Nenhum cliente encontrado</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea id="notes" {...register('notes')} placeholder="Adicione observações..." rows={3} />
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