import { useState } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { Loader2, Check, Copy, Link as LinkIcon, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const formSchema = z.object({
  display_name: z.string().min(1, "Nome obrigatório"),
  instance_name: z.string().min(1, "Nome da instância obrigatório").regex(/^[a-zA-Z0-9_-]+$/, "Apenas letras, números, _ e -"),
  instance_id_external: z.string().optional(),
  api_url: z.string().url("URL inválida").or(z.literal("")),
  api_key: z.string().min(1, "Token/API Key obrigatório").or(z.literal("")),
  provider_type: z.enum(["self_hosted", "cloud", "meta_cloud"]),
  // Meta Cloud specific
  meta_phone_number_id: z.string().optional(),
  meta_access_token: z.string().optional(),
  meta_verify_token: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.provider_type !== 'meta_cloud') {
    if (!data.api_url) ctx.addIssue({ code: 'custom', path: ['api_url'], message: 'URL inválida' });
    if (!data.api_key) ctx.addIssue({ code: 'custom', path: ['api_key'], message: 'Token/API Key obrigatório' });
  } else {
    if (!data.meta_phone_number_id) ctx.addIssue({ code: 'custom', path: ['meta_phone_number_id'], message: 'Phone Number ID obrigatório' });
    if (!data.meta_access_token) ctx.addIssue({ code: 'custom', path: ['meta_access_token'], message: 'Access Token obrigatório' });
    if (!data.meta_verify_token) ctx.addIssue({ code: 'custom', path: ['meta_verify_token'], message: 'Verify Token obrigatório' });
  }
});

type FormValues = z.infer<typeof formSchema>;

interface AddInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AddInstanceDialog = ({ open, onOpenChange }: AddInstanceDialogProps) => {
  const { createInstance } = useWhatsAppInstances();
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  const [showWebhookInstructions, setShowWebhookInstructions] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      display_name: "", instance_name: "", instance_id_external: "",
      api_url: "", api_key: "", provider_type: "self_hosted",
      meta_phone_number_id: "", meta_access_token: "", meta_verify_token: "",
    },
  });

  const providerType = form.watch("provider_type");

  const handleTestConnection = async () => {
    const values = form.getValues();
    const fieldsToValidate = values.provider_type === 'cloud'
      ? ["api_url", "api_key", "instance_name", "instance_id_external"] as const
      : ["api_url", "api_key", "instance_name"] as const;
    const isValid = await form.trigger(fieldsToValidate);
    if (!isValid) { toast.error("Preencha os campos obrigatórios"); return; }
    if (values.provider_type === 'cloud' && !values.instance_id_external) {
      toast.error("ID da Instância é obrigatório para Evolution Cloud"); return;
    }

    setIsTestingConnection(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-evolution-connection', {
        body: {
          api_url: values.api_url, api_key: values.api_key,
          instance_name: values.instance_name, instance_id_external: values.instance_id_external,
          provider_type: values.provider_type,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setConnectionTested(true);
      toast.success("Conexão testada com sucesso!");
    } catch (error) {
      toast.error(`Falha: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
      setConnectionTested(false);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    try {
      await createInstance.mutateAsync({
        display_name: values.display_name,
        instance_name: values.instance_name,
        instance_id_external: values.provider_type === 'cloud' ? values.instance_id_external : undefined,
        api_url: values.api_url, api_key: values.api_key,
        provider_type: values.provider_type,
      });
      setShowWebhookInstructions(true);
      form.reset();
      setConnectionTested(false);
    } catch {
      toast.error("Erro ao criar instância");
    }
  };

  const handleClose = () => {
    if (!showWebhookInstructions) { form.reset(); setConnectionTested(false); }
    setShowWebhookInstructions(false);
    onOpenChange(false);
  };

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evolution-webhook`;
  const copyWebhookUrl = () => { navigator.clipboard.writeText(webhookUrl); toast.success("URL copiada!"); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        {!showWebhookInstructions ? (
          <>
            <DialogHeader>
              <DialogTitle>Nova Instância</DialogTitle>
              <DialogDescription>Adicione uma nova instância da Evolution API</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="provider_type" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-1.5">
                      <FormLabel>Tipo de Provedor</FormLabel>
                      <Tooltip><TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground cursor-help" /></TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[250px]"><p>Selecione <strong>Self-Hosted</strong> se instalou o Evolution em seu servidor. <strong>Cloud</strong> se usa Evolution Cloud.</p></TooltipContent>
                      </Tooltip>
                    </div>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="self_hosted">Evolution API Self-Hosted</SelectItem>
                        <SelectItem value="cloud">Evolution API Cloud</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="display_name" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-1.5">
                      <FormLabel>Nome</FormLabel>
                      <Tooltip><TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground cursor-help" /></TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[250px]"><p>Nome para identificar a instância (ex: 'WhatsApp Vendas')</p></TooltipContent>
                      </Tooltip>
                    </div>
                    <FormControl><Input placeholder="Minha Instância" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="instance_name" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-1.5">
                      <FormLabel>Nome da Instância</FormLabel>
                      <Tooltip><TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground cursor-help" /></TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[250px]"><p>Nome exato da instância no Evolution API.</p></TooltipContent>
                      </Tooltip>
                    </div>
                    <FormControl><Input placeholder="my-instance" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {providerType === 'cloud' && (
                  <FormField control={form.control} name="instance_id_external" render={({ field }) => (
                    <FormItem>
                      <FormLabel>ID da Instância (UUID)</FormLabel>
                      <FormControl><Input placeholder="ead6f2f2-7633-4e41-a08d-7272300a6ba1" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}

                <FormField control={form.control} name="api_url" render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL da API</FormLabel>
                    <FormControl>
                      <Input placeholder={providerType === 'cloud' ? "https://api.evoapicloud.com" : "https://api.evolution.com"} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="api_key" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{providerType === 'cloud' ? 'Token da Instância' : 'API Key'}</FormLabel>
                    <FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={handleTestConnection} disabled={isTestingConnection}>
                    {isTestingConnection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : connectionTested ? <Check className="mr-2 h-4 w-4" /> : null}
                    Testar Conexão
                  </Button>
                  <Button type="submit" disabled={!connectionTested || createInstance.isPending} className="ml-auto">
                    {createInstance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar
                  </Button>
                </div>
              </form>
            </Form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-500" />Instância criada com sucesso!
              </DialogTitle>
              <DialogDescription>Configure o webhook na Evolution API</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Alert>
                <LinkIcon className="h-4 w-4" />
                <AlertDescription className="space-y-2 mt-2">
                  <div>
                    <strong>URL do Webhook:</strong>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="flex-1 bg-muted p-2 rounded text-xs break-all">{webhookUrl}</code>
                      <Button size="sm" variant="outline" onClick={copyWebhookUrl}><Copy className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <div className="mt-4">
                    <strong>Events:</strong>
                    <ul className="list-disc list-inside text-sm mt-1 space-y-1">
                      <li>MESSAGES_UPSERT</li>
                      <li>MESSAGES_UPDATE</li>
                      <li>CONNECTION_UPDATE</li>
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>
              <Button onClick={handleClose} className="w-full">Fechar</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
