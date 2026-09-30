/**
 * Busca da tela de permissões. Ignora acento, maiúscula e pontuação: quem
 * digita "email" precisa achar "E-mails", e "configuracao" precisa achar
 * "Configuração". Cada palavra digitada tem que aparecer (E, não OU).
 */

/** Texto normalizado + de qual caractere do original veio cada letra (para o realce). */
function mapear(s: string): { texto: string; origem: number[] } {
  let texto = "";
  const origem: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const n = s[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const ch of n) { texto += ch; origem.push(i); }
  }
  return { texto, origem };
}

export const normalizar = (s: string) => mapear(s).texto;

export function termosDaBusca(q: string): string[] {
  return q.split(/\s+/).map(normalizar).filter(Boolean);
}

/** Todos os termos aparecem em algum dos textos? Sem termos, tudo casa. */
export function casa(textos: (string | null | undefined)[], termos: string[]): boolean {
  if (!termos.length) return true;
  const alvo = textos.filter(Boolean).map((t) => normalizar(t as string)).join("|");
  return termos.every((t) => alvo.includes(t));
}

/** Pinta no texto original os trechos que casaram — inclusive o hífen de "E-mail". */
export function Realce({ texto, termos }: { texto: string; termos: string[] }) {
  if (!termos.length) return <>{texto}</>;
  const { texto: n, origem } = mapear(texto);
  const marca = new Array<boolean>(texto.length).fill(false);
  for (const t of termos) {
    for (let i = n.indexOf(t); i !== -1; i = n.indexOf(t, i + 1)) {
      for (let k = origem[i]; k <= origem[i + t.length - 1]; k++) marca[k] = true;
    }
  }
  const partes: { txt: string; on: boolean }[] = [];
  for (let i = 0; i < texto.length; i++) {
    const ult = partes[partes.length - 1];
    if (ult && ult.on === marca[i]) ult.txt += texto[i];
    else partes.push({ txt: texto[i], on: marca[i] });
  }
  return (
    <>
      {partes.map((p, i) =>
        p.on
          ? <mark key={i} className="rounded bg-amber-300/40 px-0.5 text-foreground">{p.txt}</mark>
          : <span key={i}>{p.txt}</span>,
      )}
    </>
  );
}
