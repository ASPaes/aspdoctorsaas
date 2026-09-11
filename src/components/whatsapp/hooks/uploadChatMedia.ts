// Upload de anexo do chat para o bucket `whatsapp-media`.
//
// Extraído de useWhatsAppSend em 11/09/2026 porque a mensagem AGENDADA precisa
// do mesmo upload sem enviar nada: o arquivo sobe na hora em que o operador
// agenda e só vira mensagem quando o motor dispara. Duas cópias desse bloco
// divergiriam na primeira mudança de formato aceito.
//
// Upload client-side direto no Storage não funciona neste projeto (regra do
// CLAUDE.md): quem assina a URL é a edge function `get-media-upload-url`, com
// service_role. O que sobe daqui é o arquivo para essa URL assinada.
import { supabase } from '@/integrations/supabase/client';
import { precisaConverterParaWhatsApp, converterImagemParaJpeg } from '@/lib/whatsappImageFormat';

export interface AnexoEnviado {
  storagePath: string;
  mediaSizeBytes: number;
  mediaMimetype: string;
  fileName: string;
  /** true = o arquivo virou JPEG no caminho; o nome e o mime originais não valem mais. */
  convertido: boolean;
}

export async function uploadChatMedia(conversationId: string, file: File): Promise<AnexoEnviado> {
  // AVIF/HEIC são recusados pelo provedor DEPOIS do upload, com uma frase que
  // não é nossa. Converter aqui deixa a espera acontecer enquanto a bolha
  // otimista já está na tela.
  let arquivo = file;
  let convertido = false;
  if (precisaConverterParaWhatsApp(arquivo.type)) {
    arquivo = await converterImagemParaJpeg(arquivo);
    convertido = true;
  }

  const mime = arquivo.type || 'application/octet-stream';

  const { data: urlData, error: urlErr } = await supabase.functions.invoke('get-media-upload-url', {
    body: { conversationId, mediaMimetype: mime, fileName: arquivo.name },
  });
  if (urlErr) throw new Error(urlErr.message || 'Falha ao preparar upload');
  if (!urlData?.path || !urlData?.token) throw new Error(urlData?.error || 'Falha ao preparar upload');

  const { error: upErr } = await supabase.storage
    .from('whatsapp-media')
    .uploadToSignedUrl(urlData.path, urlData.token, arquivo, { contentType: mime });
  if (upErr) throw new Error(upErr.message || 'Falha no upload do arquivo');

  return {
    storagePath: urlData.path as string,
    mediaSizeBytes: arquivo.size,
    mediaMimetype: mime,
    fileName: arquivo.name,
    convertido,
  };
}
