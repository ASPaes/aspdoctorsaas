import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  api_url: z.string().url("URL inválida"),
  api_key: z.string().min(1, "Token/API Key obrigatório"),
  provider_type: z.enum(["self_hosted", "cloud"]),
});

type FormValues = z.infer<typeof formSchema>;

interface EditInstanceDialogProps {
  instance: {
    id: string;
    instance_name: string;
    display_name: string | null;
    provider_type: string;
    instance_id_external: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const EditInstanceDialog = ({ instance, open, onOpenChange }: EditInstanceDialogProps) => {
  const { updateInstance } = useWhatsAppInstances();

  const { data: secrets } = useQuery({
    queryKey: ['whatsapp', 'instance-secrets', instance.id],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('whatsapp_instance_secrets') as any)
        .select('api_url, api_key')
        .eq('instance_id', instance.id)
        .single();
      if (error) throw error;
      return data as { api_url: string; api_key: string };
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
      api_url: '', api_key: '',
      provider_type: (instance.provider_type as "self_hosted" | "cloud") || 'self_hosted',
    },
  });

  const providerType = form.watch("provider_type");

  useEffect(() => {
    form.reset({
      display_name: instance.display_name || '',
      instance_name: instance.instance_name,
      instance_id_external: instance.instance_id_external || '',
      api_url: secrets?.api_url || '',
      api_key: secrets?.api_key || '',
      provider_type: (instance.provider_type as "self_hosted" | "cloud") || 'self_hosted',
    });
  }, [instance, secrets, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      await updateInstance.mutateAsync({
        id: instance.id,
        updates: {
          display_name: values.display_name,
          instance_name: values.instance_name,
          instance_id_external: values.provider_type === 'cloud' ? values.instance_id_external : null,
          api_url: values.api_url, api_key: values.api_key,
          provider_type: values.provider_type,
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
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="self_hosted">Evolution API Self-Hosted</SelectItem>
                    <SelectItem value="cloud">Evolution API Cloud</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="display_name" render={({ field }) => (
              <FormItem><FormLabel>Nome</FormLabel><FormControl><Input placeholder="Minha Instância" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="instance_name" render={({ field }) => (
              <FormItem><FormLabel>Nome da Instância</FormLabel><FormControl><Input placeholder="my-instance" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            {providerType === 'cloud' && (
              <FormField control={form.control} name="instance_id_external" render={({ field }) => (
                <FormItem><FormLabel>ID da Instância (UUID)</FormLabel><FormControl><Input placeholder="ead6f2f2-..." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            )}
            <FormField control={form.control} name="api_url" render={({ field }) => (
              <FormItem><FormLabel>URL da API</FormLabel><FormControl><Input placeholder={providerType === 'cloud' ? "https://api.evoapicloud.com" : "https://api.evolution.com"} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="api_key" render={({ field }) => (
              <FormItem><FormLabel>{providerType === 'cloud' ? 'Token da Instância' : 'API Key'}</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="flex justify-end gap-2">
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
