import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOemIntegracaoAtiva } from "@/hooks/useOemIntegracaoAtiva";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cpu, Lock, TrendingDown } from "lucide-react";

// ============================================================================
// As licenças do OEM deste cliente.
//
// A mensalidade é do CLIENTE e o custo é da FILIAL: um cliente com três lojas
// paga uma mensalidade e consome três licenças. Por isso a margem aqui é
// mensalidade − SOMA dos custos, e não uma conta por linha.
//
// "Desativado" e "Bloqueado" são dimensões independentes, e a regra comercial
// é do Alexandre: desativado não cobra, bloqueado cobra. O custo total só
// soma as licenças ativas.
// ============================================================================

type Licenca = {
  id: string;
  filial_codigo: string | null;
  empresa_codigo: string | null;
  razao_oem: string | null;
  custo_oem: number | null;
  status_oem: string | null;
  bloqueado_oem: boolean | null;
  mensalidade_ds: number | null;
  status_usuario: string;
  resolvido_em: string | null;
};

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function IntegracaoOemCard({ clienteId }: { clienteId: string }) {
  const { effectiveTenantId: tid } = useTenantFilter();

  // Sem conta OEM conectada o card nem existe — não é para aparecer vazio nos
  // tenants que não usam a integração.
  const temConta = useOemIntegracaoAtiva();

  // A FONTE DA VERDADE DO VÍNCULO É O CÓDIGO NA FICHA DO PRODUTO.
  //
  // Este card lia reconciliacao_oem por ds_customer_id e listava tudo que
  // apontava para o cliente. No grupo Bem Docado isso deu 38 licenças numa
  // ficha só — e, pior, somou o custo do grupo inteiro (R$ 1.028,53) contra a
  // mensalidade de um cliente (R$ 138,02), inventando uma margem de -R$ 890,51
  // que não existe. Ficha de cliente mostrando prejuízo falso é pior que ficha
  // sem informação nenhuma.
  //
  // ds_customer_id é PALPITE do casamento automático por CNPJ; quando o CNPJ do
  // grupo se repete, ele aponta todas as filiais para o mesmo cadastro. O que
  // vale é o par grupo+filial gravado em cliente_produtos, que só é escrito
  // quando não há dúvida.
  const { data: codigos = [] } = useQuery({
    queryKey: ["oem-codigos-cliente", tid, clienteId],
    enabled: !!tid && !!clienteId && temConta === true,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cliente_produtos" as any) as any)
        .select("oem_codigo_filial")
        .eq("cliente_id", clienteId)
        .not("oem_codigo_filial", "is", null);
      if (error) throw error;
      return (data ?? []).map((r: any) => String(r.oem_codigo_filial));
    },
  });

  // Quantas licenças o de/para ainda atribui a este cliente sem confirmação.
  // Não viram lista: viram aviso, porque nenhuma delas é dele com certeza.
  const { data: pendentes = 0 } = useQuery({
    queryKey: ["oem-pendentes-cliente", tid, clienteId],
    enabled: !!tid && !!clienteId && temConta === true && codigos.length === 0,
    queryFn: async () => {
      const { count, error } = await (supabase.from("reconciliacao_oem" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("ds_customer_id", clienteId)
        .not("filial_codigo", "is", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: licencas = [] } = useQuery({
    queryKey: ["oem-licencas-cliente", tid, clienteId, codigos.join(",")],
    enabled: !!tid && !!clienteId && temConta === true && codigos.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("reconciliacao_oem" as any) as any)
        .select(
          "id, filial_codigo, empresa_codigo, razao_oem, custo_oem, status_oem, " +
          "bloqueado_oem, mensalidade_ds, status_usuario, resolvido_em",
        )
        .eq("tenant_id", tid)
        .in("filial_codigo", codigos)
        .order("filial_codigo");
      if (error) throw error;
      return (data ?? []) as Licenca[];
    },
  });

  if (!tid || temConta !== true) return null;

  // Vínculo indefinido: o de/para aponta para cá, mas nenhuma licença foi
  // confirmada. Dizer isso é mais útil do que listar 38 palpites.
  if (codigos.length === 0) {
    if (!pendentes) return null;
    return (
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4" /> Licenças no OEM
            <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/40">
              vínculo indefinido
            </Badge>
          </CardTitle>
          <CardDescription>
            {pendentes === 1
              ? "Uma licença do OEM aponta para este cliente, mas o vínculo não foi confirmado."
              : `${pendentes} licenças do OEM apontam para este cliente — o casamento automático é por CNPJ e, num grupo que repete o CNPJ, ele aponta todas para o mesmo cadastro.`}{" "}
            Enquanto isso não for resolvido em <strong>Configurações › Integrações › OEM ›
            Pendências</strong>, nenhuma delas é dada como deste cliente, e nenhum custo é
            atribuído a ele aqui.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (licencas.length === 0) return null;

  const ativas = licencas.filter((l) => l.status_oem === "Ativo");
  const custo = ativas.reduce((a, l) => a + Number(l.custo_oem || 0), 0);
  const mensalidade = Number(licencas[0]?.mensalidade_ds || 0);
  const margem = mensalidade - custo;
  const bloqueadas = ativas.filter((l) => l.bloqueado_oem).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" /> Licenças no OEM
          <Badge variant="secondary">{licencas.length}</Badge>
          {bloqueadas > 0 && (
            <Badge variant="destructive" className="gap-1">
              <Lock className="h-3 w-3" /> {bloqueadas} bloqueada{bloqueadas > 1 ? "s" : ""}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Custo das ativas: <strong className="tabular-nums">{brl(custo)}</strong></span>
          <span>Mensalidade: <strong className="tabular-nums">{brl(mensalidade)}</strong></span>
          <span className={margem < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}>
            Margem: <strong className="tabular-nums">{brl(margem)}</strong>
            {margem < 0 && <TrendingDown className="inline h-3.5 w-3.5 ml-1" />}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y border-t">
          {licencas.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">{l.razao_oem ?? `Filial ${l.filial_codigo}`}</p>
                <p className="text-xs text-muted-foreground">
                  filial {l.filial_codigo} · grupo {l.empresa_codigo}
                  {/* `status_usuario = 'vinculado'` também é o que a
                      sincronização grava no casamento automático — o que separa
                      a decisão humana é o carimbo de quem e quando. */}
                  {l.resolvido_em && " · vinculada à mão"}
                </p>
              </div>
              {l.bloqueado_oem && <Badge variant="destructive" className="text-xs">bloqueada</Badge>}
              <Badge variant={l.status_oem === "Ativo" ? "secondary" : "outline"} className="text-xs">
                {l.status_oem ?? "—"}
              </Badge>
              <span className="tabular-nums text-muted-foreground w-24 text-right">
                {l.status_oem === "Ativo" ? brl(l.custo_oem) : "—"}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
