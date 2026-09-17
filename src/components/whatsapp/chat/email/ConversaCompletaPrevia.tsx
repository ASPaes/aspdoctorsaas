import { useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  conteudoDaMensagem,
  LIMITE_AVISO_GMAIL_BYTES,
  type BlocoConversa,
  type ConversaMontada,
} from "./conversaCompleta";
import { formatarTamanho } from "./travaEnvioEmail";

const FUSO = "America/Sao_Paulo";
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

/**
 * Prévia da conversa que vai depois da assinatura. Fica fora do editor de
 * propósito: é a conversa como foi trocada, então nem a pessoa nem o Sotaque
 * nem o Corrigir mexem nela.
 */
export function ConversaCompletaPrevia({
  carregando,
  erro,
  blocos,
  montada,
  cortada,
  contatoNome,
  bytesResumo,
}: {
  carregando: boolean;
  erro: string | null;
  blocos: BlocoConversa[];
  montada: ConversaMontada | null;
  cortada: boolean;
  contatoNome: string | null;
  bytesResumo: number;
}) {
  const [aberta, setAberta] = useState(false);

  if (carregando) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando a conversa completa...
      </div>
    );
  }
  if (erro) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
        {erro}
      </div>
    );
  }
  if (!montada || montada.mensagens === 0) {
    return (
      <div className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground">
        Este atendimento não tem mensagens de texto para incluir.
      </div>
    );
  }

  const grande = montada.bytes + bytesResumo > LIMITE_AVISO_GMAIL_BYTES;
  const linhas = blocos.flatMap((b) =>
    b.mensagens.flatMap((m) => {
      const c = conteudoDaMensagem(m);
      return c ? [{ b, m, c }] : [];
    }),
  );
  const visiveis = aberta ? linhas : linhas.slice(0, 4);
  const inicio = linhas[0]?.m.timestamp;
  const fim = linhas[linhas.length - 1]?.m.timestamp;
  const codigos = [...new Set(blocos.map((b) => b.codigo).filter((c) => c != null))];

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setAberta((v) => !v)}
          aria-expanded={aberta}
          className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 bg-muted px-3 py-2 text-left text-xs hover:bg-muted/80"
        >
          <MessageCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">
            {codigos.length === 1
              ? `Conversa completa do atendimento #${codigos[0]}`
              : codigos.length > 1
                ? `Conversa completa de ${codigos.length} atendimentos`
                : "Conversa completa"}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {montada.mensagens} {montada.mensagens === 1 ? "mensagem" : "mensagens"}
            {inicio && fim ? ` · ${new Date(inicio).toLocaleDateString("pt-BR", { timeZone: FUSO })}, ${hora(inicio)} a ${hora(fim)}` : ""}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-sky-700 dark:text-sky-400">
            {aberta ? "Recolher" : "Ver tudo"}
            <ChevronDown className={cn("h-3 w-3 transition-transform", aberta && "rotate-180")} />
          </span>
        </button>
        <div className={cn("space-y-1.5 px-3 py-2.5 text-xs", aberta && "max-h-72 overflow-y-auto")}>
          {visiveis.map(({ m, c }, i) => (
            <div key={i} className="grid grid-cols-[40px_minmax(0,1fr)] gap-2">
              <time className="pt-px text-[11px] text-muted-foreground tabular-nums">{hora(m.timestamp)}</time>
              <p className="min-w-0 break-words">
                <span className={cn("font-semibold", m.is_from_me ? "text-emerald-600 dark:text-emerald-400" : "text-sky-700 dark:text-sky-400")}>
                  {m.is_from_me
                    ? (m.sender_name?.trim() || "Atendente") + (m.sender_name?.trim() ? " (atendente)" : "")
                    : `${m.sender_name?.trim() || contatoNome || "Cliente"} (cliente)`}
                  :
                </span>{" "}
                {c.marca && <span className="italic text-muted-foreground">{c.marca} </span>}
                {c.texto}
              </p>
            </div>
          ))}
          {!aberta && linhas.length > visiveis.length && (
            <p className="pt-0.5 text-center text-[11px] text-muted-foreground">+ {linhas.length - visiveis.length} mensagens</p>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Vai depois da assinatura, do jeito que foi trocada.</p>
      {(grande || cortada) && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          {cortada
            ? "A conversa passa do limite e foi incluída só até as primeiras 3.000 mensagens."
            : `Conversa grande (${formatarTamanho(montada.bytes)}). O Gmail pode esconder o final do e-mail atrás de "Ver mensagem inteira".`}
        </p>
      )}
    </div>
  );
}
