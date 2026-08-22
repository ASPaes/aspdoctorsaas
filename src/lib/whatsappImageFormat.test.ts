import { describe, it, expect, vi, afterEach } from 'vitest';
import { precisaConverterParaWhatsApp, converterImagemParaJpeg } from './whatsappImageFormat';

/**
 * jsdom não tem createImageBitmap nem canvas real: o que se prova aqui é a
 * lógica em volta — quem entra na conversão, o que sai dela e como o erro
 * chega ao ChatInput. A decodificação em si é do navegador.
 */
function mockCanvas(toBlobResult: Blob | null) {
  const ctx = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (b: Blob | null) => void) => cb(toBlobResult),
  };
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as any);
  return { canvas, ctx };
}

afterEach(() => vi.restoreAllMocks());

describe('precisaConverterParaWhatsApp', () => {
  it('pega os formatos que o provedor recusa', () => {
    expect(precisaConverterParaWhatsApp('image/avif')).toBe(true);
    expect(precisaConverterParaWhatsApp('IMAGE/AVIF')).toBe(true);
    expect(precisaConverterParaWhatsApp('image/heic')).toBe(true);
    expect(precisaConverterParaWhatsApp('image/heif')).toBe(true);
  });

  it('não mexe no que já funciona hoje', () => {
    for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'application/pdf', '', null, undefined]) {
      expect(precisaConverterParaWhatsApp(m as any)).toBe(false);
    }
  });
});

describe('converterImagemParaJpeg', () => {
  it('devolve JPEG com a extensão trocada e pinta o fundo antes de desenhar', async () => {
    (globalThis as any).createImageBitmap = vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() }));
    const { canvas, ctx } = mockCanvas(new Blob(['x'], { type: 'image/jpeg' }));

    const out = await converterImagemParaJpeg(new File(['a'], 'print da tela.avif', { type: 'image/avif' }));

    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('print da tela.jpg');
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    // Fundo branco antes do drawImage: JPEG não tem alpha, transparência sairia preta.
    expect(ctx.fillStyle).toBe('#FFFFFF');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('navegador que não decodifica (HEIC) vira instrução, não erro cru', async () => {
    (globalThis as any).createImageBitmap = vi.fn(async () => { throw new Error('decode failed'); });

    const p = converterImagemParaJpeg(new File(['a'], 'foto.heic', { type: 'image/heic' }));
    await expect(p).rejects.toThrow(/HEIC/);
    await p.catch((e) => {
      expect(e.formatoNaoSuportado).toBe(true);
      expect(e.message).toMatch(/JPG ou PNG/);
    });
  });

  it('toBlob vazio também sai como formato não suportado', async () => {
    (globalThis as any).createImageBitmap = vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() }));
    mockCanvas(null);

    const p = converterImagemParaJpeg(new File(['a'], 'x.avif', { type: 'image/avif' }));
    await expect(p).rejects.toMatchObject({ formatoNaoSuportado: true });
  });
});
