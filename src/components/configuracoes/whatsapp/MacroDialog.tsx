import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMacroTags } from "@/components/whatsapp/hooks/useMacroTags";
import {
  AlertTriangle, FileAudio, FileText, FileVideo, GripVertical, Image as ImageIcon, Paperclip, X,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { useWhatsAppMacros, macroAnexos, type WhatsAppMacro } from "@/components/whatsapp/hooks/useWhatsAppMacros";
import {
  useMacroAnexos, pendingFromAnexo, pendingFromFile, MAX_MACRO_ANEXOS, type PendingAnexo,
} from "@/components/whatsapp/hooks/useMacroAnexos";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { formatBytes } from "@/utils/whatsapp/formatBytes";
import { toast } from "sonner";

function AnexoIcon({ mediaType }: { mediaType: string }) {
  const Icon = mediaType === "image" ? ImageIcon
    : mediaType === "audio" ? FileAudio
    : mediaType === "video" ? FileVideo
    : FileText;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function SortableAnexoRow({
  anexo, ordem, onRemove,
}: {
  anexo: PendingAnexo;
  ordem: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: anexo.key });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-2 rounded-md border bg-card p-2"
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label={`Reordenar ${anexo.file_name}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 shrink-0 text-center text-xs font-medium text-muted-foreground">{ordem + 1}</span>
      <AnexoIcon mediaType={anexo.media_type} />
      <span className="min-w-0 flex-1 truncate text-sm" title={anexo.file_name}>{anexo.file_name}</span>
      {anexo.size_bytes != null && (
        <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(anexo.size_bytes)}</span>
      )}
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onRemove} aria-label={`Remover ${anexo.file_name}`}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}


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
  const { createMacroAsync, updateMacroAsync, isCreating, isUpdating } = useWhatsAppMacros();
  const { saveAnexos, isSavingAnexos } = useMacroAnexos();
  const { tags: allTags, detectTags, isKnownTag } = useMacroTags();
  const { effectiveTenantId: tid } = useTenantFilter();
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [anexos, setAnexos] = useState<PendingAnexo[]>([]);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setAnexos((prev) => {
      const oldIndex = prev.findIndex((a) => a.key === active.id);
      const newIndex = prev.findIndex((a) => a.key === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleAddFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files);
    setAnexos((prev) => {
      const livre = MAX_MACRO_ANEXOS - prev.length;
      if (livre <= 0) {
        toast.warning(`Limite de ${MAX_MACRO_ANEXOS} anexos por macro.`);
        return prev;
      }
      if (incoming.length > livre) {
        toast.warning(`Só cabem mais ${livre} anexo${livre > 1 ? "s" : ""} nesta macro.`);
      }
      return [...prev, ...incoming.slice(0, livre).map(pendingFromFile)];
    });
  };

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
      setAnexos(macro ? macroAnexos(macro).map(pendingFromAnexo) : []);
    }
  }, [open, macro, form]);

  const onSubmit = async (values: FormValues) => {
    // `media_path`/`media_type` não vão no payload: quem grava esse espelho do
    // 1º anexo é o saveAnexos, logo depois de subir os arquivos.
    const payload = {
      title: values.title,
      content: values.content,
      shortcut: values.shortcut || null,
      category: values.category || null,
      permite_edicao_livre: values.permite_edicao_livre,
    };

    setSaving(true);
    try {
      const saved = macro
        ? await updateMacroAsync({ id: macro.id, updates: payload })
        : await createMacroAsync(payload);

      // O tenant vem da linha gravada: o trigger set_tenant_id_on_insert pode
      // ter resolvido um tenant diferente do `tid` do filtro (super admin).
      const tenantId = saved?.tenant_id || macro?.tenant_id || tid;
      if (!tenantId) throw new Error("Tenant não identificado.");

      await saveAnexos({ macroId: saved.id, tenantId, items: anexos });
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao salvar anexos: " + (err?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const isPending = isCreating || isUpdating || isSavingAnexos || saving;


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
              <div className="flex items-center justify-between">
                <FormLabel>Anexos (opcional)</FormLabel>
                {anexos.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {anexos.length}/{MAX_MACRO_ANEXOS} · enviados nesta ordem
                  </span>
                )}
              </div>

              {anexos.length > 0 && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={anexos.map((a) => a.key)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {anexos.map((anexo, ordem) => (
                        <SortableAnexoRow
                          key={anexo.key}
                          anexo={anexo}
                          ordem={ordem}
                          onRemove={() => setAnexos((prev) => prev.filter((a) => a.key !== anexo.key))}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              <div>
                <input
                  id="macro-dialog-media-input"
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,audio/*,video/*,application/pdf"
                  onChange={(e) => {
                    handleAddFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={anexos.length >= MAX_MACRO_ANEXOS}
                  onClick={() => document.getElementById('macro-dialog-media-input')?.click()}
                >
                  <Paperclip className="h-4 w-4 mr-2" />
                  {anexos.length ? "Adicionar anexo" : "Anexar arquivos"}
                </Button>
                {anexos.length > 1 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Arraste pela alça para mudar a ordem de envio. O texto da macro vai como legenda do 1º anexo.
                  </p>
                )}
              </div>
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
