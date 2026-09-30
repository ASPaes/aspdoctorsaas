import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Formatação leve, no padrão de chat: *negrito*, _itálico_, ~riscado~,
 * `código`, ```bloco```, links e menções. Tudo vira elemento React: nada de
 * innerHTML, então texto colado nunca injeta marcação.
 */

interface Props {
  texto: string;
  /** Nomes (sem @) de quem foi mencionado nesta mensagem. */
  nomesMencionados?: string[];
  /** Destaca a menção a mim com cor mais forte. */
  meuNome?: string | null;
  className?: string;
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function montarRegex(nomes: string[]): RegExp {
  const mencoes = [...nomes].sort((a, b) => b.length - a.length).map(escapar);
  const partes = [
    // sem menção o grupo continua existindo (e nunca casa): senão os grupos
    // seguintes andam uma posição e negrito vira código
    mencoes.length ? `(@(?:${mencoes.join("|")}))` : "((?!))",
    "(@(?:todos|canal)\\b)",
    "((?:https?:\\/\\/|www\\.)[^\\s<]+[^\\s<.,;:!?)\\]'\"])",
    "(`[^`\\n]+`)",
    "(\\*[^*\\n]+\\*)",
    "(_[^_\\n]+_)",
    "(~[^~\\n]+~)",
  ];
  return new RegExp(partes.join("|"), "gi");
}

function linha(texto: string, re: RegExp, meuNome: string | null | undefined, k: string): ReactNode[] {
  const out: ReactNode[] = [];
  let ultimo = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(texto))) {
    if (m.index > ultimo) out.push(texto.slice(ultimo, m.index));
    const [tudo, mencao, todos, url, codigo, negrito, italico, riscado] = m;
    const key = `${k}-${i++}`;
    if (mencao || todos) {
      const souEu = !!meuNome && mencao?.slice(1).toLocaleLowerCase("pt-BR") === meuNome.toLocaleLowerCase("pt-BR");
      out.push(
        <span key={key} className={cn(
          "rounded px-0.5 font-semibold",
          souEu || todos ? "bg-amber-400/25 text-amber-700 dark:text-amber-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
        )}>{tudo}</span>,
      );
    } else if (url) {
      const href = url.startsWith("www.") ? `https://${url}` : url;
      out.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-sky-600 underline underline-offset-2 break-all dark:text-sky-400">
          {url}
        </a>,
      );
    } else if (codigo) {
      out.push(<code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-rose-600 dark:text-rose-400">{codigo.slice(1, -1)}</code>);
    } else if (negrito) {
      out.push(<strong key={key}>{negrito.slice(1, -1)}</strong>);
    } else if (italico) {
      out.push(<em key={key}>{italico.slice(1, -1)}</em>);
    } else if (riscado) {
      out.push(<s key={key}>{riscado.slice(1, -1)}</s>);
    }
    ultimo = m.index + tudo.length;
    if (tudo.length === 0) re.lastIndex++;
  }
  if (ultimo < texto.length) out.push(texto.slice(ultimo));
  return out;
}

export function TextoFormatado({ texto, nomesMencionados = [], meuNome, className }: Props) {
  const re = montarRegex(nomesMencionados);
  // blocos de código primeiro: dentro deles nada é formatado
  const blocos = texto.split(/```/);
  return (
    <div className={cn("whitespace-pre-wrap break-words leading-relaxed", className)}>
      {blocos.map((bloco, bi) => {
        if (bi % 2 === 1 && bi < blocos.length - 1) {
          return (
            <pre key={bi} className="my-1 overflow-x-auto rounded-md border bg-muted/60 p-2 font-mono text-xs">
              {bloco.replace(/^\n/, "")}
            </pre>
          );
        }
        const conteudo = bi % 2 === 1 ? "```" + bloco : bloco;
        return (
          <Fragment key={bi}>
            {conteudo.split("\n").map((l, li, arr) => (
              <Fragment key={li}>
                {linha(l, re, meuNome, `${bi}-${li}`)}
                {li < arr.length - 1 && "\n"}
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}
