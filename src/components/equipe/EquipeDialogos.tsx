import { useEffect, useMemo, useState } from "react";
import { Check, Hash, Lock, Search, Users, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AvatarPessoa } from "./AvatarPessoa";
import { presencaDe } from "./equipeUtils";
import { mensagemDeErro, useCanaisAbertos, useEquipeAcoes, useMembrosDoCanal } from "./useEquipe";
import type { Conversa, Pessoa } from "./tipos";

// ----------------------------------------------------------- seletor de pessoas

function SeletorPessoas({
  pessoas, eu, selecionadas, onAlternar, excluir = [], max,
}: {
  pessoas: Pessoa[]; eu: string; selecionadas: string[]; onAlternar: (id: string) => void;
  excluir?: string[]; max?: number;
}) {
  const [busca, setBusca] = useState("");
  const lista = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase("pt-BR");
    return pessoas
      .filter((p) => p.user_id !== eu && !excluir.includes(p.user_id))
      .filter((p) => !t || `${p.nome} ${p.setor ?? ""} ${p.cargo ?? ""}`.toLocaleLowerCase("pt-BR").includes(t));
  }, [pessoas, eu, excluir, busca]);
  const cheio = max !== undefined && selecionadas.length >= max;

  return (
    <div className="space-y-2">
      {selecionadas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selecionadas.map((id) => {
            const p = pessoas.find((x) => x.user_id === id);
            return (
              <button key={id} type="button" onClick={() => onAlternar(id)}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 py-0.5 pl-0.5 pr-2 text-xs font-medium hover:bg-muted">
                <AvatarPessoa userId={id} pessoa={p} tamanho="xs" />
                {p?.nome.split(" ")[0] ?? "Colega"}
                <X className="h-3 w-3 opacity-60" />
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-md border px-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          id="equipe-busca-pessoa"
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, setor ou cargo"
          autoComplete="off"
          className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <ul className="max-h-72 overflow-y-auto rounded-md border">
        {lista.map((p) => {
          const sel = selecionadas.includes(p.user_id);
          const bloqueado = !sel && cheio;
          return (
            <li key={p.user_id}>
              <button type="button" disabled={bloqueado} onClick={() => onAlternar(p.user_id)}
                className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted disabled:opacity-40", sel && "bg-sky-500/10")}>
                <AvatarPessoa userId={p.user_id} pessoa={p} tamanho="sm" comPresenca />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[p.setor, presencaDe(p).texto].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={cn("grid h-5 w-5 place-items-center rounded border", sel && "border-sky-500 bg-sky-500 text-white")}>
                  {sel && <Check className="h-3.5 w-3.5" />}
                </span>
              </button>
            </li>
          );
        })}
        {lista.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Ninguém encontrado.</li>}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------- nova conversa

export function NovaConversaDialog({ aberto, onFechar, pessoas, eu, onAbriu }: {
  aberto: boolean; onFechar: () => void; pessoas: Pessoa[]; eu: string; onAbriu: (id: string) => void;
}) {
  const acoes = useEquipeAcoes();
  const [sel, setSel] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) setSel([]); }, [aberto]);

  const abrir = async () => {
    setSalvando(true);
    try {
      const id = await acoes.abrirDm(sel);
      onAbriu(id);
      onFechar();
    } catch (e) { toast.error(mensagemDeErro(e)); } finally { setSalvando(false); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>Uma pessoa abre conversa direta. Duas ou mais, um grupo (até 8 colegas).</DialogDescription>
        </DialogHeader>
        <SeletorPessoas pessoas={pessoas} eu={eu} selecionadas={sel} max={8}
          onAlternar={(id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={abrir} disabled={sel.length === 0 || salvando}>
            {sel.length > 1 ? "Abrir grupo" : "Abrir conversa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- novo canal

export function NovoCanalDialog({ aberto, onFechar, pessoas, eu, onCriou }: {
  aberto: boolean; onFechar: () => void; pessoas: Pessoa[]; eu: string; onCriou: (id: string) => void;
}) {
  const acoes = useEquipeAcoes();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [privado, setPrivado] = useState(false);
  const [membros, setMembros] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setNome(""); setDescricao(""); setPrivado(false); setMembros([]); } }, [aberto]);

  const nomeFinal = nome.trim().toLocaleLowerCase("pt-BR").replace(/^#+/, "").replace(/\s+/g, "-");

  const criar = async () => {
    setSalvando(true);
    try {
      const id = await acoes.criarCanal({ nome: nomeFinal, descricao, privado, membros });
      toast.success(`#${nomeFinal} criado`);
      onCriou(id);
      onFechar();
    } catch (e) { toast.error(mensagemDeErro(e)); } finally { setSalvando(false); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar canal</DialogTitle>
          <DialogDescription>Para um assunto ou time. Canais de setor e o #geral já existem sozinhos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="equipe-canal-nome">Nome</Label>
            <div className="flex items-center rounded-md border px-2 focus-within:ring-2 focus-within:ring-ring">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <input id="equipe-canal-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60}
                placeholder="casos-criticos" autoComplete="off" className="h-9 w-full bg-transparent px-1 text-sm outline-none" />
            </div>
            {nome && nomeFinal !== nome.trim() && <p className="text-xs text-muted-foreground">Vai ficar #{nomeFinal}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="equipe-canal-desc">Sobre o que é <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Textarea id="equipe-canal-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} maxLength={250} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="equipe-canal-privado" className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" />Canal privado</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {privado ? "Só quem você adicionar vê e participa." : "Qualquer colega encontra em Procurar canais e entra."}
              </p>
            </div>
            <Switch id="equipe-canal-privado" checked={privado} onCheckedChange={setPrivado} />
          </div>
          <div className="space-y-1.5">
            <Label>Quem entra agora</Label>
            <SeletorPessoas pessoas={pessoas} eu={eu} selecionadas={membros}
              onAlternar={(id) => setMembros((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={criar} disabled={!nomeFinal || salvando}>Criar canal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------- procurar canais

export function ProcurarCanaisDialog({ aberto, onFechar, conversas, onAbrir }: {
  aberto: boolean; onFechar: () => void; conversas: Conversa[]; onAbrir: (id: string) => void;
}) {
  const acoes = useEquipeAcoes();
  const { data = [], isLoading } = useCanaisAbertos(aberto);
  const [busca, setBusca] = useState("");
  const minhas = new Set(conversas.map((c) => c.id));
  const lista = data.filter((c) => !busca || c.nome.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR")));

  const entrar = async (id: string) => {
    try { await acoes.entrar(id); onAbrir(id); onFechar(); } catch (e) { toast.error(mensagemDeErro(e)); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Procurar canais</DialogTitle>
          <DialogDescription>Canais abertos da equipe. Canais privados só aparecem para quem foi adicionado.</DialogDescription>
        </DialogHeader>
        <Input id="equipe-busca-canal" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar canal" autoComplete="off" />
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {isLoading && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando</li>}
          {!isLoading && lista.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum canal encontrado.</li>}
          {lista.map((c) => {
            const dentro = minhas.has(c.id);
            const Icone = c.tipo === "setor" ? Users : c.privado ? Lock : Hash;
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.nome}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.tipo === "setor" ? "Canal do setor" : c.descricao || (c.privado ? "Privado" : "Aberto")}</div>
                </div>
                {dentro ? (
                  <Button size="sm" variant="ghost" onClick={() => { onAbrir(c.id); onFechar(); }}>Abrir</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => entrar(c.id)}>Entrar</Button>
                )}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------- adicionar pessoas

export function AdicionarPessoasDialog({ aberto, onFechar, canal, pessoas, eu }: {
  aberto: boolean; onFechar: () => void; canal: Conversa | null; pessoas: Pessoa[]; eu: string;
}) {
  const acoes = useEquipeAcoes();
  const { data: membros = [] } = useMembrosDoCanal(canal?.id ?? null, aberto);
  const [sel, setSel] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) setSel([]); }, [aberto]);

  const salvar = async () => {
    if (!canal) return;
    setSalvando(true);
    try {
      await acoes.adicionarMembros(canal.id, sel);
      toast.success(sel.length === 1 ? "Pessoa adicionada" : `${sel.length} pessoas adicionadas`);
      onFechar();
    } catch (e) { toast.error(mensagemDeErro(e)); } finally { setSalvando(false); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar a #{canal?.nome}</DialogTitle>
          <DialogDescription>{membros.length} {membros.length === 1 ? "pessoa já está" : "pessoas já estão"} no canal.</DialogDescription>
        </DialogHeader>
        <SeletorPessoas pessoas={pessoas} eu={eu} selecionadas={sel} excluir={membros}
          onAlternar={(id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={sel.length === 0 || salvando}>Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
