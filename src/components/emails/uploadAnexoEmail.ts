import { supabase } from "@/integrations/supabase/client";

/**
 * Anexo escolhido na tela E-mails (responder, encaminhar).
 *
 * Mesmo caminho do anexo do chat: quem assina a URL é a edge function
 * `get-media-upload-url`, com service_role — upload direto do navegador para o
 * Storage não funciona neste projeto. A diferença é que aqui não existe
 * conversa, então mandamos o tenant e o arquivo cai em `<tenant>/emails/`.
 * A send-email aceita esse formato de caminho e apaga o arquivo depois de enviar.
 */
export interface AnexoSubido {
  storagePath: string;
  nome: string;
  mime: string;
  tamanho: number;
}

export async function uploadAnexoEmail(tenantId: string, arquivo: File): Promise<AnexoSubido> {
  const mime = arquivo.type || "application/octet-stream";

  const { data, error } = await supabase.functions.invoke("get-media-upload-url", {
    body: { tenantId, mediaMimetype: mime, fileName: arquivo.name },
  });
  if (error) throw new Error(error.message || "Falha ao preparar o upload do anexo.");
  if (!data?.path || !data?.token) throw new Error(data?.error || "Falha ao preparar o upload do anexo.");

  const { error: erroUpload } = await supabase.storage
    .from("whatsapp-media")
    .uploadToSignedUrl(data.path as string, data.token as string, arquivo, { contentType: mime });
  if (erroUpload) throw new Error(erroUpload.message || "Falha no upload do arquivo.");

  return { storagePath: data.path as string, nome: arquivo.name, mime, tamanho: arquivo.size };
}
