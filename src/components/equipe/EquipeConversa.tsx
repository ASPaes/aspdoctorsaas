import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, Bell, BellOff, Hash, Loader2, Lock, LogOut, MoreVertical, UserPlus, Users, EyeOff, Pin, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AvatarPessoa } from "./AvatarPessoa";
import { EquipeMensagem } from "./EquipeMensagem";
import { EquipeComposer, type ComposerHandle } from "./EquipeComposer";
import { TextoFormatado } from "./TextoFormatado";
import { mensagemDeErro, useEquipeAcoes, useFixadas, useMensagensDoCanal, useSalvos } from "./useEquipe";
import { useAcoesDeMensagem } from "./useAcoesDeMensagem";
import { horaCurta, montarLinhaDoTempo, nomeDaConversa, prefixoCanal, presencaDe } from "./equipeUtils";
import type { Anexo, Conversa, Mensagem, Pessoa, Ref } from "./tipos";

interface Props {
  conversa: Conversa;
  pessoas: Pessoa[];
  mapa: Map<string, Pessoa>;
  eu: string;
  podeGerir: boolean;
  souAdmin: boolean;
  /** Mensagem para rolar até e piscar (busca, salvos, fixadas). */
  irPara: string | null;
  onIrParaConcluido: () => void;
  onIrPara: (msgId: string) => void;
  fioAberto: string | null;
  onAbrirFio: (m: Mensagem) => void;
  onVoltar: () => void;
  onAdicionarPessoas: () => void;
  onFechou: () => void;
  onBuscar: () => void;
}

const PERTO_DO_FIM = 120;
const MAX_PAGINAS_ATRAS = 20; // até 1.000 mensagens procurando a que foi pedida

