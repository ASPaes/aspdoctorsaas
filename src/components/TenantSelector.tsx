import { Building2 } from "lucide-react";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export function TenantSelector() {
  const { isSuperAdmin, selectedTenantId, setSelectedTenantId, tenants, tenantsLoading } = useTenantFilter();

  if (!isSuperAdmin) return null;

  const selectedName = tenants.find(t => t.id === selectedTenantId)?.nome;

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <Select
        value={selectedTenantId || "__all__"}
        onValueChange={(v) => setSelectedTenantId(v === "__all__" ? null : v)}
        disabled={tenantsLoading}
      >
        <SelectTrigger className="h-8 w-[200px] text-xs">
          <SelectValue placeholder="Todos os tenants" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">
            <span className="flex items-center gap-1.5">
              Todos os Tenants
            </span>
          </SelectItem>
          {tenants.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedTenantId && (
        <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-600 border-amber-500/30">
          Simulando
        </Badge>
      )}
    </div>
  );
}
