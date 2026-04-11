import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const formSchema = z.object({
  display_name: z.string().min(1, "Nome obrigatório"),
  instance_name: z.string().min(1, "Nome da instância obrigatório").regex(/^[a-zA-Z0-9_-]+$/, "Apenas letras, números, _ e -"),
  instance_id_external: z.string().optional(),
  provider_type: z.enum(["self_hosted", "cloud", "meta_cloud", "zapi"]),
  // Evolution
  api_url: z.string().optional(),
  api_key: z.string().optional(),
  // Z-API
  zapi_instance_id: z.string().optional(),
  zapi_token: z.string().optional(),
  zapi_client_token: z.string().optional(),
  // Meta Cloud
  meta_phone_number_id: z.string().optional(),
  meta_access_token: z.string().optional(),
  meta_app_secret: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface EditInstanceDialogProps {
  instance: {
    id: string;
    instance_name: string;
    display_name: string | null;
    provider_type: string;
    instance_id_external: string | null;
    meta_phone_number_id?: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const EditInstanceDialog = ({ instance, open, onOpenChange }: EditInstanceDialogProps) => {
  const { updateInstance } = useWhatsAppInstances();

  const { data: secrets } = useQuery({
    queryKey: ['whatsapp', 'instance-secrets', instance.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_instance_secrets', {
        p_instance_id: instance.id,
      });
      if (error) throw error;
      return (data ?? {}) as {
        api_url?: string;
        api_key?: string;
        zapi_instance_id?: string;
        zapi_token?: string;
        zapi_client_token?: string;
        meta_access_token?: string;
        meta_app_secret?: string;
      };
    },
    enabled: open,
    staleTime: 0,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      display_name: instance.display_name || '',
      instance_name: instance.instance_name,
      instance_id_external: instance.instance_id_external || '',
      provider_type: (instance.provider_type as FormValues['provider_type']) || 'self_hosted',
      api_url: '',
      api_key: '',
      zapi_instance_id: '',
      zapi_token: '',
      zapi_client_token: '',
      meta_phone_number_id: instance.meta_phone_number_id || '',
      meta_access_token: '',
      meta_app_secret: '',
    },
  });

  const providerType = form.watch("provider_type");

  useEffect(() => {
    form.reset({
      display_name: instance.display_name || '',
      instance_name: instance.instance_name,
      instance_id_external: instance.instance_id_external || '',
      provider_type: (instance.provider_type as FormValues['provider_type']) || 'self_hosted',
      api_url: '',
      api_key: '',
      zapi_instance_id: '',
      zapi_token: '',
      zapi_client_token: '',
      meta_phone_number_id: instance.meta_phone_number_id || '',
      meta_access_token: '',
      meta_app_secret: '',
    });
  }, [instance]);

  useEffect(() => {
    if (!secrets) return;
    form.setValue('api_url', secrets.api_url || '');
    form.setValue('api_key', secrets.api_key || '');
    form.setValue('zapi_instance_id', secrets.zapi_instance_id || '');
    form.setValue('zapi_token', secrets.zapi_token || '');
    form.setValue('zapi_client_token', secrets.zapi_client_token || '');
    form.setValue('meta_access_token', secrets.meta_access_token || '');
    form.setValue('meta_app_secret', secrets.meta_app_secret || '');
  }, [secrets]);

  const onSubmit = async (values: FormValues) => {
    try {
      const isZapi = values.provider_type === 'zapi';
      const isMeta = values.provider_type === 'meta_cloud';
      await updateInstance.mutateAsync({
        id: instance.id,
        updates: {
          display_name: values.display_name,
          instance_name: values.instance_name,
          instance_id_external: values.provider_type === 'cloud' ? values.instance_id_external : null,
          provider_type: values.provider_type,
          ...((!isMeta && !isZapi) && { api_url: values.api_url, api_key: values.api_key }),
          ...(isMeta && { meta_phone_number_id: values.meta_phone_number_id, meta_access_token: values.meta_access_token, meta_app_secret: values.meta_app_secret }),
          ...(isZapi && { zapi_instance_id: values.zapi_instance_id, zapi_token: values.zapi_token, zapi_client_token: values.zapi_client_token }),
        },
      });
      toast.success("Instância atualizada com sucesso!");
      onOpenChange(false);
    } catch {
      toast.error("Erro ao atualizar instância");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Editar Instância</DialogTitle>
          <DialogDescription>Atualize as informações da instância</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            <FormField control={form.control} name="provider_type" render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo de Provedor</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="self_hosted">Evolution API Self-Hosted</SelectItem>
                    <SelectItem value="cloud">Evolution API Cloud</SelectItem>
                    <SelectItem value="meta_cloud">Meta Cloud API (Oficial)</SelectItem>
                    <SelectItem value="zapi">Z-API</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="display_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl><Input placeholder="Minha Instância" autoComplete="off" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="instance_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Nome da Instância</FormLabel>
                <FormControl><Input placeholder="my-instance" autoComplete="off" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {providerType === 'cloud' && (
              <FormField control={form.control} name="instance_id_external" render={({ field }) => (
                <FormItem>
                  <FormLabel>ID da Instância (UUID)</FormLabel>
                  <FormControl><Input placeholder="ead6f2f2-7633-4e41-a08d-7272300a6ba1" autoComplete="off" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            {(providerType === 'self_hosted' || providerType === 'cloud') && (
              <>
                <FormField control={form.control} name="api_url" render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL da API</FormLabel>
                    <FormControl><Input placeholder={providerType === 'cloud' ? "https://api.evoapicloud.com" : "https://api.evolution.com"} autoComplete="off" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="api_key" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{providerType === 'cloud' ? 'Token da Instância' : 'API Key'}</FormLabel>
                    <FormControl><Input type="password" placeholder="••••••••" autoComplete="new-password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </>
            )}

            {providerType === 'zapi' && (
              <>
                <FormField control={form.control} name="zapi_instance_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ID da Instância Z-API *</FormLabel>
                    <FormControl><Input placeholder="ID da instância no painel Z-API" autoComplete="off" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="zapi_token" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Token Z-API *</FormLabel>
                    <FormControl><Input type="password" placeholder="••••••••" autoComplete="new-password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="zapi_client_token" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client-Token Z-API (opcional)</FormLabel>
                    <FormControl><Input type="password" placeholder="••••••••" autoComplete="new-password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </>
            )}

            {providerType === 'meta_cloud' && (
              <>
                <FormField control={form.control} name="meta_phone_number_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number ID</FormLabel>
                    <FormControl><Input placeholder="123456789012345" autoComplete="off" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="meta_access_token" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Access Token (Permanente)</FormLabel>
                    <FormControl><Input type="password" placeholder="••••••••" autoComplete="new-password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="meta_app_secret" render={({ field }) => (
                  <FormItem>
                    <FormLabel>App Secret</FormLabel>
                    <FormControl><Input type="password" placeholder="••••••••" autoComplete="new-password" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">
                      Encontrado em: Meta for Developers → Seu App → Configurações → App Secret. Usado para validar a autenticidade dos webhooks.
                    </p>
                    <FormMessage />
                  </FormItem>
                )} />
              </>
            )}

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={updateInstance.isPending}>
                {updateInstance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
              </Button>
            </div>

          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};