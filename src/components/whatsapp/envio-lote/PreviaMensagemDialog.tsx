import { useState } from "react";
import { format } from "date-fns";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PdfPreviewLightbox } from "@/components/whatsapp/chat/PdfPreviewLightbox";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  subtitulo?: string;
  conteudo: string;
  arquivo?: string | null;
  horario?: string | null;
  /** true = texto-modelo: destaca {nome_cliente} em vez de mostrar como veio. */
  modelo?: boolean;
  /** Mensagem já enviada (whatsapp_messages.id): é por ela que o PDF abre e baixa. */
  mensagemId?: string | null;
  /** Sem mensagemId: usa a primeira mensagem já enviada deste envio. */
  envioId?: string | null;
}

// O PDF do envio em lote não tem link próprio: ele é aberto pelo mesmo proxy do
// chat (`whatsapp-media-proxy`), que confere login e empresa a partir da
// mensagem enviada. Por isso a prévia do arquivo só existe depois que a
// primeira mensagem sai.
function urlDoProxy(messageId: string, modo: "inline" | "attachment", token: string) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  return `${base}/functions/v1/whatsapp-media-proxy?message_row_id=${messageId}&mode=${modo}&token=${token}`;
}

async function tokenAtual(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  return session.access_token;
}

/** Bolha no formato do WhatsApp com a mensagem do envio em lote (DEM-0492). */
export function PreviaMensagemDialog({ aberto, onFechar, titulo, subtitulo, conteudo, arquivo, horario, modelo, mensagemId, envioId }: Props) {
  const partes = modelo ? conteudo.split("{nome_cliente}") : [conteudo];
  const [pdfAberto, setPdfAberto] = useState<{ id: string; nome: string } | null>(null);
  const [baixando, setBaixando] = useState(false);

  const { data: idDoEnvio, isLoading: procurando } = useQuery<string | null>({
    queryKey: ["envio-lote", "primeira-enviada", envioId],
    enabled: aberto && !!arquivo && !mensagemId && !!envioId,
    queryFn: async () => {
      const { data } = await (supabase.from("whatsapp_scheduled_messages" as any) as any)
        .select("sent_message_id")
        .eq("bulk_send_id", envioId)
        .not("sent_message_id", "is", null)
        .limit(1)
        .maybeSingle();
      return (data as any)?.sent_message_id ?? null;
    },
  });
  const idArquivo = mensagemId || idDoEnvio || null;
  const nomeArquivo = arquivo || "arquivo.pdf";

  const visualizar = () => {
    if (!idArquivo) return;
    // O visualizador é tela cheia e não pode ficar dentro do diálogo: a janela
    // do diálogo prenderia ele no tamanho dela. Fecha o diálogo e abre por fora.
    setPdfAberto({ id: idArquivo, nome: nomeArquivo });
    onFechar();
  };

  const abrirEmNovaAba = async (id: string) => {
    try {
      window.open(urlDoProxy(id, "inline", await tokenAtual()), "_blank");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível abrir o arquivo.");
    }
  };

  const baixar = async () => {
    if (!idArquivo || baixando) return;
    setBaixando(true);
    try {
      const token = await tokenAtual();
      const resp = await fetch(urlDoProxy(idArquivo, "attachment", token), { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`O arquivo não está mais disponível (${resp.status}).`);
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível baixar o arquivo.");
    } finally {
      setBaixando(false);
    }
  };

  return (
    <>
      <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
        <DialogContent className="max-w-md grid-cols-1 overflow-hidden">
          <DialogHeader className="min-w-0">
            <DialogTitle className="truncate pr-6">{titulo}</DialogTitle>
            {subtitulo && <DialogDescription>{subtitulo}</DialogDescription>}
          </DialogHeader>
          <div className="flex min-w-0 max-h-[60vh] flex-col overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-[#EFEAE2] p-3 dark:bg-[#0B141A]">
            <div className="relative ml-auto min-w-0 max-w-[92%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-lg rounded-br-sm bg-[#D9FDD3] px-2.5 pb-4 pt-2 text-[13.5px] text-[#111B21] shadow-sm dark:bg-[#005C4B] dark:text-[#E9EDEF]">
              {arquivo && (
                <div className="mb-1.5 flex items-center gap-2 rounded-md bg-black/5 p-2 whitespace-normal">
                  <FileText className="h-5 w-5 shrink-0 text-red-600" />
                  <button
                    type="button"
                    onClick={visualizar}
                    disabled={!idArquivo}
                    className="min-w-0 flex-1 truncate text-left text-xs font-semibold hover:underline disabled:no-underline"
                    title={idArquivo ? "Visualizar PDF" : undefined}
                  >
                    {arquivo}
                  </button>
                </div>
              )}
              {partes.map((p, i) => (
                <span key={i}>
                  {p}
                  {i < partes.length - 1 && (
                    <span className="rounded bg-sky-500/20 px-1 font-mono text-[12px] text-sky-700 dark:text-sky-300">{"{nome_cliente}"}</span>
                  )}
                </span>
              ))}
              {horario && (
                <span className="absolute bottom-0.5 right-2 text-[10px] opacity-60">{format(new Date(horario), "HH:mm")}</span>
              )}
            </div>
          </div>
          {arquivo && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!idArquivo && (
                <span className="mr-auto text-xs text-muted-foreground">
                  {procurando ? "Procurando o arquivo..." : "O PDF fica disponível aqui depois que a primeira mensagem sair."}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={visualizar} disabled={!idArquivo}>
                <Eye className="mr-1.5 h-4 w-4" /> Visualizar PDF
              </Button>
              <Button variant="outline" size="sm" onClick={baixar} disabled={!idArquivo || baixando}>
                {baixando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />} Baixar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {pdfAberto && (
        <PdfPreviewLightbox
          messageId={pdfAberto.id}
          filename={pdfAberto.nome}
          onClose={() => setPdfAberto(null)}
          onOpenNewTab={() => abrirEmNovaAba(pdfAberto.id)}
        />
      )}
    </>
  );
}
