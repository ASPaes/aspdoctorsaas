import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Save, Loader2, Building2 } from "lucide-react";

// ---------- types ----------
interface Department {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  is_default_fallback: boolean;
  default_instance_id: string | null;
  tenant_id: string;
  requires_ticket_on_close: boolean;
  usa_tickets: boolean;
}

interface DeptInstance {
  id: string;
  department_id: string;
  instance_id: string;
  is_active: boolean;
  tenant_id: string;
}

// ---------- helpers ----------
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------- component ----------
export default function SetoresTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formFallback, setFormFallback] = useState(false);
  const [requiresTicket, setRequiresTicket] = useState(false);

  // ========== Queries ==========

  const { data: departments = [], isLoading: depsLoading } = useQuery({
    queryKey: ["support_departments", tid],
    queryFn: async () => {
      let q = supabase
        .from("support_departments")
        .select("*")
        .order("name");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return data as Department[];
    },
  });

  const { instances } = useWhatsAppInstances();

  const { data: deptInstances = [] } = useQuery({
    queryKey: ["support_department_instances", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_department_instances")
        .select("*")
        .eq("department_id", selectedId!);
      if (error) throw error;
      return data as DeptInstance[];
    },
  });

  const selectedDept = departments.find((d) => d.id === selectedId) ?? null;
  const linkedInstanceIds = new Set(deptInstances.map((di) => di.instance_id));

  // ========== Mutations ==========

  const saveDeptMutation = useMutation({
    mutationFn: async () => {
      const slug = slugify(formName);
      if (!slug) throw new Error("Nome inválido");
      if (!tid) throw new Error("Tenant não identificado");

      const payload = {
        name: formName.trim(),
        slug,
        description: formDesc.trim() || null,
        is_active: formActive,
        is_default_fallback: formFallback,
        tenant_id: tid,
        requires_ticket_on_close: requiresTicket,
      };

      if (isCreating) {
        const { error } = await supabase
          .from("support_departments")
          .insert(payload);
        if (error) throw error;
      } else if (selectedId) {
        const { name, slug: s, description, is_active, is_default_fallback, requires_ticket_on_close } = payload;
        const { error } = await supabase
          .from("support_departments")
          .update({ name, slug: s, description, is_active, is_default_fallback, requires_ticket_on_close })
          .eq("id", selectedId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments"] });
      toast({ title: "Setor salvo com sucesso!" });
      setIsCreating(false);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar setor", description: err.message, variant: "destructive" });
    },
  });

  const toggleInstanceMutation = useMutation({
    mutationFn: async ({ instanceId, linked }: { instanceId: string; linked: boolean }) => {
      if (!selectedId || !tid) return;
      if (linked) {
        // remove
        const { error } = await supabase
          .from("support_department_instances")
          .delete()
          .eq("department_id", selectedId)
          .eq("instance_id", instanceId);
        if (error) throw error;
        // If was default, clear it
        if (selectedDept?.default_instance_id === instanceId) {
          await supabase
            .from("support_departments")
            .update({ default_instance_id: null })
            .eq("id", selectedId);
        }
      } else {
        // add
        const { error } = await supabase
          .from("support_department_instances")
          .insert({ department_id: selectedId, instance_id: instanceId, tenant_id: tid });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_department_instances", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["support_departments"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const setDefaultInstanceMutation = useMutation({
    mutationFn: async (instanceId: string | null) => {
      if (!selectedId) return;
      const { error } = await supabase
        .from("support_departments")
        .update({ default_instance_id: instanceId })
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments"] });
      toast({ title: "Instância padrão atualizada" });
    },
  });

  // ========== Handlers ==========

  const selectDept = useCallback(
    (dept: Department) => {
      setSelectedId(dept.id);
      setIsCreating(false);
      setFormName(dept.name);
      setFormDesc(dept.description ?? "");
      setFormActive(dept.is_active);
      setFormFallback(dept.is_default_fallback);
      setRequiresTicket(dept.requires_ticket_on_close ?? false);
    },
    []
  );

  const startCreate = useCallback(() => {
    setSelectedId(null);
    setIsCreating(true);
    setFormName("");
    setFormDesc("");
    setFormActive(true);
    setFormFallback(false);
    setRequiresTicket(false);
  }, []);

  const handleSave = () => {
    if (!formActive && selectedDept?.is_active) {
      setConfirmDeactivate(true);
      return;
    }
    saveDeptMutation.mutate();
  };

  if (!isAdmin) return null;

  // ========== Render ==========

  if (depsLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const showDetail = isCreating || selectedId;

  return (
    <div className="space-y-4">
      {/* Mobile: dept selector */}
      <div className="md:hidden space-y-3">
        <div className="flex items-center gap-2">
          <Select
            value={selectedId ?? ""}
            onValueChange={(v) => {
              const dept = departments.find((d) => d.id === v);
              if (dept) selectDept(dept);
            }}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Selecione um setor" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} {!d.is_active ? "(Inativo)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Left: department list (desktop) */}
        <div className="hidden md:block w-64 shrink-0 space-y-2">
          <Button size="sm" className="w-full" onClick={startCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Setor
          </Button>

          {departments.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhum setor cadastrado
            </p>
          )}

          {departments.map((d) => (
            <button
              key={d.id}
              onClick={() => selectDept(d)}
              className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent ${
                selectedId === d.id ? "border-primary bg-accent" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium truncate flex-1">{d.name}</span>
                {!d.is_active && (
                  <Badge variant="secondary" className="text-xs">Inativo</Badge>
                )}
                {d.is_default_fallback && (
                  <Badge variant="outline" className="text-xs">Fallback</Badge>
                )}
                {d.requires_ticket_on_close && (
                  <Badge variant="outline" className="text-[10px]">Ticket obrigatório</Badge>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Right: detail */}
        <div className="flex-1 min-w-0">
          {!showDetail ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Building2 className="mx-auto h-10 w-10 mb-3 opacity-40" />
                <p>Selecione um setor ou crie um novo</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* A) Dados do Setor */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {isCreating ? "Novo Setor" : "Dados do Setor"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Nome</Label>
                    <Input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Ex: Suporte Técnico"
                    />
                    {formName && (
                      <p className="text-xs text-muted-foreground">
                        Slug: {slugify(formName)}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Descrição</Label>
                    <Textarea
                      value={formDesc}
                      onChange={(e) => setFormDesc(e.target.value)}
                      placeholder="Descrição do setor (opcional)"
                      rows={2}
                    />
                  </div>

                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formActive}
                        onCheckedChange={setFormActive}
                        id="dept-active"
                      />
                      <Label htmlFor="dept-active">Ativo</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formFallback}
                        onCheckedChange={setFormFallback}
                        id="dept-fallback"
                      />
                      <Label htmlFor="dept-fallback">Setor Fallback</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={requiresTicket}
                        onCheckedChange={setRequiresTicket}
                        id="dept-requires-ticket"
                      />
                      <Label htmlFor="dept-requires-ticket">Exigir ticket ao encerrar chat</Label>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-2">
                    Quando ativo, o agente será obrigado a classificar o atendimento (criar ticket) antes de encerrar conversas deste setor.
                  </p>

                  <Button
                    onClick={handleSave}
                    disabled={!formName.trim() || saveDeptMutation.isPending}
                  >
                    {saveDeptMutation.isPending && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    <Save className="h-4 w-4" />
                    Salvar
                  </Button>
                </CardContent>
              </Card>

              {/* B) Instâncias — only for existing dept */}
              {!isCreating && selectedId && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Instâncias do Setor</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {instances.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhuma instância WhatsApp cadastrada
                      </p>
                    ) : (
                      <>
                        <div className="space-y-2">
                          {instances.map((inst) => {
                            const isLinked = linkedInstanceIds.has(inst.id);
                            return (
                              <div
                                key={inst.id}
                                className="flex items-center gap-2"
                              >
                                <Checkbox
                                  checked={isLinked}
                                  onCheckedChange={() =>
                                    toggleInstanceMutation.mutate({
                                      instanceId: inst.id,
                                      linked: isLinked,
                                    })
                                  }
                                />
                                <span className="text-sm">
                                  {inst.display_name || inst.instance_name}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {linkedInstanceIds.size > 0 && (
                          <div className="space-y-1.5 pt-2 border-t">
                            <Label>Instância Padrão</Label>
                            <Select
                              value={selectedDept?.default_instance_id ?? "none"}
                              onValueChange={(v) =>
                                setDefaultInstanceMutation.mutate(
                                  v === "none" ? null : v
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">
                                  Nenhuma
                                </SelectItem>
                                {instances
                                  .filter((i) => linkedInstanceIds.has(i.id))
                                  .map((i) => (
                                    <SelectItem key={i.id} value={i.id}>
                                      {i.display_name || i.instance_name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

            </div>
          )}
        </div>
      </div>

      {/* Confirm deactivate dialog */}
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar setor?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja desativar o setor "{formName}"? Funcionários
              vinculados não serão removidos, mas o setor não aparecerá como
              opção ativa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDeactivate(false);
                saveDeptMutation.mutate();
              }}
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
