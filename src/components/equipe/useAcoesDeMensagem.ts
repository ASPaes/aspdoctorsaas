import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { chaves, mensagemDeErro, refsDosCodigos, useEquipeAcoes } from "./useEquipe";
import { extrairMencoes, type PaginasMsgs } from "./equipeUtils";
import type { Anexo, Mensagem, Pessoa, Ref } from "./tipos";

/**
 * Ações sobre mensagens, iguais na conversa e no fio. Os handlers são
 * estáveis e recebem a mensagem: o memo de cada linha continua valendo.
 */
export function useAcoesDeMensagem(pessoas: Pessoa[]) {
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const acoes = useEquipeAcoes();
  const [editando, setEditando] = useState<string | null>(null);
  const erro = (e: unknown) => toast.error(mensagemDeErro(e));

  const enviarTexto = useCallback(async (canalId: string, parentId: string | null, texto: string, refs: Ref[], arquivos: Anexo[], permiteTodos: boolean) => {
    const { ids, todos } = extrairMencoes(texto, pessoas);
    // TK-2026-0418 digitado no texto também vira cartão
    let todas = refs;
    if (/\bTK-\d{4}-\d{3,}/i.test(texto)) {
      const achadas = await refsDosCodigos(texto, tid).catch(() => [] as Ref[]);
      todas = [...refs, ...achadas.filter((a) => !refs.some((r) => r.id === a.id))].slice(0, 5);
    }
    acoes.enviar.mutate(
      { canalId, parentId, corpo: texto, mencoes: ids, todos: todos && permiteTodos, refs: todas, anexos: arquivos, tempId: `tmp-${crypto.randomUUID()}` },
      { onError: erro },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoas, tid]);

  const onReagir = useCallback((m: Mensagem, emoji: string) => {
    acoes.reagir.mutate({ msg: m, emoji }, { onError: erro });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onApagar = useCallback((m: Mensagem) => {
    acoes.apagar.mutate({ msg: m }, { onError: erro });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSalvarEdicao = useCallback(async (m: Mensagem, corpo: string) => {
    const { ids } = extrairMencoes(corpo, pessoas);
    try {
      await acoes.editar.mutateAsync({ msg: m, corpo, mencoes: ids });
      setEditando(null);
    } catch (e) { erro(e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoas]);

  const onFixar = useCallback((m: Mensagem, fixar: boolean) => {
    acoes.fixar.mutate({ msg: m, fixar }, {
      onSuccess: () => toast.success(fixar ? "Mensagem fixada no canal" : "Mensagem desafixada"),
      onError: erro,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSalvar = useCallback((m: Mensagem, salvar: boolean) => {
    acoes.salvar.mutate({ msg: m, salvar }, {
      onSuccess: () => toast.success(salvar ? "Salva. Está em Salvos, no alto da lista." : "Tirada dos salvos"),
      onError: erro,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRetentar = useCallback((m: Mensagem) => {
    const chave = m.parent_id ? chaves.fio(m.parent_id) : chaves.msgs(m.canal_id);
    qc.setQueryData<PaginasMsgs>(chave, (d) => d && { ...d, pages: d.pages.map((pg) => pg.filter((x) => x.id !== m.id)) });
    enviarTexto(m.canal_id, m.parent_id, m.corpo, m.refs ?? [], m.anexos ?? [], m.menciona_todos);
  }, [qc, enviarTexto]);

  const onEditar = useCallback((m: Mensagem | null) => setEditando(m?.id ?? null), []);

  return { editando, setEditando, enviarTexto, onReagir, onApagar, onSalvarEdicao, onFixar, onSalvar, onRetentar, onEditar };
}
