// Aba "Grupos de envio" (F3): os grupos salvos do tenant. Um clique marca todo
// mundo do grupo; dá para editar (renomear, tirar gente, juntar a seleção atual)
// e apagar. Grupo automático é um filtro da carteira salvo: quem entra é
// decidido na hora, por fn_bulk_list_resolve.
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CheckCheck, Filter, Loader2, Pencil, Trash2, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatBRPhone } from "@/lib/phoneBR";
import { contarFiltrosAvancados } from "@/lib/filtrosClientes";
import { chaveTelefone } from "./destinosAvulsos";
import { sugerirNomeNaMensagem } from "./nomeNaMensagem";
import type { Destino } from "./useEnvioLote";
import {
  resolverGrupo, useApagarGrupo, useGruposEnvio, useMembrosGrupo, useRemoverMembros, useSalvarGrupo,
  type GrupoEnvio, type MembroGrupo, type MembroParaSalvar,
} from "./useEnvioLoteExtras";

/** Membro do grupo → destinatário da tela. */
export function membroParaDestino(m: MembroGrupo): Destino | null {
  if (m.eh_grupo) {
    if (!m.conversation_id) return null;
    return {
      chave: "conv:" + m.conversation_id,
      tipo: "grupos",
      conversationId: m.conversation_id,
      telefone: null,
      contactId: null,
      nomeContato: m.nome_contato || "Grupo",
      ehGrupo: true,
      nomeSugerido: m.nome_na_mensagem || sugerirNomeNaMensagem({ nomeContato: m.nome_contato, ehGrupo: true }),
      clienteId: null,
      clienteNome: null,
      segmentoId: null,
      clienteCancelado: false,
    };
  }
  if (!m.telefone) return null;
  const nome = m.nome_contato && m.nome_contato !== m.telefone ? m.nome_contato : "";
  return {
    chave: "tel:" + chaveTelefone(m.telefone),
    tipo: m.cliente_id ? "clientes" : "contatos",
    conversationId: null,
    telefone: m.telefone,
    contactId: null,
    nomeContato: nome || "Sem nome",
    ehGrupo: false,
    nomeSugerido: m.nome_na_mensagem || sugerirNomeNaMensagem({ nomeContato: nome, ehGrupo: false }),
    clienteId: m.cliente_id,
    clienteNome: m.cliente_nome,
    segmentoId: null,
    clienteCancelado: false,
    vars: m.vars,
  };
}

/** Destinatário da tela → membro para salvar no grupo. */
export function destinoParaMembro(d: Destino, nomeNaMensagem: string): MembroParaSalvar | null {
  if (d.ehGrupo && d.conversationId) {
    return { conversation_id: d.conversationId, nome_contato: d.nomeContato, nome_na_mensagem: nomeNaMensagem };
  }
  if (!d.telefone) return null;
  return {
    telefone: d.telefone,
    nome_contato: d.nomeContato !== "Sem nome" ? d.nomeContato : undefined,
    nome_na_mensagem: nomeNaMensagem || undefined,
    cliente_id: d.clienteId,
    vars: d.vars ?? null,
  };
}

interface Props {
  instanceId: string | null;
  ehMeta: boolean;
  selecionados: Destino[];
  nomeDe: (d: Destino) => string;
  /** Marca os destinatários do grupo (e lembra de qual grupo vieram). */
  onUsar: (destinos: Destino[], grupo: GrupoEnvio) => void;
}

