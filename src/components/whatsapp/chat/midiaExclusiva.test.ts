import { describe, it, expect, vi } from "vitest";
import { assumirReproducao, liberarReproducao } from "./midiaExclusiva";

/**
 * Dar play num áudio com outro tocando deixava os dois falando por cima, porque
 * cada bolha monta o seu próprio elemento e o navegador não coordena nada.
 */
function fingirMidia() {
  const m = {
    paused: false,
    pause: vi.fn(function (this: any) { this.paused = true; }),
  };
  return m as unknown as HTMLMediaElement & { pause: ReturnType<typeof vi.fn> };
}

describe("só uma mídia toca por vez", () => {
  it("o play de um pausa o anterior", () => {
    const a = fingirMidia();
    const b = fingirMidia();

    assumirReproducao(a);
    assumirReproducao(b);

    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.pause).not.toHaveBeenCalled();
  });

  it("não pausa a si mesmo quando o play se repete", () => {
    const a = fingirMidia();
    assumirReproducao(a);
    assumirReproducao(a);
    expect(a.pause).not.toHaveBeenCalled();
  });

  it("o onPause do antigo não derruba o registro do novo", () => {
    const antigo = fingirMidia();
    const novo = fingirMidia();

    assumirReproducao(antigo);
    assumirReproducao(novo);
    // pausar o antigo dispara o onPause DELE depois que o novo já assumiu
    liberarReproducao(antigo);

    // o novo continua sendo o dono: um terceiro play tem que pausá-lo
    const terceiro = fingirMidia();
    assumirReproducao(terceiro);
    expect(novo.pause).toHaveBeenCalledTimes(1);
  });

  it("mídia já pausada não é pausada de novo", () => {
    const a = fingirMidia();
    assumirReproducao(a);
    (a as any).paused = true;
    assumirReproducao(fingirMidia());
    expect(a.pause).not.toHaveBeenCalled();
  });
});
