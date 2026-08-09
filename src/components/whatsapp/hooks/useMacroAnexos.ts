import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MacroAnexo } from "./useWhatsAppMacros";

export const MAX_MACRO_ANEXOS = 10;

/** Item do editor: ou um anexo já gravado (`id` + `media_path`), ou um arquivo novo (`file`). */
export interface PendingAnexo {
  /** chave estável para o drag-and-drop (não é o id do banco) */
  key: string;
  id?: string;
  file?: File;
  media_path?: string;
  media_type: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
}

export function mediaTypeFromMime(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

export function pendingFromAnexo(a: MacroAnexo): PendingAnexo {
  return {
    key: a.id,
    id: a.id.startsWith("legacy-") ? undefined : a.id,
    media_path: a.media_path,
    media_type: a.media_type,
    file_name: a.file_name || a.media_path.split("/").pop() || "arquivo",
    mime_type: a.mime_type,
    size_bytes: a.size_bytes,
  };
}

export function pendingFromFile(file: File): PendingAnexo {
  const mime = file.type || "application/octet-stream";
  return {
    key: crypto.randomUUID(),
    file,
    media_type: mediaTypeFromMime(mime),
    file_name: file.name,
    mime_type: mime,
    size_bytes: file.size,
  };
}

interface SaveArgs {
  macroId: string;
  tenantId: string;
  items: PendingAnexo[];
}

/**
 * Persiste a lista ORDENADA de anexos de uma macro.
 *
 * A ordem de execução importa: os objetos do Storage são apagados ANTES das
 * linhas de `whatsapp_macro_anexos`, porque a policy de DELETE do bucket
 * autoriza pelo `EXISTS` nessa tabela — apagar a linha primeiro tranca o
 * arquivo no bucket para sempre.
 *
 * `whatsapp_macros.media_path` / `media_type` seguem espelhando o 1º anexo:
 * é o que mantém a policy antiga do bucket e qualquer leitor legado de pé.
 */
export const useMacroAnexos = () => {
  const queryClient = useQueryClient();

  const saveAnexos = useMutation({
    mutationFn: async ({ macroId, tenantId, items }: SaveArgs) => {
      // 1. Upload dos arquivos novos
      const resolved: Array<Omit<PendingAnexo, "key" | "file"> & { media_path: string }> = [];
      for (const item of items) {
        if (!item.file) {
          resolved.push({ ...item, media_path: item.media_path! });
          continue;
        }
        const ext = item.file.name.split(".").pop() || "bin";
        const filePath = `${tenantId}/macros/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("macro-media")
          .upload(filePath, item.file, { upsert: false });
        if (upErr) throw new Error(`Falha no upload de "${item.file.name}": ${upErr.message}`);
        resolved.push({
          media_path: filePath,
          media_type: item.media_type,
          file_name: item.file_name,
          mime_type: item.mime_type,
          size_bytes: item.size_bytes,
        });
      }

      // 2. O que existe hoje no banco
      const { data: existing, error: exErr } = await (supabase.from("whatsapp_macro_anexos" as any) as any)
        .select("id, media_path")
        .eq("macro_id", macroId);
      if (exErr) throw exErr;

      const keptIds = new Set(items.map((i) => i.id).filter(Boolean) as string[]);
      const removed = ((existing ?? []) as Array<{ id: string; media_path: string }>)
        .filter((row) => !keptIds.has(row.id));

      // 3. Storage primeiro (a policy depende da linha ainda existir)
      if (removed.length) {
        const { error: rmErr } = await supabase.storage
          .from("macro-media")
          .remove(removed.map((r) => r.media_path));
        if (rmErr) throw rmErr;

        const { error: delErr } = await (supabase.from("whatsapp_macro_anexos" as any) as any)
          .delete()
          .in("id", removed.map((r) => r.id));
        if (delErr) throw delErr;
      }

      // 4. Reordenar os que ficaram e inserir os novos.
      // `resolved` foi montado na mesma ordem de `items`, então o índice serve
      // como `ordem` e como pareamento entre os dois arrays.
      const zipped = items.map((item, ordem) => ({ item, resolved: resolved[ordem], ordem }));

      await Promise.all(
        zipped
          .filter(({ item }) => !!item.id)
          .map(async ({ item, ordem }) => {
            const { error } = await (supabase.from("whatsapp_macro_anexos" as any) as any)
              .update({ ordem })
              .eq("id", item.id);
            if (error) throw error;
          })
      );

      const inserts = zipped
        .filter(({ item }) => !item.id)
        .map(({ resolved: r, ordem }) => ({
          tenant_id: tenantId,
          macro_id: macroId,
          media_path: r.media_path,
          media_type: r.media_type,
          file_name: r.file_name,
          mime_type: r.mime_type,
          size_bytes: r.size_bytes,
          ordem,
        }));
      if (inserts.length) {
        const { error: insErr } = await (supabase.from("whatsapp_macro_anexos" as any) as any).insert(inserts);
        if (insErr) throw insErr;
      }

      // 5. Espelho legado do 1º anexo
      const first = resolved[0];
      const { error: mErr } = await (supabase.from("whatsapp_macros") as any)
        .update({
          media_path: first?.media_path ?? null,
          media_type: first?.media_type ?? null,
        })
        .eq("id", macroId);
      if (mErr) throw mErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-macros"] });
    },
  });

  return {
    saveAnexos: saveAnexos.mutateAsync,
    isSavingAnexos: saveAnexos.isPending,
  };
};
