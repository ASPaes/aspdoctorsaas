import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plug, ScreenShare, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

interface Conexao {
  chave_prefixo: string;
  conectado_em: string;
  ultimo_uso_at: string | null;
}

/**
 * Integrações → AcessoFast.
 *
 * A chave é gerada no painel do AcessoFast e colada aqui. É ela que amarra a
 * empresa do AcessoFast à empresa do DoctorSaaS: quando eles perguntam de quem é
 * uma conversa, a própria chave diz de qual empresa estão falando.
 *
 * Guardamos só o hash — ao contrário do Omie e do Hiper, esta chave nunca é
 * reenviada a lugar nenhum, só conferida.
 */
export default function AcessoFastIntegrationTab() {
  const { profile } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const tid = effectiveTenantId ?? profile?.tenant_id ?? null;

  const isAdmin = profile?.is_super_admin === true || profile?.role === "admin";
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data: conexao, isLoading } = useQuery<Conexao | null>({
    queryKey: ["acessofast-integration", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("acessofast_integration" as any) as any)
        .select("chave_prefixo, conectado_em, ultimo_uso_at")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return (data as Conexao) ?? null;
    },
  });

  const conectar = async () => {
    if (!tid) return;
    setSalvando(true);
    try {
      const { error } = await (supabase.rpc as any)("acessofast_conectar", {
        p_tenant_id: tid,
        p_chave: chave,
      });
      if (error) throw error;
      setChave("");
      await qc.invalidateQueries({ queryKey: ["acessofast-integration", tid] });
      await qc.invalidateQueries({ queryKey: ["acessofast-access", tid] });
      toast.success("AcessoFast conectado. O botão de acesso remoto já aparece nas conversas.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível conectar.");
    } finally {
      setSalvando(false);
    }
  };

  const desconectar = async () => {
    if (!tid) return;
    setSalvando(true);
    try {
      const { error } = await (supabase.rpc as any)("acessofast_desconectar", { p_tenant_id: tid });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["acessofast-integration", tid] });
      await qc.invalidateQueries({ queryKey: ["acessofast-access", tid] });
      toast.success("AcessoFast desconectado.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível desconectar.");
    } finally {
      setSalvando(false);
    }
  };

  const conectado = !!conexao;

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4" /> Status da conexão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <Badge variant="secondary">Verificando…</Badge>
          ) : conectado ? (
            <>
              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15">
                Conectado
              </Badge>
              <p className="text-sm text-muted-foreground">
                Chave <span className="font-mono">{conexao!.chave_prefixo}</span> · conectada em{" "}
                {new Date(conexao!.conectado_em).toLocaleDateString("pt-BR")}
                {conexao!.ultimo_uso_at
                  ? ` · último uso em ${new Date(conexao!.ultimo_uso_at).toLocaleDateString("pt-BR")}`
                  : " · ainda não usada"}
              </p>
            </>
          ) : (
            <>
              <Badge variant="secondary">Não conectado</Badge>
              <p className="text-sm text-muted-foreground">
                Sem a chave, o botão de acesso remoto não aparece nas conversas.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Chave de Integração
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Cole a chave gerada no painel do AcessoFast. Por segurança, ela nunca é exibida
            novamente depois de salva — para trocar, cole uma nova.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="acessofast-chave">Chave de Integração</Label>
            <Input
              id="acessofast-chave"
              type="password"
              autoComplete="off"
              placeholder={conectado ? "Cole uma nova chave para substituir" : "Cole a chave do AcessoFast"}
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              disabled={!isAdmin || salvando}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={conectar}
              disabled={!isAdmin || salvando || chave.trim().length < 16}
              className="gap-2"
            >
              <ShieldCheck className="h-4 w-4" />
              {conectado ? "Salvar nova chave" : "Salvar e conectar"}
            </Button>
            {conectado && (
              <Button variant="outline" onClick={desconectar} disabled={!isAdmin || salvando}>
                Desconectar
              </Button>
            )}
          </div>

          {!isAdmin && (
            <p className="text-sm text-muted-foreground">
              Só um administrador da empresa pode conectar ou desconectar o AcessoFast.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScreenShare className="h-4 w-4" /> Como funciona
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1.5">
          <p>
            Com a chave conectada, o cabeçalho de cada conversa ganha um botão de acesso remoto.
            Um clique abre o AcessoFast já sabendo de qual cliente é a conversa — sem procurar
            em lista.
          </p>
          <p>
            A resolução usa o cliente vinculado ao contato. Conversa sem cliente vinculado ainda
            pede a escolha manual, uma vez.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
