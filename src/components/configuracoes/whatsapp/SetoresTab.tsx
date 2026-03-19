import { useState, useMemo, useCallback } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
}

interface DeptInstance {
  id: string;
  department_id: string;
  instance_id: string;
  is_active: boolean;
  tenant_id: string;
}

interface Funcionario {
  id: number;
  nome: string;
  email: string | null;
  cargo: string | null;
  ativo: boolean;
  department_id: string | null;
  tenant_id: string | null;
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

  const { data: funcionarios = [], isLoading: funcLoading } = useQuery({
    queryKey: ["funcionarios_setores", tid],
    queryFn: async () => {
      let q = supabase.from("funcionarios").select("*").order("nome");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Funcionario[];
    },
  });

  const { data: profileEmails = [] } = useQuery({
    queryKey: ["profile_emails_for_func", tid],
    queryFn: async () => {
      if (!tid) return [];
      const { data, error } = await supabase.rpc("get_tenant_users_with_email", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      return (data ?? []) as { funcionario_id: number | null; email: string }[];
    },
    enabled: !!tid,
  });

  // Map funcionario_id -> email
  const emailMap = useMemo(() => {
    const map = new Map<number, string>();
    profileEmails.forEach((p) => {
      if (p.funcionario_id) map.set(Number(p.funcionario_id), p.email);
    });
    return map;
  }, [profileEmails]);

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
      };

      if (isCreating) {
        const { error } = await supabase
          .from("support_departments")
          .insert(payload);
        if (error) throw error;
      } else if (selectedId) {
        const { name, slug: s, description, is_active, is_default_fallback } = payload;
        const { error } = await supabase
          .from("support_departments")
          .update({ name, slug: s, description, is_active, is_default_fallback })
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

  const updateFuncDeptMutation = useMutation({
    mutationFn: async ({ funcId, deptId }: { funcId: number; deptId: string | null }) => {
      if (!tid) throw new Error("Tenant não identificado");

      // 1) Update funcionarios.department_id
      const { error } = await supabase
        .from("funcionarios")
        .update({ department_id: deptId })
        .eq("id", funcId);
      if (error) throw error;

      // 2) Find user_id linked to this funcionario via profiles
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("funcionario_id", funcId)
        .eq("tenant_id", tid)
        .maybeSingle();

      const userId = profileRow?.user_id;
      if (!userId) return; // No linked profile, skip membership sync

      // 3) Remove all existing memberships for this user in this tenant
      await supabase
        .from("support_department_members")
        .delete()
        .eq("user_id", userId)
        .eq("tenant_id", tid);

      // 4) Insert new membership if a department was selected
      if (deptId) {
        const { error: insertErr } = await supabase
          .from("support_department_members")
          .insert({
            tenant_id: tid,
            department_id: deptId,
            user_id: userId,
            is_active: true,
          });
        if (insertErr) throw insertErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["funcionarios_setores"] });
      queryClient.invalidateQueries({ queryKey: ["support_department_members"] });
      queryClient.invalidateQueries({ queryKey: ["user-department-membership"] });
      toast({ title: "Setor do funcionário atualizado" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
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

                  <div className="flex items-center gap-6">
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
                  </div>

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

              {/* C) Usuários */}
              {!isCreating && selectedId && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Usuários / Funcionários</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {funcLoading ? (
                      <Skeleton className="h-32 w-full" />
                    ) : funcionarios.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum funcionário cadastrado
                      </p>
                    ) : (
                      <div className="overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Nome</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Cargo</TableHead>
                              <TableHead>Setor</TableHead>
                              <TableHead>Ativo</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {funcionarios.map((f) => (
                              <TableRow key={f.id}>
                                <TableCell className="font-medium">
                                  {f.nome}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {emailMap.get(f.id) ?? "—"}
                                </TableCell>
                                <TableCell>{f.cargo ?? "—"}</TableCell>
                                <TableCell>
                                  <Select
                                    value={f.department_id ?? "none"}
                                    onValueChange={(v) =>
                                      updateFuncDeptMutation.mutate({
                                        funcId: f.id,
                                        deptId: v === "none" ? null : v,
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-8 w-40">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">
                                        Sem setor
                                      </SelectItem>
                                      {departments.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>
                                          {d.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={f.ativo ? "default" : "secondary"}
                                  >
                                    {f.ativo ? "Sim" : "Não"}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
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
