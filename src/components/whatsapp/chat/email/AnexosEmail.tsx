import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, ExternalLink, Eye, FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BotaoBarra } from "./EditorEmail";
import {
  ANEXO_ACCEPT,
  ANEXO_MAX_ARQUIVOS,
  ANEXO_MAX_TOTAL_BYTES,
  formatarTamanho,
  tipoParaVisualizar,
  type TipoVisualizacao,
} from "./travaEnvioEmail";

/**
 * Anexo do e-mail do chat (2ª entrega do mockup "Editor do E-mail", 15/09/2026).
 * O arquivo sobe assim que é escolhido (uploadChatMedia → whatsapp-media); o
 * cartão mostra enviando, pronto ou falhou, e o Enviar espera terminar.
 *
 * Ver e Baixar (pedido do Alexandre, 15/09): mesmo olho e mesmo download da tela
 * E-mails › Recebidos. Aqui o arquivo ainda está no navegador, então a prévia sai
 * do próprio `File`, na hora, sem baixar nada do Storage e antes mesmo de subir.
 */
export interface AnexoNaTela {
  id: string;
  nome: string;
  tamanho: number;
  mime: string;
  status: "enviando" | "pronto" | "erro";
  /** o arquivo escolhido, para ver e baixar antes de enviar */
  arquivo?: File;
  /** caminho no bucket, só depois de subir */
  path?: string;
  erro?: string;
}

export function BotaoAnexar({ onEscolher, desabilitado }: { onEscolher: (arquivos: File[]) => void; desabilitado?: boolean }) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <>
      <BotaoBarra
        titulo="Anexar arquivo"
        desabilitado={desabilitado}
        className="gap-1.5 px-2 text-xs font-medium"
        onClick={() => entrada.current?.click()}
      >
        <Paperclip className="h-4 w-4" />
        Anexar
      </BotaoBarra>
      <input
        ref={entrada}
        id="envio-anexos"
        type="file"
        multiple
        accept={ANEXO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const arquivos = Array.from(e.target.files ?? []);
          // limpa para escolher o mesmo arquivo de novo depois de tirar
          e.target.value = "";
          if (arquivos.length) onEscolher(arquivos);
        }}
      />
    </>
  );
}

/** Safari no iPhone/iPad não desenha PDF em iframe: lá a prévia vira "abrir em nova guia" */
function ehIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
}

interface Previa {
  url: string;
  nome: string;
  tipo: TipoVisualizacao;
  /** o próprio arquivo: dois prints com o mesmo nome não se confundem no Baixar */
  arquivo: File;
}

function baixarArquivo(arquivo: Blob, nome: string) {
  const url = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const botaoCartao =
  "rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ListaAnexos({ anexos, onRemover }: { anexos: AnexoNaTela[]; onRemover: (id: string) => void }) {
  const [previa, setPrevia] = useState<Previa | null>(null);

  // endereço temporário da prévia é liberado ao trocar de arquivo ou fechar a tela
  useEffect(() => () => {
    if (previa) URL.revokeObjectURL(previa.url);
  }, [previa]);

  if (anexos.length === 0) return null;
  const total = anexos.reduce((soma, a) => soma + a.tamanho, 0);

  const ver = (a: AnexoNaTela) => {
    const tipo = tipoParaVisualizar(a.arquivo?.type || a.mime, a.nome);
    if (!a.arquivo || !tipo) return;
    setPrevia({ url: URL.createObjectURL(a.arquivo), nome: a.nome, tipo, arquivo: a.arquivo });
  };

  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {anexos.map((a) => {
          const visualizavel = !!a.arquivo && !!tipoParaVisualizar(a.arquivo.type || a.mime, a.nome);
          return (
            <span
              key={a.id}
              title={a.status === "erro" ? `${a.nome}: ${a.erro ?? "falha no upload"}` : a.nome}
              className={cn(
                "flex max-w-full items-center gap-2 rounded-md border bg-card py-1 pl-2 pr-1 text-xs",
                a.status === "erro" ? "border-destructive/60 text-destructive" : "border-border",
              )}
            >
              {a.status === "enviando" ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : a.status === "erro" ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              ) : a.mime.startsWith("image/") ? (
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-sky-500" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-red-500" />
              )}
              <span className="max-w-[200px] truncate font-medium">{a.nome}</span>
              <span className="shrink-0 text-muted-foreground">
                {a.status === "enviando" ? "anexando..." : a.status === "erro" ? "falhou" : formatarTamanho(a.tamanho)}
              </span>
              <span className="flex items-center">
                {visualizavel && (
                  <button type="button" aria-label={`Ver ${a.nome}`} title="Ver" onClick={() => ver(a)} className={botaoCartao}>
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                )}
                {a.arquivo && (
                  <button
                    type="button"
                    aria-label={`Baixar ${a.nome}`}
                    title="Baixar"
                    onClick={() => baixarArquivo(a.arquivo!, a.nome)}
                    className={botaoCartao}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
                <button type="button" aria-label={`Remover ${a.nome}`} title="Remover" onClick={() => onRemover(a.id)} className={botaoCartao}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </span>
          );
        })}
        <span className="text-[11px] text-muted-foreground">
          {anexos.length} de {ANEXO_MAX_ARQUIVOS} arquivos · {formatarTamanho(total)} de {formatarTamanho(ANEXO_MAX_TOTAL_BYTES)}
        </span>
      </div>

      <Dialog open={!!previa} onOpenChange={(aberto) => !aberto && setPrevia(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6 text-base">{previa?.nome}</DialogTitle>
          </DialogHeader>
          {previa &&
            (previa.tipo === "imagem" ? (
              <img src={previa.url} alt={previa.nome} className="mx-auto max-h-[70vh] max-w-full object-contain" />
            ) : previa.tipo === "pdf" ? (
              ehIOS() ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
                  <FileText className="h-10 w-10" />
                  Este aparelho não mostra PDF dentro da janela.
                  <Button type="button" variant="outline" size="sm" onClick={() => window.open(previa.url, "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir em nova guia
                  </Button>
                </div>
              ) : (
                <iframe src={previa.url} title={previa.nome} className="h-[70vh] w-full rounded border" />
              )
            ) : previa.tipo === "video" ? (
              <video src={previa.url} controls className="max-h-[70vh] w-full" />
            ) : (
              <audio src={previa.url} controls className="w-full" />
            ))}
          <DialogFooter>
            {previa && (
              <Button type="button" variant="outline" onClick={() => baixarArquivo(previa.arquivo, previa.nome)}>
                <Download className="mr-2 h-4 w-4" />
                Baixar
              </Button>
            )}
            <Button type="button" onClick={() => setPrevia(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
