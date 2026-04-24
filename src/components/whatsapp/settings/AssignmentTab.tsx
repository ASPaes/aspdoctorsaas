import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, Users, Shuffle, UserCheck } from "lucide-react";
import { useAssignmentRules, type AssignmentRule } from "@/components/whatsapp/hooks/useAssignmentRules";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

interface RuleForm {
  name: string;
  instance_id: string;
  rule_type: "fixed" | "round_robin";
}

const EMPTY_FORM: RuleForm = { name: "", instance_id: "", rule_type: "round_robin" };

export default function AssignmentTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { rules, isLoading, createRule, updateRule, deleteRule, toggleRuleActive } = useAssignmentRules();
  const { instances } = useWhatsAppInstances();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AssignmentRule | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AssignmentRule | null>(null);

  const openCreate = () => {
    setEditingRule(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (rule: AssignmentRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      instance_id: rule.instance_id,
      rule_type: rule.rule_type as "fixed" | "round_robin",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.instance_id) return;

    if (editingRule) {
      updateRule.mutate({
        id: editingRule.id,
        name: form.name.trim(),
        instance_id: form.instance_id,
        rule_type: form.rule_type,
      });
    } else {
      createRule.mutate({
        name: form.name.trim(),
        instance_id: form.instance_id,
        rule_type: form.rule_type,
        tenant_id: tid!,
        is_active: true,
        fixed_agent_id: null,
        round_robin_agents: [],
      });
    }
    setDialogOpen(false);
  };

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  const instanceName = (id: string) => {
    const inst = instances.find((i) => i.id === id);
    return inst?.display_name || inst?.instance_name || id.slice(0, 8);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Regras de Atribuição</h2>
          <p className="text-sm text-muted-foreground">Configure como as conversas são distribuídas entre agentes.</p>
        </div>
        <Button size="sm" onClick={openCreate} disabled={instances.length === 0}>
          <Plus className="h-4 w-4" /> Nova Regra
        </Button>
      </div>

      {instances.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="text-sm">Cadastre uma instância antes de criar regras de atribuição.</p>
          </CardContent>
        </Card>
      )}

      {rules.length === 0 && instances.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <CardTitle className="text-lg mb-1">Nenhuma regra criada</CardTitle>
            <CardDescription>Crie regras para distribuir conversas automaticamente.</CardDescription>
            <Button className="mt-4" onClick={openCreate}><Plus className="h-4 w-4" /> Nova Regra</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rules.map((rule) => (
            <Card key={rule.id} className={!rule.is_active ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base truncate">{rule.name}</CardTitle>
                  <Switch
                    checked={rule.is_active}
                    onCheckedChange={(checked) => toggleRuleActive.mutate({ id: rule.id, is_active: checked })}
                  />
                </div>
                <CardDescription className="text-xs">{instanceName(rule.instance_id)}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-2 mb-3">
                  {rule.rule_type === "round_robin" ? (
                    <Badge variant="secondary" className="text-xs"><Shuffle className="h-3 w-3 mr-1" /> Round Robin</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs"><UserCheck className="h-3 w-3 mr-1" /> Agente Fixo</Badge>
                  )}
                  {rule.is_active ? (
                    <Badge variant="default" className="text-[10px]">Ativa</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">Inativa</Badge>
                  )}
                </div>
                {rule.rule_type === "round_robin" && rule.round_robin_agents.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mb-2">{rule.round_robin_agents.length} agente(s)</p>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(rule)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDeleteTarget(rule)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Editar Regra" : "Nova Regra"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input placeholder="Ex: Distribuição Principal" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Instância *</Label>
              <Select value={form.instance_id} onValueChange={(v) => setForm(f => ({ ...f, instance_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>{inst.display_name || inst.instance_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de Distribuição</Label>
              <Select value={form.rule_type} onValueChange={(v) => setForm(f => ({ ...f, rule_type: v as "fixed" | "round_robin" }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round_robin">Round Robin (rodízio entre agentes)</SelectItem>
                  <SelectItem value="fixed">Agente Fixo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleSave} disabled={createRule.isPending || updateRule.isPending || !form.name.trim() || !form.instance_id}>
              {(createRule.isPending || updateRule.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingRule ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir regra?</AlertDialogTitle>
            <AlertDialogDescription>
              A regra <strong>{deleteTarget?.name}</strong> será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteTarget) deleteRule.mutate(deleteTarget.id); setDeleteTarget(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
