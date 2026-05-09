import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useMacroTags } from "@/components/whatsapp/hooks/useMacroTags";
import { AlertTriangle } from "lucide-react";
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
  const { tags: allTags, detectTags, isKnownTag } = useMacroTags();
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", content: "", shortcut: "", category: "" },
  });

  const watchedContent = form.watch("content");
  const detectedTags = detectTags(watchedContent || "");
  const unknownTags = detectedTags.filter((t) => !isKnownTag(t));

  const insertTagAtCursor = (tagName: string) => {
    const textarea = contentTextareaRef.current;
    const placeholder = `{{${tagName}}}`;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = form.getValues("content") || "";
    const newContent = current.substring(0, start) + placeholder + current.substring(end);
    form.setValue("content", newContent);
    setTimeout(() => {
      if (contentTextareaRef.current) {
        const newPos = start + placeholder.length;
        contentTextareaRef.current.selectionStart = newPos;
        contentTextareaRef.current.selectionEnd = newPos;
        contentTextareaRef.current.focus();
      }
    }, 0);
  };

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
                <FormControl>
                  <Textarea
                    placeholder="Digite o texto da macro... Use {{Nome do cliente}} para placeholders editáveis."
                    rows={4}
                    {...field}
                    ref={(el) => {
                      field.ref(el);
                      contentTextareaRef.current = el;
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {allTags.length > 0 && (
              <div className="space-y-2 rounded-md border p-3 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground">Inserir tag no cursor:</p>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag) => (
                    <Button
                      key={tag.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs font-mono"
                      onClick={() => insertTagAtCursor(tag.nome)}
                    >
                      {`{{${tag.nome}}}`}
                    </Button>
                  ))}
                </div>
                {unknownTags.length > 0 && (
                  <div className="flex items-start gap-2 mt-2 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <p>
                      Tag{unknownTags.length > 1 ? "s" : ""} não cadastrada{unknownTags.length > 1 ? "s" : ""}:{" "}
                      {unknownTags.map((t) => `{{${t}}}`).join(", ")}. Cadastre na aba{" "}
                      <strong>Tags</strong> ou remova do texto.
                    </p>
                  </div>
                )}
              </div>
            )}

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
