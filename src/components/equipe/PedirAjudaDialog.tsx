import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Hash, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { isChatHost } from "@/lib/chatHost";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AvatarPessoa } from "./AvatarPessoa";
import { EquipeCartoes } from "./EquipeCartoes";
import { presencaDe } from "./equipeUtils";
import { chaves, mensagemDeErro, useEquipeAcoes, useEquipeConversas, useEquipePessoas } from "./useEquipe";
import type { Ref } from "./tipos";

type Destino = { tipo: "canal"; id: string } | { tipo: "pessoa"; id: string };

const ORDEM_PRESENCA = { livre: 0, ocupado: 1, pausa: 2, offline: 3 } as const;

/**
 * Pedir ajuda a partir de um atendimento: manda o cartão vivo do atendimento
 * para o canal do setor ou para um colega. Quem recebe abre a conversa pelo
 * cartão (se tiver acesso ao setor dela).
 */
export function PedirAjudaDialog({ atendimentoId, aberto, onFechar }: { atendimentoId: string; aberto: boolean; onFechar: () => void }) {
  const { user } = useAuth();
  const eu = user?.id ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const acoes = useEquipeAcoes();
  const { data: conversas = [] } = useEquipeConversas();
  const { pessoas, mapa } = useEquipePessoas();
  const [destino, setDestino] = useState<Destino | null>(null);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState(false);
  const refs: Ref[] = useMemo(() => [{ tipo: "atendimento", id: atendimentoId }], [atendimentoId]);

  const canais = useMemo(() => {
    const ordem = { setor: 0, geral: 1, canal: 2 } as Record<string, number>;
    return conversas.filter((c) => (c.tipo === "setor" || c.tipo === "geral" || c.tipo === "canal") && !c.arquivado)
      .sort((a, b) => (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9));
  }, [conversas]);

  // quem está livre primeiro: pedir ajuda para quem está em pausa não resolve
  const colegas = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase("pt-BR");
    return pessoas
      .filter((p) => p.user_id !== eu && (!t || `${p.nome} ${p.setor ?? ""}`.toLocaleLowerCase("pt-BR").includes(t)))
      .sort((a, b) => ORDEM_PRESENCA[presencaDe(a).tom] - ORDEM_PRESENCA[presencaDe(b).tom] || a.nome.localeCompare(b.nome, "pt-BR"))
      .slice(0, 30);
  }, [pessoas, eu, busca]);

  useEffect(() => {
    if (!aberto) return;
    setTexto("Pode me ajudar com este atendimento?");
    setBusca("");
    const setor = canais.find((c) => c.tipo === "setor");
    setDestino(setor ? { tipo: "canal", id: setor.id } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const enviar = async () => {
    if (!destino) return;
    setEnviando(true);
    try {
      const canalId = destino.tipo === "canal" ? destino.id : await acoes.abrirDm([destino.id]);
      const { error } = await (supabase.rpc as any)("equipe_enviar", {
        p_canal_id: canalId, p_corpo: texto.trim(), p_parent_id: null, p_mencoes: [], p_menciona_todos: false, p_refs: refs,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: chaves.msgs(canalId) });
      // no chat.doctorsaas.com.br não existe a tela Equipe: lá só confirma
      toast.success("Pedido de ajuda enviado", isChatHost() ? undefined
        : { action: { label: "Ver na Equipe interna", onClick: () => navigate(`/equipe?c=${canalId}`) } });
      onFechar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  const itemCls = (ativo: boolean) => cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm", ativo ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted");

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pedir ajuda à equipe</DialogTitle>
          <DialogDescription>O atendimento vai como cartão: quem recebe vê o estado atual e abre a conversa com um toque.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea id="equipe-ajuda-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={2000} />
          <div className="rounded-lg bg-muted/40 p-2"><EquipeCartoes refs={refs} mapa={mapa} eu={eu} /></div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mandar para</p>
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {canais.map((c) => (
                <button key={c.id} type="button" onClick={() => setDestino({ tipo: "canal", id: c.id })} className={itemCls(destino?.tipo === "canal" && destino.id === c.id)}>
                  {c.tipo === "setor" ? <Users className="h-4 w-4 text-muted-foreground" /> : <Hash className="h-4 w-4 text-muted-foreground" />}
                  <span className="flex-1 truncate">{c.tipo === "setor" ? `Canal do setor ${c.nome}` : `#${c.nome}`}</span>
                </button>
              ))}
              <div className="flex items-center gap-2 rounded-md border px-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input id="equipe-ajuda-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ou um colega, direto"
                  autoComplete="off" className="h-8 w-full bg-transparent text-sm outline-none" />
              </div>
              {colegas.map((p) => (
                <button key={p.user_id} type="button" onClick={() => setDestino({ tipo: "pessoa", id: p.user_id })} className={itemCls(destino?.tipo === "pessoa" && destino.id === p.user_id)}>
                  <AvatarPessoa userId={p.user_id} pessoa={p} tamanho="sm" comPresenca />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[p.setor, presencaDe(p).texto].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              ))}
            </div>
            {destino?.tipo === "pessoa" && mapa.get(destino.id)?.department_id !== mapa.get(eu)?.department_id && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                {mapa.get(destino.id)?.nome?.split(" ")[0]} é de outro setor e pode não ter acesso a esta conversa.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={enviar} disabled={!destino || enviando}>{enviando ? "Enviando" : "Pedir ajuda"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