function Fixadas({ canalId, mapa, onIrPara }: { canalId: string; mapa: Map<string, Pessoa>; onIrPara: (id: string) => void }) {
  const { data: fixadas = [] } = useFixadas(canalId);
  const [aberto, setAberto] = useState(false);
  if (fixadas.length === 0) return null;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-xs" aria-label="Mensagens fixadas">
          <Pin className="h-3.5 w-3.5" />{fixadas.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fixadas neste canal</div>
        <ul className="max-h-96 divide-y overflow-y-auto">
          {fixadas.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => { setAberto(false); onIrPara(m.id); }} className="block w-full px-3 py-2.5 text-left hover:bg-muted">
                <div className="mb-0.5 flex items-center gap-2 text-xs">
                  <AvatarPessoa userId={m.autor_id} pessoa={mapa.get(m.autor_id ?? "")} tamanho="xs" />
                  <span className="font-semibold">{mapa.get(m.autor_id ?? "")?.nome ?? "Colaborador"}</span>
                  <span className="text-muted-foreground">{horaCurta(m.created_at)}</span>
                </div>
                <TextoFormatado texto={m.corpo} className="line-clamp-3 text-sm" />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Cabecalho({ c, mapa, podeGerir, onVoltar, onAdicionarPessoas, onFechou, onIrPara, onBuscar }: Pick<Props, "mapa" | "podeGerir" | "onVoltar" | "onAdicionarPessoas" | "onFechou" | "onIrPara" | "onBuscar"> & { c: Conversa }) {
  const acoes = useEquipeAcoes();
  const nome = nomeDaConversa(c, mapa);
  const outro = c.tipo === "dm" ? mapa.get(c.outros[0] ?? "") : undefined;

  let sub = "";
  if (c.tipo === "dm") {
    sub = [presencaDe(outro).texto, outro?.cargo, outro?.setor].filter(Boolean).join(" · ");
  } else if (c.tipo === "grupo") {
    sub = ["Você", ...c.outros.map((id) => mapa.get(id)?.nome ?? "Colaborador")].join(", ");
  } else if (c.tipo === "geral") {
    sub = `Toda a equipe · ${mapa.size} pessoas`;
  } else if (c.tipo === "setor") {
    const n = [...mapa.values()].filter((p) => p.department_id === c.department_id).length;
    sub = `Setor ${c.nome} · ${n} ${n === 1 ? "pessoa" : "pessoas"}`;
  } else {
    sub = [c.privado ? "Canal privado" : "Canal aberto", c.descricao].filter(Boolean).join(" · ");
  }

  const executar = async (fn: () => Promise<void>, ok: string) => {
    try { await fn(); toast.success(ok); } catch (e) { toast.error(mensagemDeErro(e)); }
  };

  const Icone = c.tipo === "setor" ? Users : c.privado ? Lock : Hash;

  return (
    <header className="flex items-center gap-3 border-b px-4 py-2.5">
      <Button size="icon" variant="ghost" className="-ml-2 h-8 w-8 md:hidden" onClick={onVoltar} aria-label="Voltar para a lista">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      {c.tipo === "dm" ? (
        <AvatarPessoa userId={c.outros[0] ?? null} pessoa={outro} tamanho="md" comPresenca />
      ) : c.tipo === "grupo" ? (
        <div className="flex -space-x-2">
          {c.outros.slice(0, 3).map((id) => <AvatarPessoa key={id} userId={id} pessoa={mapa.get(id)} tamanho="sm" className="rounded-md ring-2 ring-background" />)}
        </div>
      ) : (
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground"><Icone className="h-4 w-4" /></span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-semibold leading-tight">
          {prefixoCanal(c) && <span className="text-muted-foreground">{prefixoCanal(c)}</span>}{nome}
        </h2>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
      {c.silenciado && <BellOff className="h-4 w-4 text-muted-foreground" aria-label="Avisos silenciados" />}
      <Fixadas canalId={c.id} mapa={mapa} onIrPara={onIrPara} />
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onBuscar} aria-label="Buscar (Ctrl+K)" title="Buscar (Ctrl+K)">
        <Search className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Opções da conversa"><MoreVertical className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => executar(() => acoes.silenciar(c.id, !c.silenciado), c.silenciado ? "Avisos ligados" : "Conversa silenciada")}>
            {c.silenciado ? <Bell className="mr-2 h-4 w-4" /> : <BellOff className="mr-2 h-4 w-4" />}
            {c.silenciado ? "Ligar avisos" : "Silenciar conversa"}
          </DropdownMenuItem>
          {c.tipo === "canal" && podeGerir && (
            <DropdownMenuItem onClick={onAdicionarPessoas}><UserPlus className="mr-2 h-4 w-4" />Adicionar pessoas</DropdownMenuItem>
          )}
          {(c.tipo === "canal" || c.tipo === "dm" || c.tipo === "grupo") && <DropdownMenuSeparator />}
          {c.tipo === "canal" && (
            <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => executar(async () => { await acoes.sair(c.id); onFechou(); }, `Você saiu de #${c.nome}`)}>
              <LogOut className="mr-2 h-4 w-4" />Sair do canal
            </DropdownMenuItem>
          )}
          {(c.tipo === "dm" || c.tipo === "grupo") && (
            <DropdownMenuItem onClick={() => executar(async () => { await acoes.sair(c.id); onFechou(); }, "Conversa fechada. Ela volta quando chegar mensagem nova.")}>
              <EyeOff className="mr-2 h-4 w-4" />Fechar conversa
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

export function EquipeConversa(props: Props) {
  const { conversa: c, pessoas, mapa, eu, podeGerir, souAdmin, irPara, onIrParaConcluido, fioAberto, onAbrirFio } = props;
  const acoes = useEquipeAcoes();
  const q = useMensagensDoCanal(c.id);
  const { ids: salvos } = useSalvos();
  const am = useAcoesDeMensagem(pessoas);
  const lista = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [soltando, setSoltando] = useState(false);
  const [temNovasAbaixo, setTemNovasAbaixo] = useState(false);
  const [destacada, setDestacada] = useState<string | null>(null);
  const pertoDoFim = useRef(true);
  const alturaAntes = useRef<number | null>(null);
  const primeiraRolagem = useRef(true);
  const podeFixar = c.tipo === "dm" || c.tipo === "grupo" || podeGerir;

  // Onde a pessoa parou de ler, congelado na abertura: a divisória "novas
  // mensagens" não pode fugir enquanto ela lê.
  const naoLidasNaAbertura = useRef(c.nao_lidas);

  const msgs = useMemo(() => [...(q.data?.pages ?? []).flat()].reverse(), [q.data]);

  const lidoAte = useMemo(() => {
    const n = naoLidasNaAbertura.current;
    if (!n) return null;
    const dosOutros = msgs.filter((m) => m.autor_id !== eu && !m._pendente && m.tipo === "texto");
    const alvo = dosOutros[dosOutros.length - n];
    return alvo ? new Date(new Date(alvo.created_at).getTime() - 1).toISOString() : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs.length > 0, eu]);

  const itens = useMemo(() => montarLinhaDoTempo(msgs, { lidoAte, eu }), [msgs, lidoAte, eu]);

  // ---- leitura
  const marcarLido = useCallback(() => {
    if (document.visibilityState === "visible") acoes.marcarLido(c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  const ultimaId = msgs[msgs.length - 1]?.id;
  useEffect(() => {
    if (!ultimaId || !pertoDoFim.current) return;
    const t = setTimeout(marcarLido, 600);
    return () => clearTimeout(t);
  }, [ultimaId, marcarLido]);

  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === "visible" && pertoDoFim.current) marcarLido(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [marcarLido]);

  // ---- rolagem
  const irParaFim = (suave = false) => {
    const el = lista.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: suave ? "smooth" : "auto" });
    setTemNovasAbaixo(false);
  };

  useLayoutEffect(() => {
    const el = lista.current;
    if (!el || msgs.length === 0) return;
    // carregou página antiga em cima: mantém o olho no mesmo lugar
    if (alturaAntes.current !== null) {
      el.scrollTop += el.scrollHeight - alturaAntes.current;
      alturaAntes.current = null;
      return;
    }
    if (primeiraRolagem.current) {
      primeiraRolagem.current = false;
      if (irPara) return; // quem manda é o "ir para"
      const divisoria = el.querySelector<HTMLElement>("[data-novas]");
      if (divisoria) el.scrollTop = Math.max(0, divisoria.offsetTop - 80);
      else el.scrollTop = el.scrollHeight;
      pertoDoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM;
      return;
    }
    const ultima = msgs[msgs.length - 1];
    if (pertoDoFim.current || (ultima?.autor_id === eu && ultima._pendente)) irParaFim();
    else if (ultima?.autor_id !== eu) setTemNovasAbaixo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs]);

  // ---- ir até uma mensagem: carrega páginas antigas até achar
  const tentativas = useRef(0);
  useEffect(() => { tentativas.current = 0; }, [irPara]);
  useEffect(() => {
    if (!irPara || q.isLoading) return;
    const el = lista.current?.querySelector<HTMLElement>(`[data-msg-id="${irPara}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      pertoDoFim.current = false;
      setDestacada(irPara);
      const t = setTimeout(() => setDestacada(null), 2200);
      onIrParaConcluido();
      return () => clearTimeout(t);
    }
    if (q.hasNextPage && !q.isFetchingNextPage && tentativas.current < MAX_PAGINAS_ATRAS) {
      tentativas.current += 1;
      q.fetchNextPage();
    } else if (!q.hasNextPage || tentativas.current >= MAX_PAGINAS_ATRAS) {
      toast.error("Não encontrei essa mensagem. Ela pode ter sido apagada.");
      onIrParaConcluido();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irPara, msgs, q.isLoading, q.hasNextPage, q.isFetchingNextPage]);

  const aoRolar = () => {
    const el = lista.current;
    if (!el) return;
    const perto = el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM;
    if (perto && !pertoDoFim.current) { setTemNovasAbaixo(false); marcarLido(); }
    pertoDoFim.current = perto;
    if (el.scrollTop < 200 && q.hasNextPage && !q.isFetchingNextPage && !irPara) {
      alturaAntes.current = el.scrollHeight;
      q.fetchNextPage();
    }
  };

  const enviar = useCallback((texto: string, refs: Ref[], arquivos: Anexo[]) => {
    am.enviarTexto(c.id, null, texto, refs, arquivos, c.tipo !== "dm");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, c.tipo, am.enviarTexto]);

  const editarUltima = () => {
    const minha = [...msgs].reverse().find((m) => m.autor_id === eu && m.tipo === "texto" && !m.apagada_em && !m._pendente);
    if (minha) am.setEditando(minha.id);
  };

  // se a mensagem em edição for apagada por outra pessoa, sai da edição
  useEffect(() => {
    if (am.editando && msgs.find((m) => m.id === am.editando)?.apagada_em) am.setEditando(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, am.editando]);

  const nome = nomeDaConversa(c, mapa);
  const placeholder = c.tipo === "dm" || c.tipo === "grupo" ? `Mensagem para ${nome}` : `Mensagem em ${prefixoCanal(c)}${nome}`;

  return (
    <section
      className="relative flex h-full min-h-0 min-w-0 flex-col bg-background"
      // arrastar arquivo em qualquer lugar da conversa anexa
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files") && !c.arquivado) { e.preventDefault(); setSoltando(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSoltando(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setSoltando(false); composer.current?.adicionarArquivos([...e.dataTransfer.files]); } }}
    >
      {soltando && (
        <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-sky-500 bg-sky-500/10 text-base font-semibold text-sky-700 dark:text-sky-300">
          Solte para anexar em {prefixoCanal(c)}{nomeDaConversa(c, mapa)}
        </div>
      )}
      <Cabecalho c={c} mapa={mapa} podeGerir={podeGerir} onVoltar={props.onVoltar} onAdicionarPessoas={props.onAdicionarPessoas}
        onFechou={props.onFechou} onIrPara={props.onIrPara} onBuscar={props.onBuscar} />

      <div className="relative min-h-0 flex-1">
        <div ref={lista} onScroll={aoRolar} className="h-full overflow-y-auto overscroll-contain py-2">
          {q.isFetchingNextPage && (
            <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          )}
          {!q.hasNextPage && !q.isLoading && <Inicio c={c} nome={nome} mapa={mapa} />}
          {q.isLoading ? (
            <div className="space-y-4 px-4 pt-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-9 w-9 animate-pulse rounded-lg bg-muted" />
                  <div className="flex-1 space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-muted" /><div className="h-3 w-2/3 animate-pulse rounded bg-muted" /></div>
                </div>
              ))}
            </div>
          ) : q.isError ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Não foi possível carregar as mensagens.{" "}
              <button type="button" className="font-medium text-foreground underline" onClick={() => q.refetch()}>Tentar de novo</button>
            </div>
          ) : (
            itens.map((it) => {
              if (it.tipo === "dia") {
                return (
                  // fundo na faixa: fixa no topo ao rolar, sem ele a data ficava por cima do texto da mensagem
                  <div key={it.chave} className="sticky top-0 z-[5] flex items-center gap-3 bg-background/95 px-4 py-2 backdrop-blur-sm">
                    <span className="h-px flex-1 bg-border" />
                    <span className="rounded-full border bg-background px-3 py-0.5 text-xs font-semibold text-muted-foreground first-letter:uppercase">{it.rotulo}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                );
              }
              if (it.tipo === "novas") {
                return (
                  <div key={it.chave} data-novas className="flex items-center gap-3 px-4 py-1">
                    <span className="h-px flex-1 bg-rose-500/60" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Novas mensagens</span>
                  </div>
                );
              }
              return (
                <div key={it.chave} className={cn(fioAberto === it.msg.id && "bg-sky-500/10")}>
                  <EquipeMensagem
                    msg={it.msg}
                    continuacao={it.continuacao}
                    eu={eu}
                    pessoas={mapa}
                    podeApagarDosOutros={souAdmin}
                    editando={am.editando === it.msg.id}
                    salva={salvos.has(it.msg.id)}
                    podeFixar={podeFixar}
                    destacada={destacada === it.msg.id}
                    onAbrirFio={onAbrirFio}
                    onFixar={am.onFixar}
                    onSalvar={am.onSalvar}
                    onEditar={am.onEditar}
                    onSalvarEdicao={am.onSalvarEdicao}
                    onReagir={am.onReagir}
                    onApagar={am.onApagar}
                    onRetentar={am.onRetentar}
                  />
                </div>
              );
            })
          )}
        </div>
        {temNovasAbaixo && (
          <button
            type="button"
            onClick={() => { irParaFim(true); marcarLido(); }}
            className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg"
          >
            <ArrowDown className="h-3.5 w-3.5" /> Novas mensagens
          </button>
        )}
      </div>

      <EquipeComposer
        ref={composer}
        chave={c.id}
        canalId={c.id}
        placeholder={placeholder}
        pessoas={pessoas}
        eu={eu}
        permiteTodos={c.tipo !== "dm"}
        desabilitado={c.arquivado ? "Este canal foi arquivado e não recebe mensagens" : null}
        onEnviar={enviar}
        onEditarUltima={editarUltima}
      />
    </section>
  );
}

/** Topo da conversa: aparece quando não há mais nada para carregar. */
function Inicio({ c, nome, mapa }: { c: Conversa; nome: string; mapa: Map<string, Pessoa> }) {
  const texto =
    c.tipo === "dm" ? `Esta é a sua conversa com ${nome}. Só vocês dois veem o que é dito aqui.`
    : c.tipo === "grupo" ? "Conversa em grupo. Só quem está nela vê as mensagens."
    : c.tipo === "geral" ? "Canal de toda a equipe. Avisos e recados que valem para todos."
    : c.tipo === "setor" ? `Canal do setor ${c.nome}. Quem entra no setor entra aqui sozinho.`
    : c.descricao || (c.privado ? "Canal privado. Só quem foi adicionado vê." : "Canal aberto. Qualquer colega pode entrar.");
  return (
    <div className="px-4 pb-4 pt-8">
      {c.tipo === "dm" ? (
        <AvatarPessoa userId={c.outros[0] ?? null} pessoa={mapa.get(c.outros[0] ?? "")} tamanho="md" className="mb-3 origin-left scale-150" />
      ) : null}
      <h3 className="text-xl font-bold">{prefixoCanal(c)}{nome}</h3>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}
