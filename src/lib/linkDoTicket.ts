import { APP_HOST_URL, isChatHost } from "@/lib/chatHost";

/**
 * Endereço que abre o ticket direto (DEM-0445). É o mesmo deep link que o
 * aviso "Novo chamado em seu nome" já usa: `/tickets?ticket=<uuid>`.
 *
 * Sem token de propósito (decisão de 28/09/2026): o link só aponta para o
 * ticket. Quem abre passa pelo login e pelo RLS de sempre, então um e-mail
 * encaminhado para fora da empresa não abre nada.
 *
 * No endereço de telefone (mobile.) a tela de tickets é outra; o link copiado
 * ali aponta para o app completo, que é onde ele abre para qualquer um.
 */
export function linkDoTicket(ticketId: string, origem: string = window.location.origin): string {
  const base = isChatHost() ? APP_HOST_URL : origem;
  return `${base}/tickets?ticket=${encodeURIComponent(ticketId)}`;
}
