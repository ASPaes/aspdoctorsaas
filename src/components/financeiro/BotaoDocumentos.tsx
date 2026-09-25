import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { FileText, Loader2, ExternalLink, FileCode, ScrollText } from 'lucide-react';

/**
 * Nota fiscal, ordem de serviço e XML do título.
 *
 * ⚠️ O BOTÃO NÃO SABE O QUE EXISTE ANTES DE PERGUNTAR, e isso molda a interface.
 * Saber se há nota emitida custa duas chamadas ao Omie, então perguntar de
 * antemão para cada linha da tabela seria centenas de chamadas para desenhar
 * uma tela. O botão aparece para todo título que tenha ordem de serviço, e o
 * menu só se abre depois que a resposta chega.
 *
 * A regra do Alexandre: tem nota, mostra a nota; não tem, mostra a OS. Por isso
 * a OS não é um plano B escondido — ela aparece sempre, porque é o documento
 * que existe em todos os casos.
 */
interface Documentos {
  pdf_nfse?: string | null;
  xml_nfse?: string | null;
  url_oficial?: string | null;
  pdf_os?: string | null;
  portal?: string | null;
  numero_nf?: string | null;
  numero_os?: string | null;
}

export default function BotaoDocumentos({
  tituloId,
  temOs,
  compacto = false,
}: {
  tituloId: string;
  temOs: boolean;
  compacto?: boolean;
}) {
  const [carregando, setCarregando] = useState(false);
  const [docs, setDocs] = useState<Documentos | null>(null);
  const [aberto, setAberto] = useState(false);

  if (!temOs) return null;

  const buscar = async () => {
    if (docs) {
      setAberto(true);
      return;
    }
    setCarregando(true);
    try {
      const { data, error } = await supabase.functions.invoke('fin-titulo-documentos', {
        body: { titulo_id: tituloId },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error ?? 'Não foi possível buscar os documentos.');
        return;
      }
      const d = (data.documentos ?? {}) as Documentos;
      if (!d.pdf_nfse && !d.pdf_os) {
        toast.info('Este título ainda não tem nota nem ordem de serviço disponível.');
        return;
      }
      setDocs(d);
      setAberto(true);
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Falha ao buscar os documentos.');
    } finally {
      setCarregando(false);
    }
  };

  // O navegador só deixa abrir aba nova dentro do clique, e aqui o clique é o
  // do item do menu — a espera pela resposta já aconteceu antes de o menu
  // existir, então window.open funciona.
  const abrir = (url?: string | null) => {
    if (!url) return;
    const aba = window.open(url, '_blank', 'noopener,noreferrer');
    if (!aba) toast.warning('Seu navegador bloqueou a janela. Libere o pop-up e tente de novo.');
  };

  const gatilho = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={compacto ? 'h-7 gap-1 px-2 text-xs' : 'gap-1.5'}
      disabled={carregando}
      onClick={(e) => {
        if (!docs) {
          // Sem documentos ainda: este clique é o que vai buscá-los, então ele
          // não pode abrir o menu vazio.
          e.preventDefault();
          buscar();
        }
      }}
    >
      {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
      Nota / OS
    </Button>
  );

  if (!docs) return gatilho;

  return (
    <DropdownMenu open={aberto} onOpenChange={setAberto}>
      <DropdownMenuTrigger asChild>{gatilho}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {docs.pdf_nfse ? (
          <DropdownMenuItem onClick={() => abrir(docs.pdf_nfse)} className="gap-2">
            <FileText className="h-4 w-4" />
            <span className="flex-1">Nota fiscal</span>
            {docs.numero_nf && <span className="text-xs text-muted-foreground">nº {docs.numero_nf}</span>}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className="gap-2">
            <FileText className="h-4 w-4" />
            Sem nota fiscal emitida
          </DropdownMenuItem>
        )}

        {docs.pdf_os && (
          <DropdownMenuItem onClick={() => abrir(docs.pdf_os)} className="gap-2">
            <ScrollText className="h-4 w-4" />
            <span className="flex-1">Ordem de serviço</span>
            {docs.numero_os && (
              <span className="text-xs text-muted-foreground">
                nº {String(Number(docs.numero_os))}
              </span>
            )}
          </DropdownMenuItem>
        )}

        {docs.url_oficial && (
          <DropdownMenuItem onClick={() => abrir(docs.url_oficial)} className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Consulta oficial da nota
          </DropdownMenuItem>
        )}

        {docs.xml_nfse && (
          <DropdownMenuItem onClick={() => abrir(docs.xml_nfse)} className="gap-2">
            <FileCode className="h-4 w-4" />
            XML da nota
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
