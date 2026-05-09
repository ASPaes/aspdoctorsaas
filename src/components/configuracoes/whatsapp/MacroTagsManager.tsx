import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, GripVertical, Edit2, Check, X } from "lucide-react";
import { useMacroTags, type MacroTag } from "@/components/whatsapp/hooks/useMacroTags";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableTagRow({
  tag,
  onEdit,
  onDelete,
}: {
  tag: MacroTag;
  onEdit: (id: string, nome: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tag.id });
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(tag.nome);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSaveEdit = () => {
    if (editValue.trim() && editValue.trim() !== tag.nome) {
      onEdit(tag.id, editValue.trim());
    }
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-2 rounded-md border bg-card"
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="Reordenar"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {editing ? (
        <>
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="h-7 flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveEdit();
              if (e.key === "Escape") {
                setEditing(false);
                setEditValue(tag.nome);
              }
            }}
          />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSaveEdit}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              setEditing(false);
              setEditValue(tag.nome);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 font-mono text-sm">{`{{${tag.nome}}}`}</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)}>
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive"
            onClick={() => onDelete(tag.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

export function MacroTagsManager() {
  const { tags, isLoading, createTag, updateTag, deactivateTag, reorderTags, isCreating } =
    useMacroTags();
  const [novaTag, setNovaTag] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tags.findIndex((t) => t.id === active.id);
    const newIndex = tags.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(tags, oldIndex, newIndex);
    reorderTags(newOrder.map((t) => t.id));
  };

  const handleAdd = () => {
    if (!novaTag.trim()) return;
    createTag(novaTag.trim());
    setNovaTag("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags Substituíveis</CardTitle>
        <CardDescription>
          Cadastre tags que poderão ser usadas como placeholders {"{{Nome da tag}}"} no texto das
          macros. Ao usar uma macro, o atendente preenche manualmente cada tag antes de enviar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Nova tag (ex: Nome do cliente)"
            value={novaTag}
            onChange={(e) => setNovaTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            maxLength={100}
          />
          <Button onClick={handleAdd} disabled={!novaTag.trim() || isCreating}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tag cadastrada ainda.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={tags.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {tags.map((tag) => (
                  <SortableTagRow
                    key={tag.id}
                    tag={tag}
                    onEdit={(id, nome) => updateTag({ id, nome })}
                    onDelete={(id) => {
                      if (
                        confirm(
                          `Remover a tag "${tag.nome}"? Macros existentes que usam essa tag continuarão funcionando, mas a tag não aparecerá mais para inserção.`
                        )
                      ) {
                        deactivateTag(id);
                      }
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}
