import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMacroTags } from "@/components/whatsapp/hooks/useMacroTags";
import { AlertTriangle, Paperclip, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";


const formSchema = z.object({
  title: z.string().min(1, "Nome obrigatório"),
  content: z.string().min(1, "Conteúdo obrigatório"),
  shortcut: z.string().optional(),
  category: z.string().optional(),
  permite_edicao_livre: z.boolean().default(false),
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
  const { effectiveTenantId: tid } = useTenantFilter();
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [existingMediaPath, setExistingMediaPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", content: "", shortcut: "", category: "", permite_edicao_livre: false },
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
        permite_edicao_livre: macro?.permite_edicao_livre ?? false,
      });
      setMediaFile(null);
      setMediaType(macro?.media_type ?? null);
      setExistingMediaPath(macro?.media_path ?? null);
    }
  }, [open, macro, form]);

  const onSubmit = async (values: FormValues) => {
    let finalMediaPath = existingMediaPath;
    let finalMediaType = mediaType;

    if (mediaFile && tid) {
      setUploading(true);
      const ext = mediaFile.name.split('.').pop() || 'bin';
      const filePath = `${tid}/macros/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('macro-media').upload(filePath, mediaFile, { upsert: false });
      setUploading(false);
      if (upErr) {
        toast.error('Erro no upload: ' + upErr.message);
        return;
      }
      finalMediaPath = filePath;
      finalMediaType = mediaFile.type.startsWith('image/') ? 'image'
        : mediaFile.type.startsWith('audio/') ? 'audio'
        : mediaFile.type.startsWith('video/') ? 'video'
        : 'document';
    }

    if (!mediaFile && !existingMediaPath) {
      finalMediaPath = null;
      finalMediaType = null;
    }

    const payload = {
      title: values.title,
      content: values.content,
      shortcut: values.shortcut || null,
      category: values.category || null,
      permite_edicao_livre: values.permite_edicao_livre,
      media_type: finalMediaType,
      media_path: finalMediaPath,
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

            <div className="space-y-2">
              <FormLabel>Mídia (opcional)</FormLabel>
              {existingMediaPath && !mediaFile && (
                <div className="flex items-center gap-2 rounded-md border p-2 bg-muted/30">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm flex-1 truncate">{existingMediaPath.split('/').pop()}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setExistingMediaPath(null); setMediaType(null); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {mediaFile && (
                <div className="flex items-center gap-2 rounded-md border p-2 bg-muted/30">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm flex-1 truncate">{mediaFile.name}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setMediaFile(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {!existingMediaPath && !mediaFile && (
                <div>
                  <input
                    id="macro-dialog-media-input"
                    type="file"
                    className="hidden"
                    accept="image/*,audio/*,video/*,application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setMediaFile(file);
                        setMediaType(
                          file.type.startsWith('image/') ? 'image'
                          : file.type.startsWith('audio/') ? 'audio'
                          : file.type.startsWith('video/') ? 'video'
                          : 'document'
                        );
                      }
                      e.target.value = "";
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('macro-dialog-media-input')?.click()}>
                    <Paperclip className="h-4 w-4 mr-2" /> Anexar mídia
                  </Button>
                </div>
              )}
            </div>

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

            <FormField control={form.control} name="permite_edicao_livre" render={({ field }) => (
              <FormItem className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Permitir edição livre</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Quando ativo, o atendente pode editar todo o texto da mensagem (não apenas os campos {`{{tag}}`}).
                    Use com cuidado: aumenta a flexibilidade mas perde o padrão fixo.
                  </p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending || uploading}>
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
