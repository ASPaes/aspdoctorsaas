import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isChatHost } from "@/lib/chatHost";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { EquipeLista } from "@/components/equipe/EquipeLista";
import { EquipeConversa } from "@/components/equipe/EquipeConversa";
import { EquipeFio } from "@/components/equipe/EquipeFio";
import { EquipeBusca } from "@/components/equipe/EquipeBusca";
import { EquipeFiosVista, EquipeSalvosVista } from "@/components/equipe/EquipeVistas";
import {
  AdicionarPessoasDialog, NovaConversaDialog, NovoCanalDialog, ProcurarCanaisDialog,
} from "@/components/equipe/EquipeDialogos";
import { mensagemDeErro, useEquipeAcoes, useEquipeConversas, useEquipePessoas, useEquipeTempoReal, useMeusFios } from "@/components/equipe/useEquipe";
import type { Mensagem } from "@/components/equipe/tipos";

/**
 * Equipe DS: chat interno entre colaboradores (canais, conversas diretas e
 * grupos). O lugar fica na URL para o aviso levar direto e o F5 não perder:
 *   ?c=<canal>  conversa aberta      ?f=<mensagem>  fio aberto ao lado
 *   ?m=<msg>    rolar até ela        ?v=fios|salvos listas pessoais
 */
