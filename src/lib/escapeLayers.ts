/**
 * Camadas de ESC — fonte única de "existe algo aberto por cima?".
 *
 * Overlays do Radix (Dialog, AlertDialog, DropdownMenu, Select) marcam o próprio
 * elemento com [data-state="open"] e já tratam o ESC internamente. Overlays feitos
 * à mão (lightbox de imagem, preview de envio) não têm essa marca — sem se anunciar,
 * um handler global de ESC (ex.: "ESC fecha a conversa") dispara no MESMO evento e
 * fecha as duas coisas de uma vez.
 *
 * Convenção: todo overlay custom em tela cheia coloca `data-esc-layer` na raiz e
 * trata o próprio ESC. Handlers globais de ESC chamam hasOpenEscLayer() antes de agir.
 */

const OPEN_LAYER_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  "[data-esc-layer]",
].join(", ");

export function hasOpenEscLayer(): boolean {
  return document.querySelector(OPEN_LAYER_SELECTOR) !== null;
}
