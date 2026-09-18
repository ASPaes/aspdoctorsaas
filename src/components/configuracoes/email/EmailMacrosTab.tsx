import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Paperclip, Pencil, Plus, Search, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { mensagemDaMacro, useEmailMacros, useSalvarMacro, type EmailMacro } from "@/components/emails/macros/useEmailMacros";
import { normalizarCampo } from "@/components/emails/macros/camposMacro";

const MacroEmailDialog = lazy(() => import("@/components/emails/macros/MacroEmailDialog"));

/**
 * Configurações › Atendimento › Canais › E-mail › Macros (mockup aprovado em
 * 17/09/2026). Cadastro só admin e gestor, igual às outras abas de e-mail; o
 * uso fica no botão Macros da tela Enviar e-mail.
 */
export default function EmailMacrosTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const macros = useEmailMacros(tid);
  const { alternarAtiva, apagar } = useSalvarMacro();
  const setores = useQuery({
    queryKey: ["email-macro-setores", tid],
    enabled: !!tid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const [busca, setBusca] = useState("");
  const [setorFiltro, setSetorFiltro] = useState("todos");
  const [editando, setEditando] = useState<{ macro: EmailMacro | null; inicial?: { titulo: string; assunto: string; corpo_html: string } } | null>(null);
  const [excluir, setExcluir] = useState<EmailMacro | null>(null);

  const nomeSetor = useMemo(() => new Map((setores.data ?? []).map((s) => [s.id, s.name])), [setores.data]);

  const lista = useMemo(() => {
    const b = normalizarCampo(busca.replace(/^\/+/, ""));
    return (macros.data ?? []).filter((m) => {
      if (setorFiltro !== "todos" && m.department_ids.length > 0 && !m.department_ids.includes(setorFiltro)) return false;
      if (!b) return true;
      return [m.titulo, m.atalho ?? "", m.categoria ?? "", m.corpo_html.replace(/<[^>]*>/g, " ")].some((t) =>
        normalizarCampo(t).includes(b),
      );
    });
  }, [macros.data, busca, setorFiltro]);

  if (!tid) {
    return <p className="text-sm text-muted-foreground">Escolha uma empresa no filtro do topo para ver as macros.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Macros de e-mail</h3>
        <p className="mt-0.5 max-w-[76ch] text-[13px] text-muted-foreground">
          Textos prontos para a tela Enviar e-mail do chat, do chamado e da jornada. Os campos automáticos são trocados
          pelos dados do cliente na hora de usar, e o atendente vê o e-mail pronto antes de inserir.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar macro por nome, atalho ou texto"
            className="h-9 pl-9"
            autoComplete="off"
          />
        </div>
        <Select value={setorFiltro} onValueChange={setSetorFiltro}>
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os setores</SelectItem>
            {(setores.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="h-9 gap-1.5" onClick={() => setEditando({ macro: null })}>
          <Plus className="h-4 w-4" />
          Nova macro
        </Button>
      </div>

      {macros.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : macros.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar as macros. Recarregue a página.</p>
      ) : (macros.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
          <Zap className="h-8 w-8 text-sky-500" />
          <div>
            <p className="font-medium">Nenhuma macro de e-mail ainda</p>
            <p className="mt-1 max-w-[52ch] text-sm text-muted-foreground">
              Crie a primeira aqui, ou escreva um e-mail bom na tela Enviar e-mail e use "Salvar este e-mail como macro",
              no botão Macros.
            </p>
          </div>
          <Button className="gap-1.5" onClick={() => setEditando({ macro: null })}>
            <Plus className="h-4 w-4" />
            Nova macro
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Macro</th>
                <th className="px-3 py-2 font-semibold">Atalho</th>
                <th className="px-3 py-2 font-semibold">Categoria</th>
                <th className="px-3 py-2 font-semibold">Setores</th>
                <th className="px-3 py-2 text-right font-semibold">Usos</th>
                <th className="px-3 py-2 font-semibold">Ativa</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Nenhuma macro com esse filtro.
                  </td>
                </tr>
              ) : (
                lista.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="px-3 py-2.5">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => setEditando({ macro: m })}>
                        {m.titulo}
                      </button>
                      {m.anexos.length > 0 && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-muted-foreground" title="Anexos que entram junto">
                          <Paperclip className="h-3 w-3" />
                          {m.anexos.length}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-sky-600 dark:text-sky-400">{m.atalho ? `/${m.atalho}` : ""}</td>
                    <td className="px-3 py-2.5">{m.categoria}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {m.department_ids.length === 0 ? (
                          <span className="rounded-full border px-2 py-0.5 text-[11px]">Todos</span>
                        ) : (
                          m.department_ids.map((d) => (
                            <span key={d} className="whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]">
                              {nomeSetor.get(d) ?? "Setor inativo"}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{m.usos}</td>
                    <td className="px-3 py-2.5">
                      <Switch
                        checked={m.ativo}
                        aria-label={m.ativo ? "Desativar macro" : "Ativar macro"}
                        onCheckedChange={(v) =>
                          alternarAtiva.mutate(
                            { macro: m, ativo: v },
                            { onError: (err) => toast.error(mensagemDaMacro(err)) },
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar" onClick={() => setEditando({ macro: m })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Duplicar"
                          onClick={() =>
                            setEditando({
                              macro: null,
                              inicial: { titulo: `${m.titulo} (cópia)`, assunto: m.assunto ?? "", corpo_html: m.corpo_html },
                            })
                          }
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Excluir" onClick={() => setExcluir(m)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <Suspense fallback={null}>
          <MacroEmailDialog
            open
            onOpenChange={(v) => !v && setEditando(null)}
            tenantId={tid}
            macro={editando.macro}
            inicial={editando.inicial}
          />
        </Suspense>
      )}

      <AlertDialog open={!!excluir} onOpenChange={(v) => !v && setExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a macro "{excluir?.titulo}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela sai do botão Macros de todo mundo, junto com os anexos dela. Os e-mails já enviados não mudam. Para só
              esconder por um tempo, desligue "Ativa".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!excluir) return;
                apagar.mutate(excluir, {
                  onSuccess: () => toast.success("Macro excluída."),
                  onError: (err) => toast.error(mensagemDaMacro(err)),
                });
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
