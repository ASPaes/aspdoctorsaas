import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { FileDown, Loader2 } from 'lucide-react';

/**
 * Abre o PDF do boleto do título.
 *
 * O link vem do Omie e vale 24 horas, então ele é pedido na hora do clique, não
 * guardado na tela. A função do servidor reaproveita o link enquanto ele vale e
 * só bate na origem quando precisa.
 *
 * Título sem boleto gerado no ERP não mostra botão: quem gera boleto é o
 * financeiro, dentro do Omie, nunca esta tela.
 */
export default function BotaoBoleto({
  tituloId,
  boletoGerado,
  compacto = false,
}: {
  tituloId: string;
  boletoGerado: boolean;
  compacto?: boolean;
}) {
  const [carregando, setCarregando] = useState(false);

  if (!boletoGerado) return null;

  const abrir = async () => {
    setCarregando(true);
    try {
      const { data, error } = await supabase.functions.invoke('fin-titulo-boleto', {
        body: { titulo_id: tituloId },
      });
      if (error) throw error;
      if (!data?.ok || !data?.link_boleto) {
        toast.error(data?.error ?? 'Não foi possível pegar o boleto.');
        return;
      }
      // Abre numa aba nova. O navegador só permite isso dentro do clique, e a
      // espera pela resposta já passou: por isso o window.open vem aqui, com o
      // aviso de bloqueio de pop-up quando o navegador barra.
      const aba = window.open(data.link_boleto, '_blank', 'noopener,noreferrer');
      if (!aba) toast.warning('Seu navegador bloqueou a janela do boleto. Libere o pop-up e tente de novo.');
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Falha ao buscar o boleto.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={compacto ? 'h-7 gap-1 px-2 text-xs' : 'gap-1.5'}
      onClick={abrir}
      disabled={carregando}
    >
      {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
      Boleto
    </Button>
  );
}
