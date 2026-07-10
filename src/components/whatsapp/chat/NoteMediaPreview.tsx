import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";

interface Props {
  noteId: string;
  mediaType: "image" | "video";
}

export function NoteMediaPreview({ noteId, mediaType }: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["note-media-url", noteId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-note-media-url", {
        body: { note_id: noteId },
      });
      if (error) throw error;
      return data as { url: string; mimetype?: string | null };
    },
    staleTime: 50 * 60_000,
    retry: 1,
  });

  if (isLoading) {
    return <Skeleton className="w-48 h-32 rounded-md mb-1.5" />;
  }

  if (error || !data?.url) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
        <AlertCircle className="h-3.5 w-3.5" />
        Mídia indisponível
      </div>
    );
  }

  if (mediaType === "video") {
    return (
      <video
        src={data.url}
        controls
        className="rounded-md max-h-[200px] max-w-full mb-1.5 bg-black"
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="block mb-1.5 rounded-md overflow-hidden hover:opacity-90 transition-opacity"
      >
        <img
          src={data.url}
          alt="Mídia da nota"
          className="max-h-[200px] max-w-full object-contain rounded-md"
        />
      </button>
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-5xl p-2 bg-background/95">
          <img
            src={data.url}
            alt="Mídia da nota"
            className="max-h-[85vh] w-auto mx-auto object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
