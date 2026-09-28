import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Search, Settings2, Users } from "lucide-react";
import {
  useGroupsAdminInstances,
  useGroupsAdminGroups,
  useSyncGroups,
  useToggleGroupEnabled,
} from "../hooks/useWhatsAppGroupsAdmin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Atalho do chat para Configurações > Operação > Grupos: sincronizar com o
 * WhatsApp e escolher quais grupos aparecem no sistema. Setor e retenção
 * continuam só na tela de Configurações.
 */
export function GroupsSyncModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [instanceId, setInstanceId] = useState("");
  const [search, setSearch] = useState("");

  const { data: allInstances, isLoading: instancesLoading } = useGroupsAdminInstances();
  // Meta Cloud não tem grupos: nem aparece para escolha.
  const instances = useMemo(
    () => (allInstances ?? []).filter((i) => i.provider_type !== "meta_cloud"),
    [allInstances],
  );

  useEffect(() => {
    if (!open) return;
    if (!instanceId && instances.length > 0) setInstanceId(instances[0].id);
  }, [open, instanceId, instances]);

  const { data: groups, isLoading: groupsLoading } = useGroupsAdminGroups(instanceId);
  const syncMutation = useSyncGroups(instanceId);
  const toggleMutation = useToggleGroupEnabled(instanceId, groups);

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (groups ?? [])
      .filter((g) => !term || (g.group_name || g.group_jid).toLowerCase().includes(term))
      // Ativos primeiro: é o que a pessoa quer conferir ao abrir.
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.group_name || "").localeCompare(b.group_name || "", "pt-BR"));
  }, [groups, search]);

  const enabledCount = (groups ?? []).filter((g) => g.enabled).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="p-5 pb-3">
          <DialogTitle>Grupos do WhatsApp</DialogTitle>
          <DialogDescription>
            Sincronize com o WhatsApp e escolha quais grupos aparecem no chat.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 space-y-3">
          <div className="flex items-center gap-2">
            <Select value={instanceId} onValueChange={setInstanceId} disabled={instancesLoading || instances.length === 0}>
              <SelectTrigger className="flex-1 min-w-0">
                <SelectValue placeholder={instancesLoading ? "Carregando..." : "Selecione a instância"} />
              </SelectTrigger>
              <SelectContent>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.display_name || inst.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={!instanceId || syncMutation.isPending}
              className="shrink-0"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sincronizar
            </Button>
          </div>

          {!instancesLoading && instances.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma instância com suporte a grupos (Meta Cloud não suporta).
            </p>
          )}

          {instanceId && (groups?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar grupo..."
                  className="pl-8 h-9"
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {enabledCount} de {groups?.length} no chat
              </span>
            </div>
          )}
        </div>

        <ScrollArea className="h-[min(420px,55vh)] mt-3 border-y border-border">
          {instanceId && groupsLoading && (
            <div className="p-3 space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {instanceId && !groupsLoading && (groups?.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-12 px-6">
              <Users className="h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                Nenhum grupo desta instância ainda. Clique em <strong>Sincronizar</strong> para buscar no WhatsApp.
              </p>
            </div>
          )}

          {instanceId && !groupsLoading && (groups?.length ?? 0) > 0 && visibleGroups.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-12">Nenhum grupo encontrado.</p>
          )}

          <div className="divide-y divide-border">
            {visibleGroups.map((group) => {
              const saving = toggleMutation.isPending && toggleMutation.variables?.groupId === group.id;
              return (
                <label
                  key={group.id}
                  htmlFor={`grp-${group.id}`}
                  className="flex items-center gap-3 px-5 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    {group.group_picture_url && <AvatarImage src={group.group_picture_url} />}
                    <AvatarFallback>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${group.enabled ? "font-medium" : "text-muted-foreground"}`}>
                      {group.group_name || group.group_jid}
                    </p>
                    {typeof group.participant_count === "number" && (
                      <p className="text-xs text-muted-foreground">{group.participant_count} participante(s)</p>
                    )}
                  </div>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  <Switch
                    id={`grp-${group.id}`}
                    checked={group.enabled}
                    onCheckedChange={(checked) => toggleMutation.mutate({ groupId: group.id, enabled: checked })}
                    disabled={saving}
                  />
                </label>
              );
            })}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between gap-2 px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              onOpenChange(false);
              navigate("/configuracoes?section=operacao&sub=grupos");
            }}
          >
            <Settings2 className="h-4 w-4 mr-1.5" />
            Setor e retenção
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
