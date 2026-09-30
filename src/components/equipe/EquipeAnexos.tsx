import { useState } from "react";
import { Download, FileArchive, FileImage, FileSpreadsheet, FileText, File as FileIcon, ImageOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ehImagem, linkDeDownload, tamanhoLegivel, useLinksDosAnexos } from "./arquivos";
import type { Anexo } from "./tipos";

function IconeArquivo({ a }: { a: Anexo }) {
  const ext = a.nome.split(".").pop()?.toLowerCase() ?? "";
  if (ehImagem(a.mime)) return <FileImage className="h-5 w-5" />;
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return <FileSpreadsheet className="h-5 w-5" />;
  if (["zip", "rar", "7z"].includes(ext)) return <FileArchive className="h-5 w-5" />;
  if (["pdf", "doc", "docx", "txt", "odt"].includes(ext)) return <FileText className="h-5 w-5" />;
  return <FileIcon className="h-5 w-5" />;
}

const COR_EXT: Record<string, string> = {
  pdf: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  xls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", xlsx: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", csv: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  doc: "bg-sky-500/15 text-sky-600 dark:text-sky-400", docx: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};

/** Arquivos e imagens de uma mensagem. */
export function EquipeAnexos({ anexos }: { anexos: Anexo[] }) {
  const { data: links, isLoading, isError } = useLinksDosAnexos(anexos);
  const [aberta, setAberta] = useState<Anexo | null>(null);
  const imagens = anexos.filter((a) => ehImagem(a.mime));
  const outros = anexos.filter((a) => !ehImagem(a.mime));

  return (
    <div className="mt-1.5 space-y-1.5">
      {imagens.length > 0 && (
        <div className={cn("flex flex-wrap gap-1.5", imagens.length > 1 && "max-w-lg")}>
          {imagens.map((a) => {
            const url = links?.[a.path];
            // reserva o espaço da imagem antes de carregar: a conversa não pula
            const proporcao = a.largura && a.altura ? a.largura / a.altura : 4 / 3;
            const larg = imagens.length === 1 ? Math.min(360, a.largura ?? 360) : 160;
            return (
              <button
                key={a.path}
                type="button"
                onClick={() => url && setAberta(a)}
                className="group/img relative overflow-hidden rounded-lg border bg-muted"
                style={{ width: larg, maxWidth: "100%", aspectRatio: String(imagens.length === 1 ? proporcao : 1) }}
                aria-label={`Abrir ${a.nome}`}
              >
                {url ? (
                  <img src={url} alt={a.nome} loading="lazy" className="h-full w-full object-cover transition-transform group-hover/img:scale-[1.02]" />
                ) : (
                  <span className="grid h-full w-full place-items-center text-muted-foreground">
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageOff className="h-5 w-5" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {outros.map((a) => {
        const url = links?.[a.path];
        const ext = a.nome.split(".").pop()?.toLowerCase() ?? "";
        return (
          <div key={a.path} className="flex max-w-sm items-center gap-3 rounded-lg border bg-card px-3 py-2">
            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md", COR_EXT[ext] ?? "bg-muted text-muted-foreground")}>
              <IconeArquivo a={a} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium" title={a.nome}>{a.nome}</div>
              <div className="text-xs text-muted-foreground">{ext.toUpperCase()} · {tamanhoLegivel(a.tamanho)}</div>
            </div>
            {url ? (
              <a href={linkDeDownload(url, a.nome)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Baixar ${a.nome}`} title="Baixar">
                <Download className="h-4 w-4" />
              </a>
            ) : isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        );
      })}

      {isError && <p className="text-xs text-muted-foreground">Não foi possível abrir os arquivos agora.</p>}

      {/* Montado só quando abre: uma conversa com 20 imagens não carrega 20 diálogos fechados */}
      {aberta && (
      <Dialog open onOpenChange={(o) => !o && setAberta(null)}>
        <DialogContent className="max-w-5xl gap-3 p-3">
          <DialogTitle className="truncate pr-8 text-sm font-medium">{aberta?.nome}</DialogTitle>
          {aberta && links?.[aberta.path] && (
            <>
              <div className="grid max-h-[75vh] place-items-center overflow-auto rounded-md bg-muted/40">
                <img src={links[aberta.path]} alt={aberta.nome} className="max-h-[75vh] w-auto max-w-full object-contain" />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{aberta.largura && aberta.altura ? `${aberta.largura}×${aberta.altura} · ` : ""}{tamanhoLegivel(aberta.tamanho)}</span>
                <a href={linkDeDownload(links[aberta.path], aberta.nome)} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium text-foreground hover:bg-muted">
                  <Download className="h-3.5 w-3.5" /> Baixar
                </a>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      )}
    </div>
  );
}
