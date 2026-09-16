import { useState } from "react";
import { Check, Folder, FolderPlus, Loader2, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  CORES_PASTA,
  COR_PADRAO,
  useExcluirPasta,
  useMeusSetores,
  usePastasEmail,
  useSalvarPasta,
  type PastaEmail,
} from "./usePastasEmail";

/**
 * Menu de pastas das telas E-mails: filtra a lista por pasta, cria, renomeia e
 * apaga. Pasta de setor todo o setor usa; pessoal só quem criou vê.
 *
 * Apagar a pasta NÃO apaga e-mail: eles voltam para "sem pasta".
 */
export function MenuPastas({
  pastaAtual,
  onEscolher,
}: {
  pastaAtual: string | null;
  onEscolher: (pastaId: string | null) => void;
}) {
  const { data: pastas = [], isLoading } = usePastasEmail();
  const [editando, setEditando] = useState<PastaEmail | "nova" | null>(null);
  const escolhida = pastas.find((p) => p.id === pastaAtual) ?? null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={pastaAtual ? "default" : "outline"} size="sm" className="h-9">
            {escolhida ? (
              <span className="mr-2 h-2.5 w-2.5 rounded-sm" style={{ background: escolhida.cor }} aria-hidden />
            ) : (
              <Folder className="mr-2 h-4 w-4" />
            )}
            {escolhida ? escolhida.nome : "Pastas"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Filtrar por pasta</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onEscolher(null)}>
            <Check className={cn("mr-2 h-3.5 w-3.5", pastaAtual === null ? "opacity-100" : "opacity-0")} />
            Todas
          </DropdownMenuItem>

          {isLoading && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando...
            </div>
          )}
          {!isLoading && pastas.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma pasta criada ainda.</p>
          )}

          {pastas.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => onEscolher(p.id)} className="gap-2">
              <Check className={cn("h-3.5 w-3.5 shrink-0", pastaAtual === p.id ? "opacity-100" : "opacity-0")} />
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.cor }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{p.nome}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {p.escopo === "setor" ? p.support_departments?.name ?? "setor" : "minha"}
              </span>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditando(p);
                }}
                aria-label={`Editar ${p.nome}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditando("nova")} className="text-primary">
            <FolderPlus className="mr-2 h-4 w-4" />
            Criar pasta
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PastaDialog
        alvo={editando}
        onOpenChange={(aberto) => !aberto && setEditando(null)}
        onApagou={(id) => {
          if (pastaAtual === id) onEscolher(null);
        }}
      />
    </>
  );
}

/** criar e editar pasta; apagar fica aqui porque é a mesma tela do Gmail */
function PastaDialog({
  alvo,
  onOpenChange,
  onApagou,
}: {
  alvo: PastaEmail | "nova" | null;
  onOpenChange: (aberto: boolean) => void;
  onApagou: (id: string) => void;
}) {
  const nova = alvo === "nova";
  const pasta = nova ? null : alvo;
  const { data: setores = [] } = useMeusSetores();
  const salvar = useSalvarPasta();
  const excluir = useExcluirPasta();

  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(COR_PADRAO);
  const [escopo, setEscopo] = useState<"setor" | "pessoal">("pessoal");
  const [setorId, setSetorId] = useState<string>("");
  const [chave, setChave] = useState<string | null>(null);

  // abre com os dados da pasta escolhida, uma vez por abertura
  const chaveAtual = alvo === null ? null : nova ? "nova" : pasta!.id;
  if (chaveAtual !== chave) {
    setChave(chaveAtual);
    setNome(pasta?.nome ?? "");
    setCor(pasta?.cor ?? COR_PADRAO);
    setEscopo(pasta?.escopo ?? "pessoal");
    setSetorId(pasta?.department_id ?? "");
  }

  const gravar = () => {
    if (!nome.trim()) {
      toast.error("Dê um nome para a pasta.");
      return;
    }
    if (escopo === "setor" && !setorId) {
      toast.error("Escolha o setor da pasta.");
      return;
    }
    salvar.mutate(
      { nome: nome.trim(), cor, escopo, departmentId: escopo === "setor" ? setorId : null, id: pasta?.id ?? null },
      {
        onSuccess: () => {
          toast.success(pasta ? "Pasta atualizada." : "Pasta criada.");
          onOpenChange(false);
        },
        onError: (err: any) => toast.error(err?.message || "Não foi possível salvar a pasta."),
      },
    );
  };

  const apagar = () => {
    if (!pasta) return;
    excluir.mutate(pasta.id, {
      onSuccess: () => {
        toast.success("Pasta apagada. Os e-mails dela voltaram para a lista, sem pasta.");
        onApagou(pasta.id);
        onOpenChange(false);
      },
      onError: (err: any) => toast.error(err?.message || "Não foi possível apagar a pasta."),
    });
  };

  return (
    <Dialog open={!!alvo} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pasta ? "Editar pasta" : "Criar pasta"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pasta-nome">Nome</Label>
            <Input
              id="pasta-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={40}
              placeholder="Ex.: Integrações"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  gravar();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {CORES_PASTA.map((c) => (
                <button
                  key={c.valor}
                  type="button"
                  onClick={() => setCor(c.valor)}
                  aria-label={c.nome}
                  aria-pressed={cor === c.valor}
                  className={cn(
                    "h-6 w-6 rounded-md border border-border",
                    cor === c.valor && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                  )}
                  style={{ background: c.valor }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pasta-escopo">Quem enxerga</Label>
            {pasta ? (
              <p className="text-sm text-muted-foreground">
                {pasta.escopo === "setor"
                  ? `Setor ${pasta.support_departments?.name ?? ""}`.trim()
                  : "Só você"}{" "}
                <span className="text-xs">(não muda depois de criada)</span>
              </p>
            ) : (
              <Select value={escopo} onValueChange={(v) => setEscopo(v as "setor" | "pessoal")}>
                <SelectTrigger id="pasta-escopo" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pessoal">Só você</SelectItem>
                  <SelectItem value="setor">Todo o setor</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {!pasta && escopo === "setor" && (
            <div className="space-y-1.5">
              <Label htmlFor="pasta-setor">Setor</Label>
              <Select value={setorId} onValueChange={setSetorId}>
                <SelectTrigger id="pasta-setor" className="h-9">
                  <SelectValue placeholder={setores.length ? "Escolha o setor" : "Você não está em nenhum setor"} />
                </SelectTrigger>
                <SelectContent>
                  {setores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {pasta ? (
            <Button variant="outline" onClick={apagar} disabled={excluir.isPending} className="text-destructive">
              {excluir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Apagar pasta
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="mr-2 h-4 w-4" />
              Cancelar
            </Button>
            <Button onClick={gravar} disabled={salvar.isPending}>
              {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pasta ? "Salvar" : "Criar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Mover para": usado na linha, na seleção em lote e no e-mail aberto */
export function MoverParaPasta({
  pastaAtual,
  onMover,
  desabilitado,
  children,
}: {
  pastaAtual: string | null;
  onMover: (pastaId: string | null) => void;
  desabilitado?: boolean;
  children: React.ReactNode;
}) {
  const { data: pastas = [] } = usePastasEmail();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={desabilitado}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Mover para</DropdownMenuLabel>
        {pastas.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Nenhuma pasta ainda. Crie pelo botão Pastas, na barra de cima.
          </p>
        )}
        {pastas.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => onMover(p.id)} className="gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.cor }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{p.nome}</span>
            {pastaAtual === p.id && <Check className="h-3.5 w-3.5 shrink-0" />}
          </DropdownMenuItem>
        ))}
        {pastaAtual && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onMover(null)}>
              <X className="mr-2 h-3.5 w-3.5" />
              Tirar da pasta
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