export default function Equipe() {
  const { user, profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const [params, setParams] = useSearchParams();
  const selecionada = params.get("c");
  const fio = params.get("f");
  const irPara = params.get("m");
  const vistaParam = params.get("v");
  const vista = vistaParam === "fios" || vistaParam === "salvos" ? vistaParam : null;
  const eu = user?.id ?? "";

  const { data: conversas = [], isLoading } = useEquipeConversas();
  const { data: fios = [] } = useMeusFios();
  const { pessoas, mapa } = useEquipePessoas();
  const acoes = useEquipeAcoes();
  // no computador o menu lateral já liga; no chat.doctorsaas.com.br não há menu. O canal é compartilhado.
  useEquipeTempoReal();

  const [novaConversa, setNovaConversa] = useState(false);
  const [novoCanal, setNovoCanal] = useState(false);
  const [procurar, setProcurar] = useState(false);
  const [adicionar, setAdicionar] = useState(false);
  const [buscar, setBuscar] = useState(false);

  const isSuper = profile?.is_super_admin === true;
  const podeGerir = isSuper || profile?.role === "admin" || profile?.role === "head";
  const souAdmin = isSuper || profile?.role === "admin";

  const navegar = useCallback((mudar: Record<string, string | null>, substituir = false) => {
    setParams((atual) => {
      const p = new URLSearchParams(atual);
      for (const [k, v] of Object.entries(mudar)) { if (v) p.set(k, v); else p.delete(k); }
      return p;
    }, { replace: substituir });
  }, [setParams]);

  const selecionar = useCallback((id: string | null) => navegar({ c: id, f: null, m: null, v: null }, !id), [navegar]);
  const abrirVista = (v: "fios" | "salvos") => navegar({ v, c: null, f: null, m: null });
  const abrirFio = useCallback((m: Mensagem) => navegar({ f: m.id }), [navegar]);
  const abrirMensagem = useCallback((canalId: string, msgId: string, parentId: string | null) => {
    // resposta de fio: abre o fio e leva o canal até a mensagem de origem
    navegar({ c: canalId, f: parentId, m: parentId ?? msgId, v: null });
  }, [navegar]);
  const abrirPessoa = async (userId: string) => {
    try { selecionar(await acoes.abrirDm([userId])); } catch (e) { toast.error(mensagemDeErro(e)); }
  };

  // Ctrl+K em qualquer lugar da tela
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setBuscar(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Sem nada na URL (desktop): abre o #geral. No celular fica na lista.
  useEffect(() => {
    if (selecionada || vista || conversas.length === 0) return;
    if (window.matchMedia("(min-width: 768px)").matches) {
      const geral = conversas.find((c) => c.tipo === "geral");
      if (geral) navegar({ c: geral.id }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionada, vista, conversas.length]);

  const atual = useMemo(() => conversas.find((c) => c.id === selecionada) ?? null, [conversas, selecionada]);

  // conversa da URL que não está na lista: acabei de criar/entrar e a lista
  // ainda recarrega; ou perdi o acesso (aí volta para a lista)
  useEffect(() => {
    if (!selecionada || isLoading || atual) return;
    const t = setTimeout(() => {
      if (!conversas.some((c) => c.id === selecionada)) selecionar(null);
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionada, isLoading, atual]);

  const fiosNaoLidos = fios.reduce((s, f) => s + f.nao_lidas, 0);
  const fiosMencoes = fios.reduce((s, f) => s + f.mencoes, 0);

  if (!tid) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-sm">
          <MessagesSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Escolha uma empresa</h2>
          <p className="mt-1 text-sm text-muted-foreground">O chat da equipe é de cada empresa. Selecione uma no topo para ver os canais dela.</p>
        </div>
      </div>
    );
  }

  const temPrincipal = !!selecionada || !!vista;

  return (
    <div className={cn(
      // Altura explícita no computador, como na tela de Chat (WhatsApp.tsx): o
      // layout do app é min-h-screen, então "h-full" não trava nada e uma conversa
      // com muitas imagens esticava a página inteira (8 mil px). No celular
      // (chat.doctorsaas.com.br) o layout já tem altura fixa (100dvh) e ainda
      // pode ter a faixa de avisos: lá é h-full, senão o campo de escrever corta.
      "relative grid min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[280px_minmax(0,1fr)]",
      isChatHost() ? "h-full" : "h-[calc(100vh-3.5rem)]",
      fio && atual && "xl:grid-cols-[280px_minmax(0,1fr)_400px]",
    )}>
      <div className={cn("min-h-0", temPrincipal ? "hidden md:block" : "block")}>
        <EquipeLista
          conversas={conversas}
          pessoas={mapa}
          eu={eu}
          selecionada={vista ? null : selecionada}
          carregando={isLoading}
          podeCriarCanal={podeGerir}
          onSelecionar={selecionar}
          onNovaConversa={() => setNovaConversa(true)}
          onNovoCanal={() => setNovoCanal(true)}
          onProcurar={() => setProcurar(true)}
          vista={vista}
          onVista={abrirVista}
          fiosNaoLidos={fiosNaoLidos}
          fiosMencoes={fiosMencoes}
          onBuscar={() => setBuscar(true)}
        />
      </div>

      <div className={cn("min-h-0 min-w-0", temPrincipal ? "block" : "hidden md:block", fio && atual && "hidden md:block")}>
        {vista === "fios" ? (
          <EquipeFiosVista mapa={mapa} onVoltar={() => navegar({ v: null })}
            onAbrir={(canalId, raizId) => navegar({ c: canalId, f: raizId, m: raizId, v: null })} />
        ) : vista === "salvos" ? (
          <EquipeSalvosVista mapa={mapa} onVoltar={() => navegar({ v: null })} onAbrir={abrirMensagem} />
        ) : atual ? (
          <EquipeConversa
            key={atual.id}
            conversa={atual}
            pessoas={pessoas}
            mapa={mapa}
            eu={eu}
            podeGerir={podeGerir}
            souAdmin={souAdmin}
            irPara={irPara}
            onIrParaConcluido={() => navegar({ m: null }, true)}
            onIrPara={(id) => navegar({ m: id })}
            fioAberto={fio}
            onAbrirFio={abrirFio}
            onVoltar={() => selecionar(null)}
            onAdicionarPessoas={() => setAdicionar(true)}
            onFechou={() => selecionar(null)}
            onBuscar={() => setBuscar(true)}
            onConversarCom={abrirPessoa}
          />
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
            {selecionada ? "Abrindo conversa" : "Escolha uma conversa ao lado"}
          </div>
        )}
      </div>

      {fio && atual && (
        // xl: terceira coluna. Abaixo disso: painel por cima da conversa.
        <div className="absolute inset-0 z-20 min-h-0 md:left-auto md:w-[400px] md:shadow-2xl xl:static xl:w-auto xl:shadow-none">
          <EquipeFio
            key={fio}
            raizId={fio}
            conversa={atual}
            pessoas={pessoas}
            mapa={mapa}
            eu={eu}
            podeGerir={podeGerir}
            souAdmin={souAdmin}
            onFechar={() => navegar({ f: null })}
          />
        </div>
      )}

      <NovaConversaDialog aberto={novaConversa} onFechar={() => setNovaConversa(false)} pessoas={pessoas} eu={eu} onAbriu={selecionar} />
      <NovoCanalDialog aberto={novoCanal} onFechar={() => setNovoCanal(false)} pessoas={pessoas} eu={eu} onCriou={selecionar} />
      <ProcurarCanaisDialog aberto={procurar} onFechar={() => setProcurar(false)} conversas={conversas} onAbrir={selecionar} />
      <AdicionarPessoasDialog aberto={adicionar} onFechar={() => setAdicionar(false)} canal={atual} pessoas={pessoas} eu={eu} />
      <EquipeBusca
        aberto={buscar}
        onFechar={() => setBuscar(false)}
        conversas={conversas}
        pessoas={pessoas}
        mapa={mapa}
        eu={eu}
        onAbrirConversa={selecionar}
        onAbrirPessoa={abrirPessoa}
        onAbrirMensagem={(m) => abrirMensagem(m.canal_id, m.id, m.parent_id)}
      />
    </div>
  );
}
