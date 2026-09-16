import { supabase } from "@/integrations/supabase/client";

/**
 * Anexo escolhido para enviar por e-mail, no chat ou na tela E-mails.
 *
 * Quem assina a URL é a edge function `get-media-upload-url`, com service_role
 * — upload direto do navegador para o Storage não funciona neste projeto. Aqui
 * mandamos o tenant em vez da conversa, e o arquivo cai em `<tenant>/emails/`.
 * A send-email aceita esse caminho e apaga o arquivo depois de enviar.
 *
 * Desde 16/09/2026 o anexo do e-mail do CHAT também vem por aqui, e não mais
 * pela pasta da conversa: lá ele ficava misturado com a mídia das mensagens, e
 * o que a pessoa anexa e nunca envia não teria como ser apagado depois sem
 * risco de levar mídia de mensagem junto. Em `<tenant>/emails/` só existe anexo
 * de e-mail, e a `purge-email-anexos` limpa o que sobrou.
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
