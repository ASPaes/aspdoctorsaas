import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Deep-link das filas de integração.
 *
 * Por que existe: desde 23/08/2026 a notificação de fila parada guarda em
 * `notifications.action_url` o caminho da LINHA que travou —
 * `?section=integracoes-oem&aba=fila&fila=<id>`. As Configurações já liam `section`
 * da URL, mas a sub-aba morava em `useState` e o id da linha não era lido por
 * ninguém: o clique na notificação caía na aba padrão e sobrava para a pessoa
 * procurar a linha na mão, que é exatamente o trabalho que o alerta deveria poupar.
 */

/** Sub-aba das Configurações na URL, com um padrão para quando ela não vier. */
export function useAbaNaUrl(padrao: string, chave = "aba"): [string, (valor: string) => void] {
  const [sp, setSp] = useSearchParams();
  const aba = sp.get(chave) || padrao;

  const setAba = useCallback(
    (valor: string) => {
      const proxima = new URLSearchParams(sp);
      proxima.set(chave, valor);
      // Trocar de aba na mão descarta o destaque: ele aponta para uma linha
      // específica e não faz sentido arrastá-lo para outra tela.
      proxima.delete("fila");
      // replace: navegar entre abas não deve encher o botão Voltar do navegador.
      setSp(proxima, { replace: true });
    },
    [sp, setSp, chave],
  );

  return [aba, setAba];
}

/**
 * A linha que a notificação apontou (`?fila=<id>`), para destacar e rolar até ela.
 *
 * `pronto` é a lista já carregada — rolar antes disso rolaria até um esqueleto.
 * Só rola uma vez: com auto-refresh de 30s no painel, repetir arrancaria a tela
 * de quem já estava lendo outra coisa.
 */
export function useLinhaDestacada(pronto: boolean) {
  const [sp] = useSearchParams();
  const destacarId = sp.get("fila");
  const refDestaque = useRef<HTMLDivElement | null>(null);
  const jaRolou = useRef(false);

  useEffect(() => {
    if (!destacarId || !pronto || jaRolou.current || !refDestaque.current) return;
    jaRolou.current = true;
    refDestaque.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [destacarId, pronto]);

  return { destacarId, refDestaque };
}

/** Classe do realce. Uma só, para os dois painéis destacarem igual. */
export const CLASSE_DESTAQUE = "ring-2 ring-primary/60 border-primary/40 bg-primary/5";
