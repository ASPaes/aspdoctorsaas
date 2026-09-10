// Como ler o status de uma mensagem no store da Evolution.
//
// Existe porque o código anterior lia `records[0].status`, campo que **não existe** na
// resposta do `/chat/findMessages`. `String(undefined ?? '')` vira `''`, `''` não é
// DELIVERY_ACK, e a função devolvia `false` sempre: a segunda fonte da
// verify-failed-deliveries nunca resgatou uma mensagem desde 03/08/2026 — nem em
// conversa direta, onde o resgate funcionaria. Falha silenciosa perfeita, porque
// `false` é também a resposta legítima quando a Evolution está fora do ar.
//
// O status real fica em `records[0].MessageUpdate[]`. Medido em produção em
// 09/09/2026, na mesma instância (`Consysa_suporte_7261`):
//
//   1:1 lida ......... "MessageUpdate": [{"status":"SERVER_ACK"},
//                                        {"status":"DELIVERY_ACK"},
//                                        {"status":"SERVER_ACK"}]
//   grupo entregue ... "MessageUpdate": []
//
// Duas lições da amostra, e as duas viram regra aqui:
// 1. O array é um LOG, não um estado: repete SERVER_ACK depois do DELIVERY_ACK. Ler a
//    última posição daria "SERVER_ACK" numa mensagem entregue. Por isso varre tudo.
// 2. Em grupo ele vem vazio mesmo quando a mensagem chegou. Vazio é ausência de
//    informação, nunca prova de falha — e esta função só existe para RESGATAR.

/** Estados que provam que a mensagem chegou a alguém. */
const PROVA_DE_ENTREGA = new Set(['DELIVERY_ACK', 'READ', 'PLAYED']);

/**
 * Recebe `messages.records[0]` da resposta do `/chat/findMessages`.
 * `true` só quando o store afirma entrega. Qualquer outra coisa (registro ausente,
 * array vazio, formato inesperado) é `false` = "não sei".
 */
export function entregaConfirmadaNoStore(registro: unknown): boolean {
  if (!registro || typeof registro !== 'object') return false;

  const updates = (registro as Record<string, unknown>).MessageUpdate;
  if (Array.isArray(updates)) {
    for (const u of updates) {
      const st = String((u as Record<string, unknown>)?.status ?? '').toUpperCase();
      if (PROVA_DE_ENTREGA.has(st)) return true;
    }
  }

  // Forma alternativa: se alguma versão da Evolution expuser o status direto no
  // registro, aceita. Era o que o código antigo supunha — deixar de aceitar seria
  // trocar um bug por outro no dia em que o formato mudar.
  const direto = String((registro as Record<string, unknown>).status ?? '').toUpperCase();
  return PROVA_DE_ENTREGA.has(direto);
}
