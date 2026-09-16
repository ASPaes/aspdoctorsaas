import { useState } from "react";
import { Download, Eye, FileText, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EmailRecebido } from "./useEmailsRecebidos";

/**
 * Anexos do e-mail recebido: ver na tela (imagem, PDF, vídeo, áudio) e baixar.
 *
 * Busca o arquivo pela rota autenticada do Storage, como a tela de anexos do
 * ticket; quem libera é a regra email_recebidos_anexos_select, que segue o RLS
 * de email_recebidos (o operador só abre anexo de e-mail que ele vê).
 *
 * Saiu de dentro de EmailsRecebidosTab em 15/09/2026 para o diálogo de leitura
 * usar o mesmo bloco: importar da aba criaria dependência circular.
 */
export const tamanhoLegivel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

export const podeVerNaTela = (mime: string) =>
  mime.startsWith("image/") || mime === "application/pdf" || mime.startsWith("video/") || mime.startsWith("audio/");

type Anexo = { nome: string; mime: string; tamanho: number; caminho: string };

/** baixa o arquivo pela rota autenticada; erro vira frase, não código HTTP */
export async function buscarAnexo(caminho: string): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sua sessão expirou. Entre de novo para abrir o anexo.");
  const resposta = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/authenticated/ticket-attachments/${caminho}`,
    { headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } },
  );
  if (!resposta.ok) {
    throw new Error(
      resposta.status === 400 || resposta.status === 404
        ? "Arquivo não encontrado, ou você não tem acesso a este e-mail."
        : `Não foi possível abrir o anexo (erro ${resposta.status}).`,
    );
  }
  return resposta.blob();
}

/** clipe com a contagem, que abre a lista de anexos (usado na linha da tabela) */
export function AnexosDoEmail({ linha }: { linha: EmailRecebido }) {
  const anexos = linha.anexos ?? [];
  const ignorados = linha.anexos_ignorados ?? [];

  if (anexos.length === 0 && ignorados.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-1.5 inline-flex items-center gap-0.5 rounded px-1 align-middle text-xs text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${anexos.length} anexo${anexos.length === 1 ? "" : "s"}: ver ou baixar`}
        >
          <Paperclip className="h-3 w-3" />
          {anexos.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Anexos do e-mail</p>
        <ListaDeAnexos anexos={anexos} ignorados={ignorados} semTicket={!linha.ticket_id} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A lista em si, sem o clipe: o diálogo de leitura mostra os anexos direto,
 * já abertos, e a linha da tabela mostra pelo clipe acima.
 */
export function ListaDeAnexos({
  anexos,
  ignorados = [],
  semTicket = false,
}: {
  anexos: Anexo[];
  ignorados?: string[];
  semTicket?: boolean;
}) {
  const [previa, setPrevia] = useState<{ url: string; nome: string; mime: string } | null>(null);
  const [carregando, setCarregando] = useState<string | null>(null);

  const ver = async (a: Anexo) => {
    setCarregando(a.caminho);
    try {
      const blob = await buscarAnexo(a.caminho);
      setPrevia({ url: URL.createObjectURL(blob), nome: a.nome, mime: a.mime });
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível abrir o anexo.");
    } finally {
      setCarregando(null);
    }
  };

  const baixar = async (a: Anexo) => {
    setCarregando(a.caminho);
    try {
      const blob = await buscarAnexo(a.caminho);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.nome;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível baixar o anexo.");
    } finally {
      setCarregando(null);
    }
  };

  const fecharPrevia = () => {
    if (previa) URL.revokeObjectURL(previa.url);
    setPrevia(null);
  };

  return (
    <>
      {anexos.length === 0 && ignorados.length === 0 && (
        <p className="px-1 py-1 text-xs text-muted-foreground">Nenhum arquivo foi guardado.</p>
      )}
      {anexos.map((a) => (
        <div key={a.caminho} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/60">
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm" title={a.nome}>
            {a.nome}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{tamanhoLegivel(a.tamanho)}</span>
          {podeVerNaTela(a.mime) && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => ver(a)}
              disabled={carregando === a.caminho}
              aria-label={`Ver ${a.nome}`}
            >
              {carregando === a.caminho ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => baixar(a)}
            disabled={carregando === a.caminho}
            aria-label={`Baixar ${a.nome}`}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {ignorados.length > 0 && (
        <p className="mt-1.5 border-t px-1 pt-1.5 text-[11px] text-muted-foreground">Não guardados: {ignorados.join("; ")}</p>
      )}
      {anexos.length > 0 && semTicket && (
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">Entram nos anexos do ticket quando ele for aberto.</p>
      )}

      <Dialog open={!!previa} onOpenChange={(aberto) => { if (!aberto) fecharPrevia(); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{previa?.nome}</DialogTitle>
          </DialogHeader>
          {previa &&
            (previa.mime.startsWith("image/") ? (
              <img src={previa.url} alt={previa.nome} className="mx-auto max-h-[75vh] max-w-full object-contain" />
            ) : previa.mime === "application/pdf" ? (
              <iframe src={previa.url} title={previa.nome} className="h-[75vh] w-full rounded border" />
            ) : previa.mime.startsWith("video/") ? (
              <video src={previa.url} controls className="max-h-[75vh] w-full" />
            ) : (
              <audio src={previa.url} controls className="w-full" />
            ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
