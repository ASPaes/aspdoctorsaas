import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useSecuritySettings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["security-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_config" as any)
        .select("key, value")
        .in("key", ["restrict_signup_by_domain", "allowed_email_domains", "require_account_approval"]);

      if (error) throw error;

      const rows = (data ?? []) as { key: string; value: string | null }[];
      const restrictEnabled = rows.find((c) => c.key === "restrict_signup_by_domain")?.value === "true";
      const requireApproval = rows.find((c) => c.key === "require_account_approval")?.value === "true";
      const domainsString = rows.find((c) => c.key === "allowed_email_domains")?.value || "";
      const domains = domainsString
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);

      return { restrictEnabled, requireApproval, allowedDomains: domains };
    },
  });

  const toggleRestriction = useMutation({
    mutationFn: async ({ enabled, key }: { enabled: boolean; key: string }) => {
      const { error } = await (supabase.from("project_config" as any) as any).upsert(
        { key, value: enabled ? "true" : "false" },
        { onConflict: "tenant_id,key" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security-settings"] });
      toast.success("Configuração atualizada!");
    },
    onError: (error) => {
      console.error("Error updating restriction:", error);
      toast.error("Erro ao atualizar configuração");
    },
  });

  const addDomain = useMutation({
    mutationFn: async (domain: string) => {
      const currentDomains = settings?.allowedDomains || [];
      const normalizedDomain = domain.toLowerCase().trim().replace(/^@/, "");

      if (currentDomains.includes(normalizedDomain)) {
        throw new Error("Domínio já existe");
      }

      const newDomains = [...currentDomains, normalizedDomain];
      const { error } = await (supabase.from("project_config" as any) as any).upsert(
        { key: "allowed_email_domains", value: newDomains.join(",") },
        { onConflict: "tenant_id,key" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security-settings"] });
      toast.success("Domínio adicionado!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao adicionar domínio");
    },
  });

  const removeDomain = useMutation({
    mutationFn: async (domain: string) => {
      const currentDomains = settings?.allowedDomains || [];
      const newDomains = currentDomains.filter((d) => d !== domain);
      const { error } = await (supabase.from("project_config" as any) as any).upsert(
        { key: "allowed_email_domains", value: newDomains.join(",") },
        { onConflict: "tenant_id,key" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security-settings"] });
      toast.success("Domínio removido!");
    },
    onError: () => {
      toast.error("Erro ao remover domínio");
    },
  });

  return {
    settings: settings || { restrictEnabled: false, requireApproval: false, allowedDomains: [] },
    isLoading,
    toggleRestriction,
    addDomain,
    removeDomain,
  };
}
