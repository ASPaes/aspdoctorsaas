import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";

/** Retorno de fn_delete_whatsapp_instance — com p_confirm=false é só contagem, não escreve. */
export interface DeletePreview {
  confirmado: boolean;
  manter_historico: boolean;
  canal: string;
  conversas: number;
  mensagens: number;
  atendimentos: number;
  atendimentos_com_ticket: number;
  contatos_total: number;
  contatos_apagados: number;
  contatos_preservados: number;
  artigos_kb_desvinculados: number;
  grupos: number;
  agendadas: number;
  templates: number;
}

/** O operador escolhe o destino do histórico na hora de excluir o canal. */
export type ModoExclusao = "preservar" | "apagar";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  nomeDoCanal: string;
  pending?: boolean;
  onConfirm: (modo: ModoExclusao) => void;
}

export function DeleteInstanceDialog({
  open,
  onOpenChange,
  instanceId,
  nomeDoCanal,
  pending,
  onConfirm,
}: Props) {
  const [confirmText, setConfirmText] = useState("");
  // Padrão é preservar: perder histórico tem que ser escolha deliberada.
  const [modo, setModo] = useState<ModoExclusao>("preservar");

  const {
    data: preview,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["whatsapp-instance-delete-preview", instanceId],
    enabled: open,
    staleTime: 0,
    retry: false, // sem permissão não melhora repetindo
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_delete_whatsapp_instance", {
        p_instance_id: instanceId,
        p_confirm: false,
      });
      if (error) throw error;
      return data as unknown as DeletePreview;
    },
  });

  const temHistorico =
    !!preview && (preview.conversas > 0 || preview.mensagens > 0 || preview.atendimentos > 0);
  // Digitar o nome só é exigido quando o histórico vai ser destruído de verdade.
  const exigeDigitarNome = temHistorico && modo === "apagar";
  const podeConfirmar =
    !!preview && !isLoading && (!exigeDigitarNome || confirmText.trim() === nomeDoCanal);

  const fechar = (aberto: boolean) => {
    if (!aberto) {
      setConfirmText("");
      setModo("preservar");
    }
    onOpenChange(aberto);
  };

  return (
    <AlertDialog open={open} onOpenChange={fechar}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir o canal {nomeDoCanal}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                O canal e suas credenciais saem do sistema — isso não tem volta. O que acontece com o
                histórico é você quem decide abaixo.
              </p>

              {isLoading && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Levantando o que será apagado…
                </p>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  Não foi possível levantar o que seria apagado:{" "}
                  {(error as any)?.message || "erro desconhecido"}
                  <br />
                  Excluir um canal é permitido só para administradores do tenant.
                </div>
              )}

              {preview && (
                <>
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <p className="mb-1 font-medium">O histórico deste canal hoje:</p>
                    <p>
                      <strong>{preview.conversas}</strong> conversa(s) ·{" "}
                      <strong>{preview.mensagens}</strong> mensagem(ns) ·{" "}
                      <strong>{preview.atendimentos}</strong> atendimento(s) ·{" "}
                      <strong>{preview.contatos_total}</strong> contato(s)
                      {preview.atendimentos_com_ticket > 0 && (
                        <>
                          {" "}
                          — <strong>{preview.atendimentos_com_ticket}</strong> atendimento(s) ligados a
                          ticket
                        </>
                      )}
                    </p>
                  </div>

                  {temHistorico && (
                    <div className="space-y-2">
                      <Label>O que fazer com esse histórico?</Label>
                      <RadioGroup
                        value={modo}
                        onValueChange={(v) => {
                          setModo(v as ModoExclusao);
                          setConfirmText("");
                        }}
                        className="gap-2"
                      >
                        <label
                          htmlFor="modo-preservar"
                          className="flex cursor-pointer gap-3 rounded-md border p-3 hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                        >
                          <RadioGroupItem value="preservar" id="modo-preservar" className="mt-0.5" />
                          <div className="space-y-1 text-sm">
                            <p className="font-medium">Manter o histórico</p>
                            <p className="text-muted-foreground">
                              As conversas, mensagens e contatos continuam no sistema, sem canal.
                              Consequências:
                            </p>
                            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                              <li>
                                Elas <strong>só aparecem com o filtro em “Todos os canais”</strong> — some
                                ao filtrar por um canal específico, e saem dos relatórios por canal.
                              </li>
                              <li>
                                Se alguém responder numa dessas conversas, a mensagem sai por{" "}
                                <strong>outro número</strong> — o sistema cai no primeiro canal conectado
                                do tenant.
                              </li>
                            </ul>
                          </div>
                        </label>

                        <label
                          htmlFor="modo-apagar"
                          className="flex cursor-pointer gap-3 rounded-md border p-3 hover:bg-muted/50 has-[[data-state=checked]]:border-destructive has-[[data-state=checked]]:bg-destructive/5"
                        >
                          <RadioGroupItem value="apagar" id="modo-apagar" className="mt-0.5" />
                          <div className="space-y-1 text-sm">
                            <p className="font-medium text-destructive">Apagar o histórico junto</p>
                            <p className="text-muted-foreground">
                              Some tudo, <strong>sem backup e sem volta</strong>. Consequências:
                            </p>
                            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                              <li>
                                Os <strong>{preview.atendimentos}</strong> atendimento(s) saem dos painéis
                                de SLA e volume, mudando números de períodos já fechados.
                              </li>
                              <li>
                                <strong>{preview.contatos_apagados}</strong> contato(s) que só existem
                                neste canal são apagados
                                {preview.contatos_preservados > 0 && (
                                  <>
                                    ; os outros <strong>{preview.contatos_preservados}</strong> têm
                                    histórico em outros canais e são preservados
                                  </>
                                )}
                                .
                              </li>
                              {preview.atendimentos_com_ticket > 0 && (
                                <li className="text-destructive">
                                  <strong>{preview.atendimentos_com_ticket}</strong> atendimento(s) estão
                                  ligados a ticket — os tickets ficam, mas perdem esse histórico.
                                </li>
                              )}
                              {preview.artigos_kb_desvinculados > 0 && (
                                <li>
                                  <strong>{preview.artigos_kb_desvinculados}</strong> artigo(s) da base de
                                  conhecimento são mantidos, só perdem o vínculo com o atendimento.
                                </li>
                              )}
                            </ul>
                          </div>
                        </label>
                      </RadioGroup>
                    </div>
                  )}

                  {(preview.grupos > 0 || preview.templates > 0 || preview.agendadas > 0) && (
                    <p className="text-xs text-muted-foreground">
                      Nos dois casos saem junto, porque pertencem ao canal:{" "}
                      {[
                        preview.grupos > 0 && `${preview.grupos} grupo(s)`,
                        preview.templates > 0 && `${preview.templates} template(s)`,
                        preview.agendadas > 0 && `${preview.agendadas} agendamento(s) ficam sem canal`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      .
                    </p>
                  )}

                  {exigeDigitarNome && (
                    <div className="space-y-2">
                      <Label htmlFor="confirm-delete-canal">
                        Para apagar o histórico, digite <strong>{nomeDoCanal}</strong>:
                      </Label>
                      <Input
                        id="confirm-delete-canal"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={nomeDoCanal}
                        autoComplete="off"
                      />
                    </div>
                  )}

                  {temHistorico && (
                    <p className="text-xs text-muted-foreground">
                      Se você não quer nem remover o canal, cancele e use <strong>Desativar</strong>: ele
                      sai do ar e as credenciais são apagadas, mas o canal continua cadastrado.
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!podeConfirmar || pending}
            onClick={(e) => {
              e.preventDefault();
              if (podeConfirmar) onConfirm(modo);
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {!temHistorico
              ? "Excluir canal"
              : modo === "apagar"
                ? "Excluir canal e histórico"
                : "Excluir canal, manter histórico"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
