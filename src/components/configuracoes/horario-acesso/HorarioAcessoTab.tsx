import { useMemo, useState } from "react";
import { Clock, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { FUSOS_BR, formatarHora, formatarProximoAcesso, resumirIntervalos } from "@/lib/accessWindow";
import { RegraAcessoForm } from "./RegraAcessoForm";
import { useHorarioAcesso, type AccessSchedule, type PessoaAcesso } from "./useHorarioAcesso";

const ORIGEM: Record<PessoaAcesso["origin"], { label: string; cls: string }> = {
  department: { label: "Do setor", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  user: { label: "Individual", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  exempt: { label: "Admin, sempre livre", cls: "bg-muted text-muted-foreground" },
  none: { label: "Sem regra", cls: "bg-muted text-muted-foreground" },
};

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

export default function HorarioAcessoTab() {
  const { profile } = useAuth();
  const podeEditar = profile?.role === "admin" || profile?.is_super_admin === true;
  const { tid, regras, alvos, setores, pessoas, carregando, salvar, ligar, excluir } = useHorarioAcesso();

  const [editando, setEditando] = useState<AccessSchedule | "nova" | null>(null);
  const [paraExcluir, setParaExcluir] = useState<AccessSchedule | null>(null);
  const [busca, setBusca] = useState("");

  const nomeSetor = useMemo(() => new Map(setores.map((s) => [s.id, s.name])), [setores]);
  const nomePessoa = useMemo(() => new Map(pessoas.map((p) => [p.user_id, p.nome])), [pessoas]);
  const fusoDaRegra = useMemo(() => new Map(regras.map((r) => [r.id, r.timezone])), [regras]);

  const contagem = useMemo(() => {
    const ativos = pessoas.length;
    const setor = pessoas.filter((p) => p.origin === "department").length;
    const individual = pessoas.filter((p) => p.origin === "user").length;
    const fora = pessoas.filter((p) => p.schedule_id && p.allowed === false).length;
    const setoresComRegra = new Set(pessoas.filter((p) => p.origin === "department").map((p) => p.department_id)).size;
    return { ativos, setor, individual, restritos: setor + individual, fora, setoresComRegra };
  }, [pessoas]);

  const pessoasVisiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = q
      ? pessoas.filter((p) => `${p.nome} ${p.department_name ?? ""} ${p.schedule_name ?? ""}`.toLowerCase().includes(q))
      : pessoas;
    // Restritos primeiro: é o que o admin veio conferir.
    const peso = (p: PessoaAcesso) => (p.origin === "user" || p.origin === "department" ? 0 : 1);
    return [...lista].sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome, "pt-BR"));
  }, [pessoas, busca]);

  if (!tid) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Escolha uma empresa no seletor do topo para ver os horários de acesso.
      </div>
    );
  }

  if (carregando) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (editando) {
    return (
      <RegraAcessoForm
        regra={editando === "nova" ? null : editando}
        regras={regras}
        alvos={alvos}
        setores={setores}
        pessoas={pessoas}
        salvando={salvar.isPending}
        onVoltar={() => setEditando(null)}
        onSalvar={(r) => salvar.mutate(r, { onSuccess: () => setEditando(null) })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Defina em que horários cada setor ou pessoa pode usar o DoctorSaaS. Fora do horário o login é recusado e quem
          estiver conectado recebe um aviso antes de ser desconectado. Quem não tem regra acessa a qualquer hora.
        </p>
        {podeEditar && (
          <Button onClick={() => setEditando("nova")} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            Nova regra
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Com restrição" valor={contagem.restritos} rodape={`de ${contagem.ativos} usuários ativos`} />
        <Indicador
          titulo="Pela regra do setor"
          valor={contagem.setor}
          rodape={`${contagem.setoresComRegra} ${contagem.setoresComRegra === 1 ? "setor" : "setores"}`}
        />
        <Indicador titulo="Regra individual" valor={contagem.individual} rodape="vence a regra do setor" />
        <Indicador
          titulo="Fora do horário agora"
          valor={contagem.fora}
          rodape="não conseguem entrar"
          destaque={contagem.fora > 0}
        />
      </div>

      <section className="rounded-lg border bg-card">
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="font-semibold">Regras</h3>
        </header>
        {regras.length === 0 ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Clock className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">Nenhuma regra criada</p>
              <p className="text-sm text-muted-foreground">
                Hoje todo mundo acessa a qualquer hora. Crie uma regra para um setor inteiro ou para pessoas específicas.
              </p>
            </div>
            {podeEditar && (
              <Button onClick={() => setEditando("nova")}>
                <Plus className="mr-2 h-4 w-4" />
                Criar primeira regra
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Regra</th>
                  <th className="px-4 py-2 text-left font-medium">Aplicada a</th>
                  <th className="px-4 py-2 text-left font-medium">Horários</th>
                  <th className="px-4 py-2 text-left font-medium">Pessoas</th>
                  <th className="px-4 py-2 text-left font-medium">Ativa</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {regras.map((r) => {
                  const meus = alvos.filter((a) => a.schedule_id === r.id);
                  const qtd = pessoas.filter((p) => p.schedule_id === r.id).length;
                  return (
                    <tr key={r.id} className={cn("border-b last:border-0", !r.is_active && "opacity-60")}>
                      <td className="px-4 py-3 align-top">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(FUSOS_BR.find((f) => f.value === r.timezone)?.label ?? r.timezone).replace(/ \(UTC.*\)$/, "")}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {meus.map((a) =>
                            a.department_id ? (
                              <span key={a.id} className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-700 dark:text-sky-300">
                                Setor · {nomeSetor.get(a.department_id) ?? "inativo"}
                              </span>
                            ) : (
                              <span key={a.id} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                {nomePessoa.get(a.user_id!) ?? "Usuário inativo"}
                              </span>
                            ),
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top text-xs tabular-nums text-muted-foreground">
                        {resumirIntervalos(r.intervals).map((l) => (
                          <div key={l}>{l}</div>
                        ))}
                      </td>
                      <td className="px-4 py-3 align-top tabular-nums">{qtd}</td>
                      <td className="px-4 py-3 align-top">
                        <Switch
                          checked={r.is_active}
                          disabled={!podeEditar || ligar.isPending}
                          aria-label={r.is_active ? `Desligar ${r.name}` : `Ligar ${r.name}`}
                          onCheckedChange={(v) => ligar.mutate({ id: r.id, ativa: v })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        {podeEditar && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setEditando(r)}>
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />
                              Editar
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Excluir ${r.name}`}
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setParaExcluir(r)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="font-semibold">Quem está restrito</h3>
            <p className="text-xs text-muted-foreground">A regra que vale para cada pessoa, e de onde ela vem.</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="ha-busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pessoa ou setor"
              className="pl-8"
            />
          </div>
        </header>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Pessoa</th>
                <th className="px-4 py-2 text-left font-medium">Setor</th>
                <th className="px-4 py-2 text-left font-medium">Regra que vale</th>
                <th className="px-4 py-2 text-left font-medium">Origem</th>
                <th className="px-4 py-2 text-left font-medium">Agora</th>
              </tr>
            </thead>
            <tbody>
              {pessoasVisiveis.map((p) => {
                const tz = (p.schedule_id && fusoDaRegra.get(p.schedule_id)) || "America/Sao_Paulo";
                return (
                  <tr key={p.user_id} className="border-b last:border-0">
                    <td className="px-4 py-2.5">{p.nome}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.department_name ?? "Sem setor"}</td>
                    <td className="px-4 py-2.5">{p.schedule_name ?? <span className="text-muted-foreground">Nenhuma</span>}</td>
                    <td className="px-4 py-2.5">
                      <Pill className={ORIGEM[p.origin].cls}>{ORIGEM[p.origin].label}</Pill>
                      {p.origin === "user" && p.department_name && alvos.some((a) => a.department_id === p.department_id) && (
                        <span className="ml-1.5 text-xs text-muted-foreground">sobrepõe {p.department_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {!p.schedule_id ? (
                        <Pill className="bg-muted text-muted-foreground">Sem restrição</Pill>
                      ) : p.allowed ? (
                        <Pill className="bg-primary/15 text-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          Dentro{p.ends_at ? ` · até ${formatarHora(p.ends_at, tz)}` : ""}
                        </Pill>
                      ) : (
                        <Pill className="bg-destructive/15 text-destructive">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          Fora{p.next_start_at ? ` · volta ${formatarProximoAcesso(p.next_start_at, tz)}` : ""}
                        </Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pessoasVisiveis.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Ninguém encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AlertDialog open={!!paraExcluir} onOpenChange={(o) => !o && setParaExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a regra "{paraExcluir?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Quem estava nela passa a seguir a regra do próprio setor, se houver, ou a acessar a qualquer hora. Para
              suspender sem perder a configuração, desligue a regra em vez de excluir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => paraExcluir && excluir.mutate(paraExcluir.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Indicador({ titulo, valor, rodape, destaque }: { titulo: string; valor: number; rodape: string; destaque?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={cn("text-2xl font-semibold tabular-nums", destaque && "text-amber-600 dark:text-amber-400")}>{valor}</p>
      <p className="text-xs text-muted-foreground">{rodape}</p>
    </div>
  );
}
