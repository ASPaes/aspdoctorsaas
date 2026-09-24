import { useEffect, useState } from "react";
import { Bell, Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationContext } from "@/contexts/NotificationContext";
import {
  appInstalado,
  ehIOS,
  instalarNaTelaInicial,
  ouvirConviteDeInstalacao,
  temConviteDeInstalacao,
} from "@/lib/instalarApp";

/**
 * Os dois passos para o chat avisar no telefone, oferecidos pelo próprio
 * sistema: permitir os avisos e instalar na tela inicial.
 *
 * Isto existe porque nenhum dos dois pode depender de instrução falada. O
 * pedido de permissão só existia no sistema completo, e quem abria o chat no
 * telefone nunca era convidado — nenhum aviso chegava, sem explicação. E o
 * convite de instalação do Chrome aparece quando ele quer: some por 90 dias se
 * a pessoa dispensar, e logo depois de uma desinstalação. Com o evento
 * capturado em lib/instalarApp.ts, o convite passa a ser nosso.
 *
 * Um passo por vez, na ordem que importa: sem permissão não existe aviso, e
 * instalado sem permissão continua mudo. Some sozinha quando não há mais nada a
 * pedir.
 */

const CHAVE_DISPENSA = "ds_convite_telefone_dispensado";

export function FaixaPermitirAvisos() {
  const { browserPermission, requestBrowserPermission } = useNotificationContext();
  const [podeInstalar, setPodeInstalar] = useState(temConviteDeInstalacao);
  const [dispensado, setDispensado] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_DISPENSA) === "1";
    } catch {
      return false;
    }
  });
  const [mostrarPassoIOS, setMostrarPassoIOS] = useState(false);

  useEffect(() => ouvirConviteDeInstalacao(() => setPodeInstalar(temConviteDeInstalacao())), []);

  const instalado = appInstalado();
  const faltaPermissao = browserPermission === "default";
  // No iPhone não há evento de instalação: o que dá é mostrar o caminho.
  const faltaInstalar = !instalado && (podeInstalar || ehIOS());

  if (dispensado && !faltaPermissao) return null;
  if (!faltaPermissao && !faltaInstalar) return null;

  const dispensar = () => {
    setDispensado(true);
    try {
      localStorage.setItem(CHAVE_DISPENSA, "1");
    } catch {
      // Sem localStorage a faixa volta na próxima abertura; nada quebra.
    }
  };

  // Passo 1 tem prioridade: instalado sem permissão continua sem avisar nada.
  if (faltaPermissao) {
    return (
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-primary/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Bell className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-xs text-foreground">
            Receba aviso de mensagem neste aparelho
          </span>
        </div>
        <Button size="sm" className="h-7 shrink-0 px-3 text-xs" onClick={() => requestBrowserPermission()}>
          Permitir
        </Button>
      </div>
    );
  }

  if (mostrarPassoIOS) {
    return (
      <div className="flex shrink-0 items-start gap-2 border-b border-border bg-primary/10 px-3 py-2">
        <Share className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-xs leading-snug text-foreground">
          Toque em <strong>Compartilhar</strong> na barra do Safari e escolha{" "}
          <strong>Adicionar à Tela de Início</strong>.
        </p>
        <button type="button" onClick={dispensar} aria-label="Fechar aviso" className="shrink-0 p-1">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-primary/10 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Download className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate text-xs text-foreground">Instale o chat na tela do telefone</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => {
            if (ehIOS()) {
              setMostrarPassoIOS(true);
              return;
            }
            void instalarNaTelaInicial();
          }}
        >
          Instalar
        </Button>
        <button type="button" onClick={dispensar} aria-label="Fechar aviso" className="p-1">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
