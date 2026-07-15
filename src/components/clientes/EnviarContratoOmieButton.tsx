import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Send, Loader2, AlertTriangle } from "lucide-react";

interface Props {
  tenantId: string | null | undefined;
  contratoId: string;
  createdAt: string | null | undefined;
}

const brl = (v: any) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));

const fmtDate = (v: any) => {
  if (!v) return "—";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
};

export default function EnviarContratoOmieButton({ tenantId, contratoId, createdAt }: Props) {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errosOpen, setErrosOpen] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  const [preview, setPreview] = useState<any | null>(null);

  const { data: dataCorte, isLoading: cutoffLoading } = useQuery({
    queryKey: ["omie-data-corte", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("omie_integration" as any) as any)
        .select("integrar_a_partir_de")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data?.integrar_a_partir_de ?? null) as string | null;
    },
  });

  if (cutoffLoading) return null;
  if (!dataCorte) return null;
  if (!createdAt) return null;

  const created = createdAt.slice(0, 10);
  const corte = dataCorte.slice(0, 10);
  if (created < corte) return null;

  const handlePreview = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: {
          acao: "criar_cliente_contrato",
          tenant_id: tenantId,
          modo: "dry_run",
          contrato_id: contratoId,
        },
      });

      let body: any = data ?? null;
      if (error) {
        try {
          body = await (error as any)?.context?.json?.();
        } catch {}
        if (!body) {
          try {
            const txt = await (error as any)?.context?.text?.();
            if (txt) body = JSON.parse(txt);
          } catch {}
        }
      }

      // Mensagens de negócio explícitas
      const mensagens: string[] = [];
      if (body?.error) mensagens.push(String(body.error));
      if (Array.isArray(body?.erros)) mensagens.push(...body.erros.map(String));
      if (Array.isArray(body?.invalidos)) mensagens.push(...body.invalidos.map(String));
      if (body?.aviso) mensagens.push(String(body.aviso));

      if (body?.bloqueado === "cnpj_ambiguo_no_omie") {
        const cands = Array.isArray(body?.candidatos)
          ? body.candidatos
              .map((c: any) => `• ${c?.razao_social ?? "—"} (código ${c?.codigo_cliente_omie ?? "—"})`)
              .join("\n")
          : "";
        setErros([
          "Este CNPJ tem mais de um cadastro no Omie. Resolva a ambiguidade antes de enviar.",
          ...(cands ? [cands] : []),
        ]);
        setErrosOpen(true);
        return;
      }

      if (
        body?.bloqueado === "modelo_nao_permitido" ||
        body?.contrato_dry_run?.bloqueado === "modelo_nao_permitido"
      ) {
        const permitidos = Array.isArray(body?.modelos_permitidos)
          ? ` Modelos permitidos: ${body.modelos_permitidos.join(", ")}.`
          : "";
        toast.error(
          `Este modelo de contrato não está habilitado para envio ao Omie.${permitidos} Ajuste em Padrões Omie.`
        );
        return;
      }

      if (body?.bloqueado === "validacao" || mensagens.length > 0) {
        setErros(mensagens.length > 0 ? mensagens : ["Validação falhou"]);
        setErrosOpen(true);
        return;
      }

      if (error) {
        toast.error("Falha ao preparar o envio. Tente novamente.");
        return;
      }

      if (data?.ok && data?.modo === "dry_run") {
        setPreview(data);
        setConfirmOpen(true);
        return;
      }

      toast.error("Falha ao preparar o envio. Tente novamente.");
    } catch {
      toast.error("Falha ao preparar o envio. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: {
          acao: "criar_cliente_contrato",
          tenant_id: tenantId,
          modo: "criar",
          contrato_id: contratoId,
        },
      });

      if (error) {
        toast.error("Falha ao enviar ao Omie. Tente novamente.");
        return;
      }

      if (data?.ok && data?.etapa === "completo") {
        toast.success("Contrato enviado ao Omie com sucesso.");
        setConfirmOpen(false);
        setPreview(null);
        return;
      }

      if (data?.ok === false && data?.etapa === "cliente") {
        toast.error(
          data?.erro
            ? `Falha ao enviar o cliente ao Omie. O contrato não foi enviado. ${data.erro}`
            : "Falha ao enviar o cliente ao Omie. O contrato não foi enviado."
        );
        return;
      }

      if (data?.ok === false && data?.etapa === "contrato") {
        toast.error(
          "O cliente foi enviado, mas houve falha ao criar o contrato no Omie. Você pode tentar novamente com segurança."
        );
        return;
      }

      toast.error("Falha ao enviar ao Omie. Tente novamente.");
    } catch {
      toast.error("Falha ao enviar ao Omie. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const cli = preview?.cliente_seria_enviado;
  const ctr = preview?.contrato_seria_enviado;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={handlePreview} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
        Enviar ao Omie
      </Button>

      {/* Modal de erros de validação */}
      <Dialog open={errosOpen} onOpenChange={setErrosOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Não é possível enviar este contrato
            </DialogTitle>
            <DialogDescription>
              Corrija os itens abaixo antes de enviar ao Omie.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {erros.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setErrosOpen(false)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de confirmação (preview) */}
      <Dialog open={confirmOpen} onOpenChange={(v) => !loading && setConfirmOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirmar envio ao Omie</DialogTitle>
            <DialogDescription>Confira os dados que serão enviados.</DialogDescription>
          </DialogHeader>

          {preview && (
            <div className="space-y-3 text-sm">
              {preview?.cliente_pendente_no_omie && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                  O cliente será criado/atualizado no Omie antes do contrato.
                </div>
              )}
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Cliente</div>
                <div>
                  <span className="font-medium">{cli?.razao_social ?? "—"}</span>
                </div>
                <div className="text-muted-foreground text-xs">
                  CNPJ/CPF: {cli?.cnpj_cpf ?? "—"}
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Contrato</div>
                <div>
                  <span className="font-medium">Nº {ctr?.numero ?? "—"}</span>
                </div>
                <div>Valor mensal: {brl(ctr?.valor_mensal)}</div>
                <div>
                  Vigência: {fmtDate(ctr?.vigencia_inicial)} até {fmtDate(ctr?.vigencia_final)}
                </div>
                {ctr?.cidade_prestacao && (
                  <div className="text-muted-foreground text-xs">
                    Cidade de prestação: {ctr.cidade_prestacao}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar envio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