export function AbaGruposEnvio({ instanceId, ehMeta, selecionados, nomeDe, onUsar }: Props) {
  const { data: grupos = [], isLoading } = useGruposEnvio();
  const [carregando, setCarregando] = useState<string | null>(null);
  const [editando, setEditando] = useState<GrupoEnvio | null>(null);
  const [apagando, setApagando] = useState<GrupoEnvio | null>(null);
  const apagar = useApagarGrupo();

  const usar = async (g: GrupoEnvio) => {
    setCarregando(g.id);
    try {
      const membros = await resolverGrupo(g.id, instanceId);
      let foraDoNumero = 0;
      let gruposWhats = 0;
      const destinos: Destino[] = [];
      for (const m of membros) {
        if (m.eh_grupo && (!m.instancia_ok || ehMeta)) {
          if (ehMeta) gruposWhats++; else foraDoNumero++;
          continue;
        }
        const d = membroParaDestino(m);
        if (d) destinos.push(d);
      }
      onUsar(destinos, g);
      toast.success(`${destinos.length} de "${g.nome}" marcados.`);
      if (foraDoNumero) toast.warning(`${foraDoNumero} grupo(s) do WhatsApp ficaram de fora: só recebem pelo número que está dentro deles.`);
      if (gruposWhats) toast.warning(`${gruposWhats} grupo(s) do WhatsApp ficaram de fora: o número oficial da Meta não envia para grupo.`);
    } catch (e: any) {
      toast.error(e?.message || "Não consegui carregar o grupo.");
    } finally {
      setCarregando(null);
    }
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando grupos...</div>;
  }

  if (grupos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
        <Users className="h-8 w-8 opacity-50" />
        <b className="text-foreground">Nenhum grupo de envio ainda.</b>
        <span className="max-w-md">
          Marque as pessoas nas abas Clientes, Contatos ou Avulso e clique em <b>Salvar como grupo</b>, no rodapé.
          Na aba Clientes, com filtros ligados, dá para salvar um <b>grupo automático</b>, que se atualiza sozinho.
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="divide-y divide-border">
        {grupos.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              {g.tipo === "dinamica" ? <Zap className="h-4 w-4" /> : <Users className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-semibold">{g.nome}</span>
                {g.tipo === "dinamica" ? (
                  <Badge variant="secondary" className="text-[10px]">Automático</Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] tabular-nums">{g.membros} pessoas</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {g.tipo === "dinamica"
                  ? `Clientes que passam em ${contarFiltrosAvancados(g.filtros as any) || 0} filtro(s), conferidos na hora do envio`
                  : g.descricao || "Grupo fixo"}
                {g.last_used_at ? ` · usado em ${format(new Date(g.last_used_at), "dd/MM/yyyy")}` : " · ainda não usado"}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" className="h-8" disabled={carregando === g.id} onClick={() => usar(g)}>
                {carregando === g.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="mr-1 h-3.5 w-3.5" />}
                Marcar
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Ver e editar" onClick={() => setEditando(g)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" title="Apagar grupo" onClick={() => setApagando(g)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {editando && (
        <EditarGrupoDialog
          grupo={editando}
          instanceId={instanceId}
          selecionados={selecionados}
          nomeDe={nomeDe}
          onFechar={() => setEditando(null)}
        />
      )}

      <AlertDialog open={!!apagando} onOpenChange={(v) => !v && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o grupo "{apagando?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Só o grupo some. Os envios já feitos continuam no histórico. Se ele estiver num envio recorrente, apague a recorrência antes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (!apagando) return;
                try { await apagar.mutateAsync(apagando.id); toast.success("Grupo apagado."); }
                catch (e: any) { toast.error(e?.message || "Não consegui apagar."); }
                setApagando(null);
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditarGrupoDialog({ grupo, instanceId, selecionados, nomeDe, onFechar }: {
  grupo: GrupoEnvio;
  instanceId: string | null;
  selecionados: Destino[];
  nomeDe: (d: Destino) => string;
  onFechar: () => void;
}) {
  const { data: membros = [], isLoading } = useMembrosGrupo(grupo.id, instanceId);
  const salvar = useSalvarGrupo();
  const remover = useRemoverMembros();
  const [nome, setNome] = useState(grupo.nome);
  const [descricao, setDescricao] = useState(grupo.descricao || "");
  const [busca, setBusca] = useState("");
  const [tirar, setTirar] = useState<Set<string>>(new Set());
  const fixo = grupo.tipo === "fixa";

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    return membros.filter((m) =>
      !q || (m.nome_contato || "").toLowerCase().includes(q) || (m.cliente_nome || "").toLowerCase().includes(q)
      || (qd.length >= 3 && (m.telefone || "").includes(qd)));
  }, [membros, busca]);

  const novosDaSelecao = useMemo(() => {
    const jaTem = new Set(membros.map((m) => (m.eh_grupo ? "conv:" + m.conversation_id : "tel:" + chaveTelefone(m.telefone || ""))));
    return selecionados.filter((d) => !jaTem.has(d.chave));
  }, [membros, selecionados]);

  const salvarNome = async () => {
    try {
      await salvar.mutateAsync({ id: grupo.id, nome, descricao, tipo: grupo.tipo, filtros: grupo.filtros, membros: null });
      toast.success("Grupo salvo.");
    } catch (e: any) { toast.error(e?.message || "Não consegui salvar."); }
  };

  const adicionarSelecao = async () => {
    const lista = novosDaSelecao.map((d) => destinoParaMembro(d, nomeDe(d))).filter(Boolean) as MembroParaSalvar[];
    try {
      await salvar.mutateAsync({ id: grupo.id, nome, descricao, tipo: "fixa", membros: lista, modo: "adicionar" });
      toast.success(`${lista.length} pessoa(s) entraram no grupo.`);
    } catch (e: any) { toast.error(e?.message || "Não consegui adicionar."); }
  };

  const tirarMarcados = async () => {
    try {
      const n = await remover.mutateAsync({ listId: grupo.id, ids: [...tirar] });
      setTirar(new Set());
      toast.success(`${n} pessoa(s) saíram do grupo.`);
    } catch (e: any) { toast.error(e?.message || "Não consegui tirar."); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{fixo ? "Grupo de envio" : "Grupo automático"}</DialogTitle>
          <DialogDescription>
            {fixo
              ? "Tire quem não deve mais receber ou junte quem está marcado agora na tela de envio."
              : "Quem entra é decidido pelos filtros da carteira na hora de cada envio. Para mudar os filtros, salve um novo grupo pela aba Clientes."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="grupo-nome" className="text-xs">Nome</Label>
            <Input id="grupo-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grupo-desc" className="text-xs">Descrição (opcional)</Label>
            <Input id="grupo-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <Button variant="outline" onClick={salvarNome} disabled={salvar.isPending || !nome.trim()}>Salvar nome</Button>
        </div>

        {fixo && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <span>
              {novosDaSelecao.length > 0
                ? <>Na tela de envio há <b>{novosDaSelecao.length}</b> marcado(s) que ainda não estão neste grupo.</>
                : "Para incluir gente, marque na tela de envio e volte aqui."}
            </span>
            <Button size="sm" disabled={!novosDaSelecao.length || salvar.isPending} onClick={adicionarSelecao}>
              Adicionar {novosDaSelecao.length || ""} ao grupo
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input placeholder="Buscar no grupo" value={busca} onChange={(e) => setBusca(e.target.value)} className="h-9" />
          {fixo && tirar.size > 0 && (
            <Button variant="outline" className="h-9 text-red-600" onClick={tirarMarcados} disabled={remover.isPending}>
              <Trash2 className="mr-1 h-4 w-4" /> Tirar {tirar.size}
            </Button>
          )}
        </div>

        <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
          {isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
          ) : visiveis.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">{membros.length ? "Ninguém com esse nome." : "Grupo vazio."}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  {fixo && <th className="w-10 px-3 py-2" />}
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Telefone</th>
                  <th className="px-3 py-2">Nome na mensagem</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((m, i) => (
                  <tr key={m.member_id || m.telefone || i} className="border-t border-border">
                    {fixo && (
                      <td className="px-3 py-1.5">
                        <Checkbox
                          checked={!!m.member_id && tirar.has(m.member_id)}
                          onCheckedChange={(v) => setTirar((s) => {
                            const n = new Set(s);
                            if (m.member_id) {
                              if (v) n.add(m.member_id); else n.delete(m.member_id);
                            }
                            return n;
                          })}
                          aria-label={`Tirar ${m.nome_contato || m.telefone}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-1.5">
                      {m.cliente_nome || m.nome_contato || "Sem nome"}
                      {m.cliente_nome && m.nome_contato && m.nome_contato !== m.cliente_nome && (
                        <span className="ml-1 text-xs text-muted-foreground">· {m.nome_contato}</span>
                      )}
                      {m.eh_grupo && <Badge variant="secondary" className="ml-1.5 text-[10px]">Grupo do WhatsApp</Badge>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
                      {m.eh_grupo ? "Grupo" : m.telefone?.startsWith("55") ? formatBRPhone(m.telefone) : m.telefone}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{m.nome_na_mensagem || "automático"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{membros.length} no grupo{!fixo && <> · <Filter className="inline h-3 w-3" /> atualiza sozinho</>}</p>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Salvar a seleção atual (ou o filtro da carteira) como grupo de envio. */
export function SalvarGrupoDialog({ aberto, onFechar, selecionados, nomeDe, filtros, onSalvo }: {
  aberto: boolean;
  onFechar: () => void;
  selecionados: Destino[];
  nomeDe: (d: Destino) => string;
  /** Presente = salvar como grupo automático com estes filtros. */
  filtros?: any | null;
  onSalvo?: (id: string, nome: string) => void;
}) {
  const { data: grupos = [] } = useGruposEnvio();
  const salvar = useSalvarGrupo();
  const [modo, setModo] = useState<"novo" | "existente">("novo");
  const [nome, setNome] = useState("");
  const [existente, setExistente] = useState("");
  const automatico = !!filtros;
  const fixos = grupos.filter((g) => g.tipo === "fixa");

  const confirmar = async () => {
    try {
      let id: string;
      let nomeFinal = nome.trim();
      if (automatico) {
        id = await salvar.mutateAsync({ nome: nomeFinal, tipo: "dinamica", filtros });
      } else {
        const membros = selecionados.map((d) => destinoParaMembro(d, nomeDe(d))).filter(Boolean) as MembroParaSalvar[];
        if (modo === "existente") {
          const g = fixos.find((x) => x.id === existente)!;
          nomeFinal = g.nome;
          id = await salvar.mutateAsync({ id: g.id, nome: g.nome, descricao: g.descricao, tipo: "fixa", membros, modo: "adicionar" });
        } else {
          id = await salvar.mutateAsync({ nome: nomeFinal, tipo: "fixa", membros });
        }
      }
      toast.success(automatico ? `Grupo automático "${nomeFinal}" salvo.` : `Grupo "${nomeFinal}" salvo com a seleção.`);
      onSalvo?.(id, nomeFinal);
      onFechar();
      setNome("");
    } catch (e: any) {
      toast.error(e?.message || "Não consegui salvar o grupo.");
    }
  };

  const valido = automatico ? !!nome.trim() : modo === "novo" ? !!nome.trim() && selecionados.length > 0 : !!existente && selecionados.length > 0;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{automatico ? "Salvar grupo automático" : "Salvar como grupo de envio"}</DialogTitle>
          <DialogDescription>
            {automatico
              ? "Guarda os filtros da aba Clientes. Em cada envio, entra quem passar nos filtros naquele dia: cliente novo entra, cancelado sai."
              : `Guarda os ${selecionados.length} marcados para usar de novo sem escolher um a um. Grupos do WhatsApp continuam presos ao número deles.`}
          </DialogDescription>
        </DialogHeader>
        {!automatico && fixos.length > 0 && (
          <div className="inline-flex rounded-lg bg-muted p-1 text-xs font-semibold">
            <button type="button" className={`rounded-md px-3 py-1.5 ${modo === "novo" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setModo("novo")}>Grupo novo</button>
            <button type="button" className={`rounded-md px-3 py-1.5 ${modo === "existente" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setModo("existente")}>Juntar a um grupo</button>
          </div>
        )}
        {modo === "novo" || automatico ? (
          <div className="space-y-1.5">
            <Label htmlFor="novo-grupo-nome" className="text-xs">Nome do grupo</Label>
            <Input id="novo-grupo-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder={automatico ? "Ex.: Supermercados ativos" : "Ex.: Clientes do contador Marcos"} autoFocus />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="grupo-existente" className="text-xs">Grupo</Label>
            <select id="grupo-existente" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={existente} onChange={(e) => setExistente(e.target.value)}>
              <option value="">Escolha...</option>
              {fixos.map((g) => <option key={g.id} value={g.id}>{g.nome} ({g.membros})</option>)}
            </select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!valido || salvar.isPending}>
            {salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
