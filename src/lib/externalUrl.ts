/**
 * Link colado pelo usuário → href seguro para <a target="_blank">.
 *
 * O <Input type="url"> só valida no submit de um <form>, e os campos de link
 * (agendamento de treino, por exemplo) vivem em popover/dialog com botão comum.
 * Resultado: "meet.google.com/abc-defg-hij" é salvo cru. Num href, valor sem
 * esquema é caminho RELATIVO — o clique navegava para
 * /onboarding/meet.google.com/... e caía no 404 do próprio app.
 *
 * Retorna null quando não dá para virar um link http(s) — inclusive para
 * javascript: e data:, que num href seriam XSS.
 */
export function toExternalHref(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;

  const parse = (s: string): URL | null => {
    try {
      return new URL(s);
    } catch {
      return null;
    }
  };

  const direct = parse(v);
  if (direct) {
    return direct.protocol === "http:" || direct.protocol === "https:" ? v : null;
  }

  // Sem esquema: assume https. Exige host com ponto para não aceitar rabisco.
  const guessed = parse(`https://${v}`);
  return guessed && guessed.hostname.includes(".") ? `https://${v}` : null;
}
