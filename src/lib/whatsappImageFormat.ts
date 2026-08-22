/**
 * Formatos de imagem que o WhatsApp recusa no envio.
 *
 * O DoctorSaaS nunca filtrou anexo por formato — quem recusa é o provedor, no
 * último passo, depois do arquivo já ter subido para o Storage. O operador via
 * "Arquivos AVIF (Imagem) não são aceitos", uma frase que não é nossa e que não
 * diz o que fazer.
 *
 * AVIF virou o padrão de "salvar imagem" do Chrome em muitos sites, então isso
 * passou a acontecer com print de tela do dia a dia. HEIC/HEIF é o padrão da
 * câmera do iPhone e cai no mesmo buraco.
 *
 * Só entram aqui os formatos sabidamente recusados. `image/webp` fica de fora
 * de propósito: hoje ele passa, e converter mudaria o que já funciona.
 */
const MIMES_RECUSADOS = new Set(['image/avif', 'image/heic', 'image/heif']);

export function precisaConverterParaWhatsApp(mime: string | undefined | null): boolean {
  return MIMES_RECUSADOS.has((mime || '').toLowerCase());
}

/** Erro de conversão: o formato não tem salvação no navegador atual. */
export interface FormatoNaoSuportadoError extends Error {
  formatoNaoSuportado: true;
}

function erroFormato(mime: string): FormatoNaoSuportadoError {
  const rotulo = (mime.split('/')[1] || mime).toUpperCase();
  const err = new Error(
    `O WhatsApp não aceita imagem ${rotulo} e este navegador não conseguiu converter. Salve o arquivo como JPG ou PNG e envie de novo.`
  ) as FormatoNaoSuportadoError;
  err.formatoNaoSuportado = true;
  return err;
}

/**
 * Converte a imagem para JPEG usando só API do navegador — sem dependência nova.
 *
 * `createImageBitmap` decodifica com o mesmo motor que renderiza a tag <img>:
 * o Chrome lê AVIF nativamente, então o caminho comum aqui não custa nada além
 * do repaint. HEIC nenhum navegador decodifica — ali ele lança, e o operador
 * recebe uma instrução em vez do erro cru do provedor.
 *
 * O fundo branco não é decoração: JPEG não tem canal alpha e, sem pintar antes,
 * área transparente sai preta.
 */
export async function converterImagemParaJpeg(file: File): Promise<File> {
  const mime = file.type || 'application/octet-stream';

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw erroFormato(mime);
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw erroFormato(mime);

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) throw erroFormato(mime);

    const nome = file.name.replace(/\.[^.]+$/, '') || 'imagem';
    return new File([blob], `${nome}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    bitmap.close?.();
  }
}
