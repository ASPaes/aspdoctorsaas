/**
 * Só uma mídia toca por vez na conversa, como no WhatsApp.
 *
 * Cada bolha de áudio e de vídeo monta o seu próprio elemento nativo, e o
 * navegador não coordena nada entre eles: dar play num áudio com outro rodando
 * deixava os dois falando por cima. Quem toca avisa aqui e o anterior é pausado.
 *
 * Mora fora do React de propósito: o registro precisa valer entre componentes
 * irmãos que não se conhecem (áudio de uma bolha × vídeo de outra), e não pode
 * se perder num re-render da lista.
 */
let tocandoAgora: HTMLMediaElement | null = null;

/** Chamado no `onPlay` do elemento. Pausa o que estava tocando antes. */
export function assumirReproducao(midia: HTMLMediaElement) {
  if (tocandoAgora && tocandoAgora !== midia && !tocandoAgora.paused) {
    tocandoAgora.pause();
  }
  tocandoAgora = midia;
}

/**
 * Chamado no `onPause`/`onEnded` e ao desmontar. Só solta o registro se ainda
 * for este elemento: pausar o antigo dispara o `onPause` DELE depois que o novo
 * já assumiu, e sem esta guarda o registro seria zerado logo em seguida.
 */
export function liberarReproducao(midia: HTMLMediaElement | null) {
  if (midia && tocandoAgora === midia) tocandoAgora = null;
}
