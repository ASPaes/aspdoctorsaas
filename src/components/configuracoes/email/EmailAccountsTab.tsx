import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CheckCircle2, Info, Loader2, Mail, MoreVertical, Pencil, Plug, Plus, Star, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { providerByValue } from "./emailProviders";
import { EmailAccountDialog } from "./EmailAccountDialog";
import { useEmailAccounts, type EmailAccount } from "./useEmailAccounts";

/** o técnico do erro fica entre colchetes no fim; a tela só mostra a frase */
const motivoDoErro = (erro: string | null) => (erro ?? "").split(" [")[0];

/** selo de teste: nunca testada, testada quando, ou falhou */
function SeloTeste({ conta, testando }: { conta: EmailAccount; testando: boolean }) {
  if (testando) {
    return (
      <Badge variant="outline" className="gap-1 font-normal">
        <Loader2 className="h-3 w-3 animate-spin" />
        Testando
      </Badge>
    );
  }
  if (!conta.last_test_at) {
    return <Badge variant="outline" className="font-normal text-muted-foreground">Nunca testada</Badge>;
  }
  const quando = formatDistanceToNow(new Date(conta.last_test_at), { addSuffix: true, locale: ptBR });
  const titulo = new Date(conta.last_test_at).toLocaleString("pt-BR");
  return conta.last_test_ok ? (
    <Badge title={titulo} className="gap-1 bg-success/15 font-normal text-success hover:bg-success/15">
      <CheckCircle2 className="h-3 w-3" />
      Testada {quando}
    </Badge>
  ) : (
    <Badge title={titulo} variant="destructive" className="gap-1 font-normal">
      <XCircle className="h-3 w-3" />
      Teste falhou {quando}
    </Badge>
  );
}

