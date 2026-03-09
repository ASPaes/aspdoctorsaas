import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useWhatsAppMacros, type WhatsAppMacro } from "@/components/whatsapp/hooks/useWhatsAppMacros";
import { Loader2 } from "lucide-react";

const formSchema = z.object({
  title: z.string().min(1, "Nome obrigatório"),
  content: z.string().min(1, "Conteúdo obrigatório"),
  shortcut: z.string().optional(),
  category: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const CATEGORIES = ["Saudação", "Encerramento", "FAQ", "Suporte", "Vendas", "Outro"];

interface MacroDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  macro?: WhatsAppMacro;
}

export function MacroDialog({ open, onOpenChange, macro }: MacroDialogProps) {
  const { createMacro, updateMacro, isCreating, isUpdating } = useWhatsAppMacros();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", content: "", shortcut: "", category: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        title: macro?.title || "",
        content: macro?.content || "",
        shortcut: macro?.shortcut || "",
        category: macro?.category || "",
      });
    }
  }, [open, macro, form]);

  const onSubmit = (values: FormValues) => {
    const payload = {
      title: values.title,
      content: values.content,
      shortcut: values.shortcut || null,
      category: values.category || null,
    };

    if (macro) {
      updateMacro({ id: macro.id, updates: payload });
    } else {
      createMacro(payload);
    }
    onOpenChange(false);
  };

  const isPending = isCreating || isUpdating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{macro ? "Editar Macro" : "Nova Macro"}</DialogTitle>
          <DialogDescription>Configure uma resposta rápida para uso no atendimento.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl><Input placeholder="Ex: Saudação inicial" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="shortcut" render={({ field }) => (
              <FormItem>
                <FormLabel>Atalho (opcional)</FormLabel>
                <FormControl><Input placeholder="Ex: saudacao" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel>Categoria (opcional)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger></FormControl>
                  <SelectContent>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="content" render={({ field }) => (
              <FormItem>
                <FormLabel>Conteúdo</FormLabel>
                <FormControl><Textarea placeholder="Digite o texto da macro..." rows={4} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {macro ? "Salvar Alterações" : "Criar Macro"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
