import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { PhoneInputBR } from "@/components/ui/PhoneInputBR";
import { normalizeBRPhone, formatBRPhone } from "@/lib/phoneBR";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Users, Loader2, Plus, Pencil, Trash2, Check, X, CircleAlert, ChevronsUpDown, Mail, Phone,
} from "lucide-react";

export interface TrainingForParticipants {
  id: string;
  titulo: string | null;
  ticket_code?: string | null;
  status?: string | null;
}

export interface TrainingParticipant {
  id: string;
  nome: string;
  tipo: string;
  fone: string | null;
  email: string | null;
  presente: boolean | null;
  cliente_contato_id: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  training: TrainingForParticipants | null;
  clienteId: string | null;
  /** "chamada" = abriu para fechar o treino: o rodapé marca como realizado. */
  mode?: "lista" | "chamada";
  onSaved: () => void;
}

const TIPOS = [
  { value: "colaborador", label: "Colaborador" },
  { value: "responsavel_empresa", label: "Responsável da empresa" },
  { value: "outro", label: "Outro" },
];

const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.value, t.label]));

/** Só o responsável da empresa alimenta o indicador do dashboard. */
const TIPO_COR: Record<string, string> = {
  colaborador: "border-border text-muted-foreground",
  responsavel_empresa: "border-[hsl(199_89%_48%)] text-[hsl(199_89%_48%)]",
  outro: "border-border text-muted-foreground",
};

function contatoJaNaLista(lista: TrainingParticipant[], contatoId: string) {
  return lista.some((p) => p.cliente_contato_id === contatoId);
}

