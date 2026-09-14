import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarIcon, Plus, Pencil, Trash2, Loader2, CalendarOff, Download } from "lucide-react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SetoresMultiSelect } from "@/components/configuracoes/email/SetoresMultiSelect";

interface Exception {
  id: string;
  date: string;
  type: string;
  name: string | null;
  is_closed: boolean;
  use_template: boolean;
  department_id: string | null;
}

interface Department {
  id: string;
  name: string;
  is_active: boolean;
}

// No banco é uma linha por setor. Na tela, os setores do mesmo dia com o mesmo
// tipo, nome e estado aparecem como UMA exceção, e editar/excluir/trocar o
// estado age no grupo todo.
interface ExceptionGroup {
  key: string;
  ids: string[];
  date: string;
  type: string;
  name: string | null;
  is_closed: boolean;
  use_template: boolean;
  /** vazio = exceção geral (todos os setores) */
  departmentIds: string[];
}

type DayStatus = "closed" | "reduced" | "open";

const TYPE_LABELS: Record<string, string> = {
  holiday: "Feriado",
  collective_leave: "Folga coletiva",
};

function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function addDias(d: Date, n: number): Date {
  const novo = new Date(d);
  novo.setDate(novo.getDate() + n);
  return novo;
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getFeriadosNacionais(ano: number): { date: string; name: string }[] {
  const pascoa = calcularPascoa(ano);
  const sextaSanta = addDias(pascoa, -2);
  const corpusChristi = addDias(pascoa, 60);

  return [
    { date: `${ano}-01-01`, name: "Confraternização Universal" },
    { date: ymd(sextaSanta), name: "Sexta-feira da Paixão" },
    { date: `${ano}-04-21`, name: "Tiradentes" },
    { date: `${ano}-05-01`, name: "Dia do Trabalhador" },
    { date: ymd(corpusChristi), name: "Corpus Christi" },
    { date: `${ano}-09-07`, name: "Independência do Brasil" },
    { date: `${ano}-10-12`, name: "Nossa Senhora Aparecida" },
    { date: `${ano}-11-02`, name: "Finados" },
    { date: `${ano}-11-15`, name: "Proclamação da República" },
    { date: `${ano}-11-20`, name: "Consciência Negra" },
    { date: `${ano}-12-25`, name: "Natal" },
  ];
}

const ANOS_DISPONIVEIS = (() => {
  const atual = new Date().getFullYear();
  return [atual, atual + 1, atual + 2];
})();

function estadoDo(g: { is_closed: boolean; use_template: boolean }): DayStatus {
  return g.use_template ? "reduced" : g.is_closed ? "closed" : "open";
}

export default function BusinessHoursExceptionsSection() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExceptionGroup | null>(null);
  const [formDate, setFormDate] = useState<Date | undefined>();
  const [formType, setFormType] = useState<string>("holiday");
  const [formName, setFormName] = useState("");
  const [formTodos, setFormTodos] = useState(true);
  const [formDepts, setFormDepts] = useState<string[]>([]);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importAno, setImportAno] = useState(ANOS_DISPONIVEIS[0]);

  const { data: exceptions = [], isLoading } = useQuery<Exception[]>({
    queryKey: ["business-hours-exceptions", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_hours_exceptions" as any)
        .select("id, date, type, name, is_closed, use_template, department_id")
        .eq("tenant_id", tid!)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Exception[];
    },
  });

  // Traz os inativos também: uma exceção antiga de setor desativado ainda
  // precisa mostrar o nome na lista. O seletor só oferece os ativos.
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["business-hours-exceptions-departments", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name, is_active")
        .eq("tenant_id", tid)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });

  const deptName = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments]
  );
  const nomeSetor = useCallback((id: string) => deptName.get(id) ?? "Setor removido", [deptName]);

  const groups = useMemo<ExceptionGroup[]>(() => {
    const porChave = new Map<string, ExceptionGroup>();
    for (const ex of exceptions) {
      // Geral nunca se junta com setor: são escopos diferentes.
      const key = [
        ex.date,
        ex.department_id ? "setor" : "geral",
        ex.type,
        ex.name ?? "",
        ex.is_closed,
        ex.use_template,
      ].join("|");
      const g = porChave.get(key);
      if (g) {
        g.ids.push(ex.id);
        if (ex.department_id) g.departmentIds.push(ex.department_id);
      } else {
        porChave.set(key, {
          key,
          ids: [ex.id],
          date: ex.date,
          type: ex.type,
          name: ex.name,
          is_closed: ex.is_closed,
          use_template: ex.use_template,
          departmentIds: ex.department_id ? [ex.department_id] : [],
        });
      }
    }
    const lista = [...porChave.values()];
    for (const g of lista) g.departmentIds.sort((a, b) => nomeSetor(a).localeCompare(nomeSetor(b)));
    // Na mesma data, a geral vem antes das de setor.
    return lista.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (!a.departmentIds.length !== !b.departmentIds.length) return a.departmentIds.length ? 1 : -1;
      return nomeSetor(a.departmentIds[0] ?? "").localeCompare(nomeSetor(b.departmentIds[0] ?? ""));
    });
  }, [exceptions, nomeSetor]);

  const { data: template } = useQuery<any>({
    queryKey: ["tenant-holiday-template", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("tenant_holiday_template" as any) as any)
        .select("*")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const templateValido = !!(template?.open_at && template?.close_at);
  const formatTemplateRange = () => {
    if (!templateValido) return "—";
    return `${template.open_at.slice(0, 5)}–${template.close_at.slice(0, 5)}`;
  };

  // A importação cria exceções GERAIS. Uma data que só tem exceção de setor
  // continua sem a geral e precisa ser importada.
  const datasJaCadastradas = useMemo(
    () => new Set(exceptions.filter((e) => !e.department_id).map((e) => e.date)),
    [exceptions]
  );

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (!formDate || !tid) throw new Error("Data obrigatória");
      if (!formTodos && formDepts.length === 0) throw new Error("Escolha pelo menos um setor.");
      const dateStr = format(formDate, "yyyy-MM-dd");
      const nome = formName.trim() || null;

      // null = geral
      const alvo: (string | null)[] = formTodos ? [null] : formDepts;
      const idsDoGrupo = new Set(editing?.ids ?? []);

      // Confere colisão antes de gravar qualquer coisa, para não deixar o
      // grupo pela metade (a gravação são várias chamadas).
      const colisoes = alvo.filter((dep) =>
        exceptions.some(
          (e) => !idsDoGrupo.has(e.id) && e.date === dateStr && (e.department_id ?? null) === dep
        )
      );
      if (colisoes.length > 0) {
        throw new Error(
          colisoes[0] === null
            ? "Já existe uma exceção para todos os setores nesta data."
            : `Já existe uma exceção nesta data para: ${colisoes.map((d) => nomeSetor(d as string)).join(", ")}.`
        );
      }

      const tabela = () => supabase.from("business_hours_exceptions" as any) as any;

      // Estado do dia: grupo editado mantém o seu; exceção nova nasce fechada.
      const estado = editing
        ? { is_closed: editing.is_closed, use_template: editing.use_template }
        : { is_closed: true, use_template: false };

      const atuais = new Map<string | null, string>();
      if (editing) {
        const linhas = exceptions.filter((e) => idsDoGrupo.has(e.id));
        for (const l of linhas) atuais.set(l.department_id ?? null, l.id);
      }

      const inserir = alvo.filter((dep) => !atuais.has(dep));
      const manter = alvo.filter((dep) => atuais.has(dep)).map((dep) => atuais.get(dep)!);
      const remover = [...atuais.entries()].filter(([dep]) => !alvo.includes(dep)).map(([, id]) => id);

      const falhou = (error: any) => {
        if (error?.code === "23505") {
          return new Error("Outra pessoa cadastrou uma exceção nesta data agora há pouco. Atualize a tela e tente de novo.");
        }
        return error;
      };

      if (inserir.length > 0) {
        const { error } = await tabela().insert(
          inserir.map((dep) => ({
            tenant_id: tid,
            date: dateStr,
            type: formType,
            name: nome,
            department_id: dep,
            ...estado,
          }))
        );
        if (error) throw falhou(error);
      }
      if (manter.length > 0) {
        const { error } = await tabela()
          .update({ type: formType, name: nome, date: dateStr })
          .in("id", manter);
        if (error) throw falhou(error);
      }
      if (remover.length > 0) {
        const { error } = await tabela().delete().in("id", remover);
        if (error) throw falhou(error);
      }
    },
    onSuccess: () => {
      toast({ title: editing ? "Exceção atualizada!" : "Exceção adicionada!" });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
    // Mesmo com erro no meio, a lista precisa refletir o que ficou gravado.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["business-hours-exceptions", tid] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await (supabase.from("business_hours_exceptions" as any) as any)
        .delete()
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-hours-exceptions", tid] });
      toast({ title: "Exceção removida!" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao remover", description: err.message, variant: "destructive" });
    },
  });

  const setDayStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: DayStatus }) => {
      let payload: { is_closed: boolean; use_template: boolean };
      if (status === "closed") {
        payload = { is_closed: true, use_template: false };
      } else if (status === "reduced") {
        if (!templateValido) {
          throw new Error("Configure o horário em feriados primeiro (acima de Domingo).");
        }
        payload = { is_closed: false, use_template: true };
      } else {
        payload = { is_closed: false, use_template: false };
      }
      const { error } = await (supabase.from("business_hours_exceptions" as any) as any)
        .update(payload)
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-hours-exceptions", tid] });
    },
    onError: (err: any) => {
      toast({ title: "Não foi possível alterar", description: err.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (ano: number) => {
      if (!tid) throw new Error("tenant_id ausente");
      const lista = getFeriadosNacionais(ano);
      const novos = lista.filter((f) => !datasJaCadastradas.has(f.date));
      if (novos.length === 0) {
        return { inseridos: 0, ignorados: lista.length };
      }
      const payload = novos.map((f) => ({
        tenant_id: tid,
        date: f.date,
        type: "holiday",
        name: f.name,
        department_id: null,
        is_closed: true,
        use_template: false,
      }));
      const { error } = await (supabase.from("business_hours_exceptions" as any) as any)
        .insert(payload);
      if (error) {
        if (error.code !== "23505") throw error;
      }
      return { inseridos: novos.length, ignorados: lista.length - novos.length };
    },
    onSuccess: ({ inseridos, ignorados }) => {
      qc.invalidateQueries({ queryKey: ["business-hours-exceptions", tid] });
      if (inseridos === 0) {
        toast({ title: "Nenhum feriado novo", description: `Todos os ${ignorados} feriados nacionais já estavam cadastrados.` });
      } else {
        toast({ title: "Feriados importados!", description: `${inseridos} adicionado${inseridos > 1 ? "s" : ""}${ignorados > 0 ? `, ${ignorados} já existia${ignorados > 1 ? "m" : ""}` : ""}.` });
      }
      setImportDialogOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao importar", description: err.message, variant: "destructive" });
    },
  });

  const previewImport = useMemo(() => {
    const lista = getFeriadosNacionais(importAno);
    return lista.map((f) => ({
      ...f,
      jaExiste: datasJaCadastradas.has(f.date),
    }));
  }, [importAno, datasJaCadastradas]);

  const totalNovos = previewImport.filter((p) => !p.jaExiste).length;

  const openAdd = useCallback(() => {
    setEditing(null);
    setFormDate(undefined);
    setFormType("holiday");
    setFormName("");
    setFormTodos(true);
    setFormDepts([]);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((g: ExceptionGroup) => {
    setEditing(g);
    setFormDate(parseISO(g.date));
    setFormType(g.type);
    setFormName(g.name || "");
    setFormTodos(g.departmentIds.length === 0);
    setFormDepts(g.departmentIds);
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditing(null);
  }, []);

  // Ativos, mais os setores já marcados no grupo que foram desativados depois:
  // somem do seletor só se o usuário desmarcar.
  const setoresDoSeletor = useMemo(() => {
    const ativos = departments.filter((d) => d.is_active);
    const inativosMarcados = departments
      .filter((d) => !d.is_active && formDepts.includes(d.id))
      .map((d) => ({ ...d, name: `${d.name} (inativo)` }));
    return [...ativos, ...inativosMarcados];
  }, [departments, formDepts]);

  const salvarDesabilitado = !formDate || (!formTodos && formDepts.length === 0) || upsertMutation.isPending;

  return (
    <AccordionItem value="feriados" className="border rounded-lg">
      <AccordionTrigger className="px-4 hover:no-underline">
        <div className="flex items-center gap-2">
          <CalendarOff className="h-5 w-5 text-primary" />
          <span className="font-semibold text-base">Feriados e Folgas Coletivas</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Dias em que o atendimento é considerado fechado, independentemente da grade semanal.
          Uma exceção pode valer para todos os setores ou só para os setores escolhidos. Quando
          as duas existem na mesma data, a do setor vence para aquele setor.
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportDialogOpen(true)}>
            <Download className="h-4 w-4 mr-1" />
            Importar feriados nacionais
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" />
            Adicionar dia
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhum feriado ou folga coletiva cadastrado.
          </p>
        ) : (
          // Uma área de rolagem só (a de fora), com altura limitada: a barra
          // lateral fica sempre à vista, sem descer até o fim da lista. O
          // [&>div] desliga a rolagem própria que o <Table> do shadcn cria.
          // Cabeçalho e coluna de ações ficam fixos durante a rolagem. As linhas
          // divisórias das células fixas são sombra interna, não borda: com
          // border-collapse a borda fica para trás quando a célula gruda.
          <div className="rounded-lg border max-h-[60vh] overflow-auto overscroll-contain [&>div]:overflow-visible">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky top-0 z-20 bg-background px-3 shadow-[inset_0_-1px_0_hsl(var(--border)/0.6)]">Data</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-background px-3 shadow-[inset_0_-1px_0_hsl(var(--border)/0.6)]">Nome</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-background px-3 shadow-[inset_0_-1px_0_hsl(var(--border)/0.6)]">Setores</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-background px-3 shadow-[inset_0_-1px_0_hsl(var(--border)/0.6)]">Atendimento no dia</TableHead>
                  <TableHead className="sticky top-0 right-0 z-30 bg-background px-3 text-right shadow-[inset_1px_0_0_hsl(var(--border)/0.4),inset_0_-1px_0_hsl(var(--border)/0.6)]">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  // Sem hover na linha: a célula fixa de ações tem fundo opaco
                  // e ficaria de outra cor que o resto da linha.
                  <TableRow key={g.key} className="group hover:bg-transparent">
                    <TableCell className="px-3 font-medium whitespace-nowrap">
                      {format(parseISO(g.date), "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell className="px-3 min-w-[140px]">
                      <div className="text-sm">{g.name || TYPE_LABELS[g.type] || g.type}</div>
                      {g.name && (
                        <div className="text-xs text-muted-foreground">{TYPE_LABELS[g.type] || g.type}</div>
                      )}
                    </TableCell>
                    <TableCell className="px-3 min-w-[140px]">
                      {g.departmentIds.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {g.departmentIds.map((id) => (
                            <Badge key={id} variant="secondary" className="font-medium">
                              {nomeSetor(id)}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground whitespace-nowrap">Todos os setores</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3">
                      <Select
                        value={estadoDo(g)}
                        onValueChange={(status) =>
                          setDayStatusMutation.mutate({ ids: g.ids, status: status as DayStatus })
                        }
                        disabled={setDayStatusMutation.isPending}
                      >
                        <SelectTrigger className="w-[210px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="closed">Fechado o dia todo</SelectItem>
                          <SelectItem value="reduced" disabled={!templateValido}>
                            {templateValido
                              ? `Reduzido (${formatTemplateRange()})`
                              : "Horário reduzido"}
                          </SelectItem>
                          <SelectItem value="open">Aberto normalmente</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="sticky right-0 z-10 bg-background px-3 text-right shadow-[inset_1px_0_0_hsl(var(--border)/0.4),inset_0_-1px_0_hsl(var(--border)/0.4)] group-last:shadow-[inset_1px_0_0_hsl(var(--border)/0.4)]">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(g)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteMutation.mutate(g.ids)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* ── Add/Edit Dialog ── */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Exceção" : "Adicionar Dia Fechado"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Date picker */}
              <div className="space-y-1.5">
                <Label>Data *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formDate ? format(formDate, "dd/MM/yyyy") : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formDate}
                      onSelect={setFormDate}
                      locale={ptBR}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Setores */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="bhe-todos-setores">Aplica a todos os setores</Label>
                  <Switch
                    id="bhe-todos-setores"
                    checked={formTodos}
                    onCheckedChange={setFormTodos}
                  />
                </div>
                {!formTodos && (
                  <div className="space-y-1.5">
                    <Label>Setores *</Label>
                    <SetoresMultiSelect
                      setores={setoresDoSeletor}
                      value={formDepts}
                      onChange={setFormDepts}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Desligue quando só parte da operação para. Ex.: Onboarding e Implantação
                  fechados enquanto o Suporte atende em plantão.
                </p>
              </div>

              {/* Type */}
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="holiday">Feriado</SelectItem>
                    <SelectItem value="collective_leave">Folga coletiva</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <Label>Nome / Descrição (opcional)</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Natal, Confraternização Universal..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button onClick={() => upsertMutation.mutate()} disabled={salvarDesabilitado}>
                {upsertMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {editing ? "Salvar" : "Adicionar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Import Dialog ── */}
        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col gap-0 p-0">
            <DialogHeader className="m-0 px-6 pt-6 pb-2 shrink-0">
              <DialogTitle>Importar feriados nacionais</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4 min-h-0">
              <p className="text-sm text-muted-foreground">
                Importa os feriados nacionais oficiais brasileiros (não-facultativos) como dias
                fechados para todos os setores. Feriados já cadastrados são ignorados.
              </p>

              <div className="space-y-1.5">
                <Label>Ano</Label>
                <Select value={String(importAno)} onValueChange={(v) => setImportAno(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANOS_DISPONIVEIS.map((a) => (
                      <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Data</TableHead>
                      <TableHead className="text-xs">Nome</TableHead>
                      <TableHead className="text-xs text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewImport.map((f) => (
                      <TableRow key={f.date} className={f.jaExiste ? "opacity-50" : ""}>
                        <TableCell className="text-xs font-medium">
                          {format(parseISO(f.date), "dd/MM/yyyy")}
                        </TableCell>
                        <TableCell className="text-xs">{f.name}</TableCell>
                        <TableCell className="text-xs text-right">
                          {f.jaExiste ? (
                            <span className="text-muted-foreground">Já existe</span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">Será adicionado</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <p className="text-xs text-muted-foreground">
                {totalNovos === 0
                  ? "Todos os feriados nacionais deste ano já estão cadastrados."
                  : `${totalNovos} novo${totalNovos > 1 ? "s" : ""} feriado${totalNovos > 1 ? "s" : ""} ser${totalNovos > 1 ? "ão" : "á"} adicionado${totalNovos > 1 ? "s" : ""}.`}
              </p>
            </div>
            <DialogFooter className="m-0 px-6 py-4 border-t shrink-0">
              <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => importMutation.mutate(importAno)}
                disabled={totalNovos === 0 || importMutation.isPending}
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                <Download className="h-4 w-4 mr-1" />
                Importar {totalNovos > 0 ? `(${totalNovos})` : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AccordionContent>
    </AccordionItem>
  );
}
