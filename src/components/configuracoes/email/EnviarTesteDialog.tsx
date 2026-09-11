import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { EmailAccount, EnvioResultado } from "./useEmailAccounts";

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Conteúdo do e-mail de teste. O assunto leva acento e "·" de propósito: é o
 * caso que quebra montador de mensagem mal feito, então o teste já prova isso.
 */
export function montarEmailDeTeste(conta: EmailAccount) {
  const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return {
    subject: `Teste de envio · configuração da conta ${conta.rotulo}`,
    html: [
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1E293B">`,
      `<p>Olá,</p>`,
      `<p>Se você está lendo esta mensagem, a conta <strong>${escapar(conta.email)}</strong> (${escapar(conta.rotulo)}) está pronta para enviar e-mails pelo DoctorSaaS.</p>`,
      `<p style="font-size:12px;color:#64748B">Enviado em ${quando}, a partir de Configurações › Atendimento › E-mail.</p>`,
      `</div>`,
    ].join(""),
  };
}

export function EnviarTesteDialog({
  conta,
  onOpenChange,
  onEnviar,
  enviando,
}: {
  conta: EmailAccount | null;
  onOpenChange: (open: boolean) => void;
  onEnviar: (para: string) => Promise<EnvioResultado>;
  enviando: boolean;
}) {
  const { user } = useAuth();
  const [para, setPara] = useState("");

  // abre já com o e-mail de quem está logado: é para onde quase todo mundo manda
  useEffect(() => {
    if (conta) setPara(user?.email ?? "");
  }, [conta, user?.email]);

  const enviar = async () => {
    const destino = para.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino)) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    try {
      const r = await onEnviar(destino);
      if (r.ok) {
        toast.success(`${r.mensagem} Confira a caixa de entrada e também o spam.`, { duration: 8000 });
        onOpenChange(false);
      } else {
        toast.error(r.mensagem, { duration: 12000 });
      }
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível enviar o teste.");
    }
  };

  return (
    <Dialog open={!!conta} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar e-mail de teste</DialogTitle>
          <DialogDescription>
            Uma mensagem curta sai por <span className="font-mono">{conta?.email}</span>, para conferir se o e-mail chega
            de verdade.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="teste-para">Enviar para</Label>
          <Input
            id="teste-para"
            type="email"
            value={para}
            onChange={(e) => setPara(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !enviando) enviar();
            }}
            placeholder="voce@suaempresa.com.br"
          />
          <p className="text-xs text-muted-foreground">
            Se não aparecer em alguns minutos, olhe a pasta de spam antes de concluir que falhou.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={enviando}>
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Enviar teste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
