import { useState } from "react";
import { Tag as TagIcon, X, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useConversationTags,
  TAG_PALETTE,
  DEFAULT_TAG_COLOR,
  TAG_SUGGESTIONS,
} from "../hooks/useConversationTags";

interface Props {
  conversationId: string;
  /** Head/admin pode excluir tag do catálogo do tenant. */
  canManage?: boolean;
}

/**
 * DEM-0207: badges de tag no header do chat, com criação inline.
 * Reaproveita o catálogo do tenant (whatsapp_conversation_tags).
 */
export function ConversationTags({ conversationId, canManage = false }: Props) {
  const { assigned, available, addTag, removeTag, createAndAddTag, deactivateTag, isSaving } =
    useConversationTags(conversationId);

  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(DEFAULT_TAG_COLOR);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const naoAplicadas = available.filter((t) => !assigned.some((a) => a.id === t.id));
  const sugestoes = TAG_SUGGESTIONS.filter(
    (s) => !available.some((t) => t.name.toLowerCase() === s.name.toLowerCase())
  );

  const criar = async () => {
    if (!nome.trim() || isSaving) return;
    await createAndAddTag(nome, cor);
    setNome("");
    setCor(DEFAULT_TAG_COLOR);
    setOpen(false);
  };

  return (
    <>
      {assigned.map((tag) => (
        <span
          key={tag.assignmentId}
          className="inline-flex items-center gap-1 h-4 px-1.5 rounded-full text-[10px] font-medium shrink-0 whitespace-nowrap border transition-colors"
          style={{ background: tag.color + "1f", color: tag.color, borderColor: tag.color + "59" }}
        >
          {tag.name}
          <button
            type="button"
            onClick={() => removeTag(tag.assignmentId)}
            className="hover:opacity-60 transition-opacity"
            aria-label={`Remover tag ${tag.name}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setConfirmDelete(null);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 h-4 px-1.5 rounded-full text-[10px] font-medium shrink-0 whitespace-nowrap border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                aria-label="Aplicar tag ao chat"
              >
                <TagIcon className="h-2.5 w-2.5" />
                {assigned.length === 0 && "Tag"}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Marcar este chat com uma tag
          </TooltipContent>
        </Tooltip>

        <PopoverContent align="start" className="w-64 p-2">
          <div className="space-y-0.5 max-h-52 overflow-y-auto">
            {naoAplicadas.map((t) => (
              <div key={t.id} className="flex items-center gap-1 group">
                <button
                  type="button"
                  onClick={() => {
                    addTag(t.id);
                    setOpen(false);
                  }}
                  className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-md hover:bg-muted text-sm flex items-center gap-2 transition-colors"
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="truncate">{t.name}</span>
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() =>
                      confirmDelete === t.id ? deactivateTag(t.id) : setConfirmDelete(t.id)
                    }
                    className={`h-7 w-7 shrink-0 rounded-md inline-flex items-center justify-center transition-colors ${
                      confirmDelete === t.id
                        ? "bg-destructive text-destructive-foreground"
                        : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    }`}
                    aria-label={
                      confirmDelete === t.id
                        ? `Confirmar exclusão da tag ${t.name}`
                        : `Excluir tag ${t.name}`
                    }
                    title={confirmDelete === t.id ? "Clique para confirmar" : "Excluir do catálogo"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {naoAplicadas.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">
                {available.length === 0 ? "Nenhuma tag criada ainda" : "Todas as tags já estão neste chat"}
              </p>
            )}
          </div>

          <div className="border-t mt-2 pt-2 space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-1">
              Criar nova
            </p>

            <div className="flex items-center gap-1.5">
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome da tag"
                maxLength={30}
                className="h-8 text-xs flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    criar();
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 shrink-0"
                onClick={criar}
                disabled={!nome.trim() || isSaving}
                aria-label="Criar e aplicar tag"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex items-center gap-1 flex-wrap px-0.5">
              {TAG_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                    cor === c ? "ring-2 ring-offset-2 ring-offset-popover ring-foreground/50" : ""
                  }`}
                  style={{ background: c }}
                  aria-label={`Cor ${c}`}
                  aria-pressed={cor === c}
                />
              ))}
            </div>

            {nome.trim() && (
              <span
                className="inline-flex items-center h-5 px-2 rounded-full text-[11px] font-medium border"
                style={{ background: cor + "1f", color: cor, borderColor: cor + "59" }}
              >
                {nome.trim()}
              </span>
            )}

            {sugestoes.length > 0 && !nome.trim() && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground px-1">Sugestões</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {sugestoes.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => {
                        setNome(s.name);
                        setCor(s.color);
                      }}
                      className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-medium border border-dashed hover:border-solid transition-all"
                      style={{ color: s.color, borderColor: s.color + "80" }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