export default function EmailAccountsTab() {
  const { accounts, isLoading, setores, saveAccount, deleteAccount, updateFlags, testAccount } = useEmailAccounts();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<EmailAccount | null>(null);
  const [excluindo, setExcluindo] = useState<EmailAccount | null>(null);
  const [testandoId, setTestandoId] = useState<string | null>(null);

  const setorPorId = useMemo(
    () => new Map(setores.map((s) => [s.id, s.name])),
    [setores],
  );

  const abrirNova = () => {
    setEditando(null);
    setDialogOpen(true);
  };

  const abrirEdicao = (conta: EmailAccount) => {
    setEditando(conta);
    setDialogOpen(true);
  };

  const alternarAtivo = (conta: EmailAccount, ativo: boolean) => {
    updateFlags.mutate(
      { id: conta.id, ativo },
      {
        onSuccess: () => toast.success(ativo ? "Conta ativada." : "Conta desativada."),
        onError: (err: any) => toast.error(err?.message || "Não foi possível alterar a conta."),
      },
    );
  };

  const definirPadrao = (conta: EmailAccount) => {
    updateFlags.mutate(
      { id: conta.id, is_default: true, ativo: true },
      {
        onSuccess: () => toast.success(`${conta.rotulo} agora é a conta padrão de envio.`),
        onError: (err: any) => toast.error(err?.message || "Não foi possível definir a conta padrão."),
      },
    );
  };

  const testar = (conta: EmailAccount) => {
    setTestandoId(conta.id);
    testAccount.mutate(conta.id, {
      onSuccess: (r) => {
        if (r.ok) toast.success(r.mensagem);
        else toast.error(r.mensagem, { duration: 10000 });
      },
      onError: (err: any) => toast.error(err?.message || "Não foi possível testar a conta."),
      onSettled: () => setTestandoId(null),
    });
  };

  const confirmarExclusao = () => {
    if (!excluindo) return;
    deleteAccount.mutate(excluindo.id, {
      onSuccess: () => {
        toast.success("Conta excluída.");
        setExcluindo(null);
      },
      onError: (err: any) => toast.error(err?.message || "Não foi possível excluir a conta."),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={abrirNova}>
          <Plus className="mr-2 h-4 w-4" />
          Nova conta de e-mail
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-muted">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Nenhuma conta de e-mail cadastrada</p>
            <p className="text-sm text-muted-foreground">
              Cadastre as contas que a operação usa, como suporte, financeiro e onboarding.
            </p>
          </div>
          <Button variant="outline" onClick={abrirNova}>
            <Plus className="mr-2 h-4 w-4" />
            Cadastrar a primeira conta
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {accounts.map((conta) => {
            const provedor = providerByValue(conta.provider);
            const setorNome = conta.setor_id ? setorPorId.get(conta.setor_id) : null;
            return (
              <article
                key={conta.id}
                className={cn(
                  "flex flex-col gap-4 rounded-lg border bg-card p-4 lg:grid lg:grid-cols-[38px_minmax(0,1.15fr)_minmax(0,1.5fr)_auto] lg:items-center",
                  !conta.ativo && "opacity-60",
                )}
              >
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-[15px] font-bold text-white"
                  style={{ backgroundColor: provedor.color }}
                  title={provedor.label}
                >
                  {provedor.initial}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm font-semibold">{conta.rotulo}</strong>
                    {conta.is_default && (
                      <Badge className="gap-1 bg-primary/15 text-primary hover:bg-primary/15">
                        <Star className="h-3 w-3" />
                        Padrão de envio
                      </Badge>
                    )}
                    {setorNome && <Badge variant="secondary">{setorNome}</Badge>}
                    {!conta.ativo && <Badge variant="outline">Inativa</Badge>}
                    <SeloTeste conta={conta} testando={testandoId === conta.id} />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{conta.email}</p>
                  {conta.last_test_ok === false && conta.last_test_error && (
                    <p className="mt-1 text-xs text-destructive">{motivoDoErro(conta.last_test_error)}</p>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-x-5 gap-y-1 sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Provedor</dt>
                    <dd className="truncate font-mono text-[11.5px]">{provedor.label}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Envio</dt>
                    <dd className="truncate font-mono text-[11.5px] tabular-nums">
                      {conta.smtp_host}:{conta.smtp_port}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Recebimento</dt>
                    <dd className="truncate font-mono text-[11.5px] tabular-nums">
                      {conta.imap_host ? `${conta.imap_host}:${conta.imap_port}` : "não configurado"}
                    </dd>
                  </div>
                </dl>

                <div className="flex items-center gap-1.5 lg:justify-self-end">
                  <Switch
                    checked={conta.ativo}
                    onCheckedChange={(v) => alternarAtivo(conta, v)}
                    aria-label={conta.ativo ? "Desativar conta" : "Ativar conta"}
                  />
                  <Button variant="ghost" size="icon" onClick={() => abrirEdicao(conta)} aria-label="Editar conta">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Mais ações">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => abrirEdicao(conta)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={testandoId === conta.id} onClick={() => testar(conta)}>
                        <Plug className="mr-2 h-4 w-4" />
                        Testar conexão
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={conta.is_default} onClick={() => definirPadrao(conta)}>
                        <Star className="mr-2 h-4 w-4" />
                        Definir como padrão
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setExcluindo(conta)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-md border border-l-[3px] border-l-accent bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <span>
          A senha fica guardada no cofre do Supabase e nunca aparece de volta na tela. Para trocar, basta digitar a nova
          senha ao editar a conta.
        </span>
      </div>

      <EmailAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={editando}
        setores={setores}
        onSave={(input) => saveAccount.mutateAsync(input)}
        onTest={(id) => {
          const conta = accounts.find((c) => c.id === id);
          testar(conta ?? ({ id } as EmailAccount));
        }}
        saving={saveAccount.isPending}
      />

      <AlertDialog open={!!excluindo} onOpenChange={(open) => !open && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {excluindo?.rotulo}?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta {excluindo?.email} sai da lista e a senha é apagada do cofre. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmarExclusao}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