export default function TrainingParticipantsDialog({
  open, onOpenChange, training, clienteId, mode = "lista", onSaved,
}: Props) {
  const trainingId = training?.id ?? null;

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("colaborador");
  const [fone, setFone] = useState("");
  const [email, setEmail] = useState("");
  const [contatoId, setContatoId] = useState<string | null>(null);
  const [salvarNoCliente, setSalvarNoCliente] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [marcandoId, setMarcandoId] = useState<string | null>(null);
  const [fechando, setFechando] = useState(false);
  const [buscaOpen, setBuscaOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebouncedValue(busca, 250);

  const participantsQ = useQuery({
    queryKey: ["onboarding-training-participants", trainingId],
    enabled: open && !!trainingId,
    queryFn: async (): Promise<TrainingParticipant[]> => {
      const { data, error } = await (supabase.from("onboarding_training_participants" as any) as any)
        .select("id, nome, tipo, fone, email, presente, cliente_contato_id")
        .eq("training_id", trainingId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TrainingParticipant[];
    },
  });

  const participantes = useMemo(() => participantsQ.data ?? [], [participantsQ.data]);
  const pendentes = participantes.filter((p) => p.presente === null).length;
  const presentes = participantes.filter((p) => p.presente === true).length;
  const jaRealizado = training?.status === "realizado";

  const contatosQ = useQuery({
    queryKey: ["cliente-contatos-treino", clienteId, buscaDebounced],
    enabled: open && buscaOpen && !!clienteId,
    queryFn: async () => {
      let q = (supabase.from("cliente_contatos" as any) as any)
        .select("id, nome, cargo, fone, email")
        .eq("cliente_id", clienteId)
        .order("nome", { ascending: true })
        .limit(20);
      if (buscaDebounced.trim()) q = q.ilike("nome", `%${buscaDebounced.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; cargo: string | null; fone: string | null; email: string | null }>;
    },
  });

  function limparForm() {
    setEditId(null);
    setNome("");
    setTipo("colaborador");
    setFone("");
    setEmail("");
    setContatoId(null);
    setSalvarNoCliente(true);
    setBusca("");
  }

  useEffect(() => {
    if (!open) return;
    limparForm();
    // Sem ninguém na lista, o formulário já abre: é o próximo passo óbvio.
    setFormOpen(false);
  }, [open, trainingId]);

  useEffect(() => {
    if (open && !participantsQ.isLoading && participantes.length === 0) setFormOpen(true);
  }, [open, participantsQ.isLoading, participantes.length]);

  async function salvarParticipante() {
    if (!trainingId) return;
    if (!nome.trim()) {
      toast.error("O participante precisa de um nome");
      return;
    }
    setSalvando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("upsert_onboarding_training_participant", {
        p_training_id: trainingId,
        p_nome: nome.trim(),
        p_tipo: tipo,
        p_fone: fone.trim() ? normalizeBRPhone(fone) : null,
        p_email: email.trim() || null,
        p_participant_id: editId,
        p_cliente_contato_id: contatoId,
        p_salvar_no_cliente: !editId && !contatoId && salvarNoCliente,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) {
        toast.error(
          res.reason === "nome_vazio" ? "O participante precisa de um nome"
            : res.reason === "tipo_invalido" ? "Tipo de participante inválido"
            : res.reason === "treino_excluido" ? "Este treinamento foi excluído."
            : "Não foi possível salvar o participante.",
        );
        return;
      }
      toast.success(editId ? "Participante atualizado" : "Participante adicionado");
      limparForm();
      setFormOpen(false);
      participantsQ.refetch();
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar o participante");
    } finally {
      setSalvando(false);
    }
  }

  async function removerParticipante(id: string) {
    try {
      const { error } = await (supabase.rpc as any)("delete_onboarding_training_participant", {
        p_participant_id: id,
      });
      if (error) throw error;
      toast.success("Participante removido");
      if (editId === id) limparForm();
      participantsQ.refetch();
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover o participante");
    }
  }

  /** Clicar no estado que já está marcado volta para "não informado". */
  async function marcarPresenca(id: string, atual: boolean | null, valor: boolean) {
    if (!trainingId) return;
    const novo = atual === valor ? null : valor;
    setMarcandoId(id);
    try {
      const { data, error } = await (supabase.rpc as any)("set_onboarding_training_attendance", {
        p_training_id: trainingId,
        p_presencas: [{ id, presente: novo }],
      });
      if (error) throw error;
      if ((data as any)?.ok === false) {
        toast.error("Não foi possível registrar a presença.");
        return;
      }
      participantsQ.refetch();
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Erro ao registrar a presença");
    } finally {
      setMarcandoId(null);
    }
  }

  async function marcarRealizado() {
    if (!trainingId) return;
    setFechando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("mark_onboarding_training_realized", {
        p_training_id: trainingId,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) {
        toast.error(
          res.reason === "sem_participantes" ? "Cadastre quem participou antes de fechar o treino."
            : res.reason === "presenca_pendente" ? `Falta marcar a presença de ${res.pendentes} participante(s).`
            : "Este treinamento não pode ser marcado como realizado.",
        );
        return;
      }
      toast.success("Treino marcado como realizado");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao marcar o treino como realizado");
    } finally {
      setFechando(false);
    }
  }

  function editar(p: TrainingParticipant) {
    setEditId(p.id);
    setNome(p.nome);
    setTipo(p.tipo);
    setFone(p.fone ? formatBRPhone(p.fone) : "");
    setEmail(p.email ?? "");
    setContatoId(p.cliente_contato_id);
    setFormOpen(true);
  }

  const titulo = mode === "chamada" ? "Quem participou do treino?" : "Participantes do treino";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-primary" />
            {titulo}
            {training?.ticket_code && (
              <Badge variant="secondary" className="ml-1 font-mono text-[10px]">{training.ticket_code}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {mode === "chamada" && (
            <p className="text-xs text-muted-foreground">
              Marque presente ou faltou para cada pessoa. O treino só é fechado com a chamada inteira respondida.
            </p>
          )}

          {participantsQ.isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando participantes...
            </div>
          ) : participantes.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-6 text-center">
              <p className="text-sm text-muted-foreground">Ninguém cadastrado ainda.</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Escolha entre os contatos do cliente ou digite um nome novo.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-border divide-y divide-border">
              {participantes.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{p.nome}</span>
                      <Badge variant="outline" className={cn("text-[9px]", TIPO_COR[p.tipo] ?? TIPO_COR.outro)}>
                        {TIPO_LABEL[p.tipo] ?? p.tipo}
                      </Badge>
                      {p.presente === null && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(38_92%_50%)]">
                          <CircleAlert className="h-3 w-3" /> sem resposta
                        </span>
                      )}
                    </div>
                    {(p.fone || p.email) && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                        {p.fone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-2.5 w-2.5" /> {formatBRPhone(p.fone)}
                          </span>
                        )}
                        {p.email && (
                          <span className="inline-flex items-center gap-1 truncate">
                            <Mail className="h-2.5 w-2.5" /> {p.email}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant={p.presente === true ? "default" : "outline"}
                      className={cn("h-7 text-[10px] px-2",
                        p.presente === true && "bg-[hsl(142_71%_45%)] hover:bg-[hsl(142_71%_40%)] text-white")}
                      disabled={marcandoId === p.id}
                      onClick={() => marcarPresenca(p.id, p.presente, true)}
                    >
                      <Check className="h-3 w-3 mr-1" /> Presente
                    </Button>
                    <Button
                      size="sm"
                      variant={p.presente === false ? "destructive" : "outline"}
                      className="h-7 text-[10px] px-2"
                      disabled={marcandoId === p.id}
                      onClick={() => marcarPresenca(p.id, p.presente, false)}
                    >
                      <X className="h-3 w-3 mr-1" /> Faltou
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => editar(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => removerParticipante(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!formOpen ? (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { limparForm(); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar participante
            </Button>
          ) : (
            <div className="rounded-md border border-border p-3 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Nome</Label>
                  {editId ? (
                    <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do participante" className="h-9" />
                  ) : (
                    <Popover open={buscaOpen} onOpenChange={setBuscaOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="h-9 w-full justify-between font-normal">
                          <span className={cn("truncate", !nome && "text-muted-foreground")}>
                            {nome || "Buscar contato ou digitar novo"}
                          </span>
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Nome do participante..."
                            value={busca}
                            onValueChange={(v) => { setBusca(v); setNome(v); setContatoId(null); }}
                          />
                          <CommandList>
                            {contatosQ.isFetching && (
                              <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Buscando...
                              </div>
                            )}
                            {!contatosQ.isFetching && (contatosQ.data ?? []).length === 0 && (
                              <CommandEmpty className="py-3 text-xs">
                                {busca.trim()
                                  ? "Nenhum contato do cliente com esse nome — pode seguir com o nome digitado."
                                  : "O cliente ainda não tem contatos cadastrados."}
                              </CommandEmpty>
                            )}
                            <CommandGroup>
                              {(contatosQ.data ?? []).map((c) => {
                                const jaTem = contatoJaNaLista(participantes, c.id);
                                return (
                                  <CommandItem
                                    key={c.id}
                                    value={c.id}
                                    disabled={jaTem}
                                    onSelect={() => {
                                      setNome(c.nome);
                                      setFone(c.fone ? formatBRPhone(c.fone) : "");
                                      setEmail(c.email ?? "");
                                      setContatoId(c.id);
                                      setBusca(c.nome);
                                      setBuscaOpen(false);
                                    }}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm truncate">{c.nome}</div>
                                      {(c.cargo || c.fone) && (
                                        <div className="text-[10px] text-muted-foreground truncate">
                                          {[c.cargo, c.fone ? formatBRPhone(c.fone) : null].filter(Boolean).join(" · ")}
                                        </div>
                                      )}
                                    </div>
                                    {jaTem && <span className="text-[10px] text-muted-foreground ml-2">já na lista</span>}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Tipo</Label>
                  <Select value={tipo} onValueChange={setTipo}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPOS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Fone</Label>
                  <PhoneInputBR value={fone} onChange={setFone} className="h-9" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">E-mail</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nome@empresa.com.br"
                    className="h-9"
                  />
                </div>
              </div>

              {!editId && !contatoId && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={salvarNoCliente}
                    onCheckedChange={(v) => setSalvarNoCliente(v === true)}
                  />
                  <span className="text-xs">
                    Salvar no cadastro do cliente
                    <span className="text-muted-foreground"> — desmarque para quem é de passagem</span>
                  </span>
                </label>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="h-8 text-xs"
                        onClick={() => { limparForm(); setFormOpen(false); }} disabled={salvando}>
                  Cancelar
                </Button>
                <Button size="sm" className="h-8 text-xs" onClick={salvarParticipante} disabled={salvando}>
                  {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  {editId ? "Salvar" : "Adicionar"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            {participantes.length === 0
              ? "Sem participantes"
              : `${participantes.length} ${participantes.length === 1 ? "participante" : "participantes"} · ${presentes} presente${presentes === 1 ? "" : "s"}${pendentes > 0 ? ` · ${pendentes} sem resposta` : ""}`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={fechando}>
              Fechar
            </Button>
            {mode === "chamada" && !jaRealizado && (
              <Button
                size="sm"
                onClick={marcarRealizado}
                disabled={fechando || participantes.length === 0 || pendentes > 0}
              >
                {fechando && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Marcar como realizado
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
