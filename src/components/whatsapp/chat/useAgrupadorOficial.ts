import { useCallback, useEffect, useRef, useState } from "react";
import {
  acrescentar, prazoDeEnvio, registrarDescarregador, segundosRestantes, textoDaPendente,
  type Pendente,
} from "./composerOficial";

/**
 * Mensagem pendente do modo "agrupar" (API Oficial). Cada Enter junta uma parte;
 * a pendente sai sozinha `janelaMs` depois da última atividade, nunca mais de 15 s
 * depois da primeira parte. Enquanto a pessoa ainda escreve, a contagem para.
 *
 * Sai na hora (antes do que vier depois, para manter a ordem) ao trocar de
 * conversa, ao desmontar, ao mandar anexo/macro/áudio/template e quando o
 * cabeçalho encerra ou transfere (via `descarregarPendente`).
 *
 * O envio usa o caminho de sempre — quem passa `enviar` é o ChatInput.
 */
export function useAgrupadorOficial(opts: {
  conversationId: string;
  janelaMs: number;
  campoComTexto: boolean;
  enviar: (p: Pendente) => Promise<void>;
}) {
  const { conversationId, janelaMs, campoComTexto } = opts;
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const pendenteRef = useRef<Pendente | null>(null);
  pendenteRef.current = pendente;
  const enviarRef = useRef(opts.enviar);
  enviarRef.current = opts.enviar;

  const descarregar = useCallback(async () => {
    const p = pendenteRef.current;
    pendenteRef.current = null;
    setPendente(null);
    if (p && p.partes.length > 0) await enviarRef.current(p);
  }, []);

  const adicionar = useCallback((texto: string, quotedMessageId?: string) => {
    const p = acrescentar(pendenteRef.current, conversationId, texto, Date.now(), quotedMessageId);
    pendenteRef.current = p;
    setPendente(p);
    setAgora(Date.now());
  }, [conversationId]);

  /** "Editar": tira a pendente e devolve o texto para quem chamou pôr no campo. */
  const retirar = useCallback((): string => {
    const texto = textoDaPendente(pendenteRef.current);
    pendenteRef.current = null;
    setPendente(null);
    return texto;
  }, []);

  const cancelar = useCallback(() => {
    pendenteRef.current = null;
    setPendente(null);
  }, []);

  // Apagou tudo do campo: a contagem volta a correr a partir de agora, e não do
  // último Enter (senão sairia na hora, sem a pessoa ver o "Enviando em…").
  const campoAntes = useRef(campoComTexto);
  useEffect(() => {
    if (campoAntes.current && !campoComTexto && pendenteRef.current) {
      const p = { ...pendenteRef.current, ultimaAtividadeEm: Date.now() };
      pendenteRef.current = p;
      setPendente(p);
    }
    campoAntes.current = campoComTexto;
  }, [campoComTexto]);

  // Relógio só enquanto há pendente.
  useEffect(() => {
    if (!pendente) return;
    const id = window.setInterval(() => setAgora(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [pendente]);

  const prazo = pendente ? prazoDeEnvio(pendente, { janelaMs, campoComTexto }) : null;

  useEffect(() => {
    if (prazo != null && agora >= prazo) void descarregar();
  }, [agora, prazo, descarregar]);

  // Trocar de conversa ou desmontar: a pendente sai para a conversa DELA
  // (Pendente guarda o conversationId), nunca para a que abriu agora.
  useEffect(() => {
    return () => { void descarregar(); };
  }, [conversationId, descarregar]);

  // Encerrar/transferir no cabeçalho chamam descarregarPendente(conversa).
  useEffect(() => {
    if (!pendente) return;
    return registrarDescarregador(pendente.conversationId, descarregar);
  }, [pendente, descarregar]);

  // Fechar a aba com mensagem pendente: o navegador pergunta antes de sair.
  useEffect(() => {
    if (!pendente) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [pendente]);

  return {
    pendente,
    texto: textoDaPendente(pendente),
    segundos: prazo != null ? segundosRestantes(prazo, agora) : null,
    /** 0..1 da janela já passada, para a barrinha. */
    progresso: pendente && prazo != null
      ? Math.min(1, Math.max(0, 1 - (prazo - agora) / Math.max(1, prazo - pendente.ultimaAtividadeEm)))
      : 0,
    pausado: !!pendente && campoComTexto,
    adicionar,
    descarregar,
    retirar,
    cancelar,
  };
}
