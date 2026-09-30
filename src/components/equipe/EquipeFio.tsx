import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EquipeMensagem } from "./EquipeMensagem";
import { EquipeComposer } from "./EquipeComposer";
import { chaves, useEquipeAcoes, useMensagem, useRespostasDoFio, useSalvos } from "./useEquipe";
import { useAcoesDeMensagem } from "./useAcoesDeMensagem";
import { montarLinhaDoTempo, nomeDaConversa, prefixoCanal, type PaginasMsgs } from "./equipeUtils";
import type { Anexo, Conversa, Mensagem, Pessoa, Ref } from "./tipos";

interface Props {
  raizId: string;
  conversa: Conversa | null;
  pessoas: Pessoa[];
  mapa: Map<string, Pessoa>;
  eu: string;
  podeGerir: boolean;
  souAdmin: boolean;
  onFechar: () => void;
}

/** Respostas a uma mensagem, sem poluir o canal. */
export function EquipeFio({ raizId, conversa, pessoas, mapa, eu, podeGerir, souAdmin, onFechar }: Props) {
  const qc = useQueryClient();
  const acoes = useEquipeAcoes();
  const am = useAcoesDeMensagem(pessoas);
  const { ids: salvos } = useSalvos();
  const respostas = useRespostasDoFio(raizId);
  const lista = useRef<HTMLDivElement>(null);

  // a raiz: do cache do canal (se carregado) ou buscada à parte
  const doCanal = useMemo(() => {
    if (!conversa) return undefined;
    const d = qc.getQueryData<PaginasMsgs>(chaves.msgs(conversa.id));
    return d?.pages.flat().find((m) => m.id === raizId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raizId]);
  // sempre a consulta própria: é ela que o Realtime e as ações atualizam
  const raiz: Mensagem | undefined = useMensagem(raizId, doCanal).data ?? undefined;

  const msgs = useMemo(() => [...(respostas.data?.pages ?? []).flat()].reverse(), [respostas.data]);
  const itens = useMemo(() => montarLinhaDoTempo(msgs, { eu }).filter((i) => i.tipo === "msg"), [msgs, eu]);

  const marcarLido = useCallback(() => {
    if (document.visibilityState === "visible") acoes.marcarFioLido(raizId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raizId]);

  const ultima = msgs[msgs.length - 1]?.id;
  useEffect(() => {
    if (!respostas.isSuccess) return;
    const t = setTimeout(marcarLido, 500);
    return () => clearTimeout(t);
  }, [ultima, respostas.isSuccess, marcarLido]);

  useLayoutEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const enviar = useCallback((texto: string, refs: Ref[], arquivos: Anexo[]) => {
    if (!raiz) return;
    am.enviarTexto(raiz.canal_id, raizId, texto, refs, arquivos, conversa?.tipo !== "dm");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raiz?.canal_id, raizId, conversa?.tipo, am.enviarTexto]);

  const editarUltima = () => {
    const minha = [...msgs].reverse().find((m) => m.autor_id === eu && !m.apagada_em && !m._pendente);
    if (minha) am.setEditando(minha.id);
  };

  const onde = conversa ? `${prefixoCanal(conversa)}${nomeDaConversa(conversa, mapa)}` : "";
  const podeFixar = !!conversa && (conversa.tipo === "dm" || conversa.tipo === "grupo" || podeGerir);
  const nulo = () => {};

  return (
    <aside className="flex h-full min-h-0 flex-col border-l bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight">Fio</h2>
          <p className="truncate text-xs text-muted-foreground">{onde}</p>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onFechar} aria-label="Fechar fio"><X className="h-4 w-4" /></Button>
      </header>

      <div ref={lista} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {!raiz ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="border-b pb-2 pt-1">
              <EquipeMensagem
                msg={raiz} continuacao={false} eu={eu} pessoas={mapa} podeApagarDosOutros={souAdmin}
                editando={am.editando === raiz.id} salva={salvos.has(raiz.id)} podeFixar={podeFixar} noFio
                onFixar={am.onFixar} onSalvar={am.onSalvar} onEditar={am.onEditar} onSalvarEdicao={am.onSalvarEdicao}
                onReagir={am.onReagir} onApagar={am.onApagar} onRetentar={nulo}
              />
            </div>
            <div className="flex items-center gap-3 px-4 py-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {msgs.length === 0 ? "Nenhuma resposta ainda" : `${msgs.length} ${msgs.length === 1 ? "resposta" : "respostas"}`}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {respostas.isLoading && <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
            {itens.map((it) => it.tipo === "msg" && (
              <EquipeMensagem
                key={it.chave} msg={it.msg} continuacao={it.continuacao} eu={eu} pessoas={mapa}
                podeApagarDosOutros={souAdmin} editando={am.editando === it.msg.id} salva={salvos.has(it.msg.id)}
                podeFixar={false} noFio
                onFixar={am.onFixar} onSalvar={am.onSalvar} onEditar={am.onEditar} onSalvarEdicao={am.onSalvarEdicao}
                onReagir={am.onReagir} onApagar={am.onApagar} onRetentar={am.onRetentar}
              />
            ))}
          </>
        )}
      </div>

      <EquipeComposer
        chave={`fio-${raizId}`}
        canalId={raiz?.canal_id ?? conversa?.id ?? ""}
        placeholder="Responder no fio"
        pessoas={pessoas}
        eu={eu}
        permiteTodos={false}
        desabilitado={!raiz ? "Carregando" : raiz.apagada_em ? "A mensagem de origem foi apagada" : conversa?.arquivado ? "Canal arquivado" : null}
        onEnviar={enviar}
        onEditarUltima={editarUltima}
      />
    </aside>
  );
}
