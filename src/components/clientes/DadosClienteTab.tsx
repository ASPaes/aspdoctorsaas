import { useState, useCallback } from "react";
import { UseFormReturn } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Users, Loader2 } from "lucide-react";
import { maskCNPJ, maskPhone, maskCPF, maskCEP } from "@/lib/masks";
import ContatosAdicionaisModal from "@/components/clientes/ContatosAdicionaisModal";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { ClienteFormValues } from "@/pages/ClienteForm";

interface Props {
  form: UseFormReturn<ClienteFormValues>;
  estados: { id: number; nome: string; sigla: string }[];
  cidades: { id: number; nome: string }[];
  areasAtuacao: { id: number; nome: string }[];
  segmentos: { id: number; nome: string }[];
  modelosContrato: { id: number; nome: string }[];
  unidadesBase: { id: number; nome: string }[];
  clienteId?: string;
}

export default function DadosClienteTab({ form, estados, cidades, areasAtuacao, segmentos, modelosContrato, unidadesBase, clienteId }: Props) {
  const [contatosOpen, setContatosOpen] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const { toast } = useToast();

  const handleCepChange = useCallback(async (maskedValue: string) => {
    form.setValue("cep", maskedValue);
    const digits = maskedValue.replace(/\D/g, "");
    if (digits.length !== 8) return;

    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data.erro) {
        toast({ title: "CEP não encontrado", variant: "destructive" });
        return;
      }

      form.setValue("endereco", data.logradouro || "");
      form.setValue("bairro", data.bairro || "");

      const estado = estados.find((e) => e.sigla === data.uf);
      if (estado) {
        form.setValue("estado_id", estado.id);
        const { data: cidadesResult } = await supabase
          .from("cidades")
          .select("id")
          .eq("estado_id", estado.id)
          .ilike("nome", data.localidade)
          .limit(1);
        if (cidadesResult && cidadesResult.length > 0) {
          form.setValue("cidade_id", cidadesResult[0].id);
        }
      }
    } catch {
      toast({ title: "Erro ao consultar CEP", variant: "destructive" });
    } finally {
      setCepLoading(false);
    }
  }, [estados, form, toast]);

  return (
    <div className="space-y-6">
      {/* ── Dados Cadastrais ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Linha 1: Data Cadastro | Unidade Base | Modelo de Contrato */}
        <FormField control={form.control} name="data_cadastro" render={({ field }) => (
          <FormItem>
            <FormLabel>Data Cadastro</FormLabel>
            <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="unidade_base_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Unidade Base</FormLabel>
            <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
              <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
              <SelectContent>
                {unidadesBase.map((u) => (
                  <SelectItem key={u.id} value={u.id.toString()}>{u.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="modelo_contrato_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Modelo de Contrato</FormLabel>
            <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
              <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
              <SelectContent>
                {modelosContrato.map((v) => (
                  <SelectItem key={v.id} value={v.id.toString()}>{v.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        {/* Linha 2: Razão Social (2 cols) | Nome Fantasia (1 col) */}
        <div className="md:col-span-2">
          <FormField control={form.control} name="razao_social" render={({ field }) => (
            <FormItem>
              <FormLabel>Razão Social</FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="nome_fantasia" render={({ field }) => (
          <FormItem>
            <FormLabel>Nome Fantasia</FormLabel>
            <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        {/* Linha 3: CNPJ | Email | Telefone Contato */}
        <FormField control={form.control} name="cnpj" render={({ field }) => (
          <FormItem>
            <FormLabel>CNPJ</FormLabel>
            <FormControl>
              <Input
                placeholder="00.000.000/0000-00"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(maskCNPJ(e.target.value))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl><Input type="email" {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="telefone_contato" render={({ field }) => (
          <FormItem>
            <FormLabel>Telefone Contato</FormLabel>
            <FormControl>
              <Input
                placeholder="(00) 00000-0000"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(maskPhone(e.target.value))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        {/* Linha 4: Telefone WhatsApp | Área de Atuação | Segmento */}
        <FormField control={form.control} name="telefone_whatsapp" render={({ field }) => (
          <FormItem>
            <FormLabel>Telefone WhatsApp</FormLabel>
            <FormControl>
              <Input
                placeholder="(00) 00000-0000"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(maskPhone(e.target.value))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="area_atuacao_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Área de Atuação</FormLabel>
            <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
              <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
              <SelectContent>
                {areasAtuacao.map((a) => (
                  <SelectItem key={a.id} value={a.id.toString()}>{a.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="segmento_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Segmento</FormLabel>
            <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
              <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
              <SelectContent>
                {segmentos.map((s) => (
                  <SelectItem key={s.id} value={s.id.toString()}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        {/* Linha 5: Observação (full width) */}
        <div className="md:col-span-3">
          <FormField control={form.control} name="observacao_cliente" render={({ field }) => (
            <FormItem>
              <FormLabel>Observação do Cliente</FormLabel>
              <FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
      </div>

      {/* ── Endereço ── */}
      <Separator />
      <h3 className="text-sm font-semibold">Endereço</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Linha 1: CEP | Estado | Cidade */}
        <FormField control={form.control} name="cep" render={({ field }) => (
          <FormItem>
            <FormLabel>CEP</FormLabel>
            <FormControl>
              <div className="relative">
                <Input
                  placeholder="00000-000"
                  value={field.value ?? ""}
                  onChange={(e) => handleCepChange(maskCEP(e.target.value))}
                />
                {cepLoading && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="estado_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Estado</FormLabel>
            <Select
              value={field.value?.toString() ?? ""}
              onValueChange={(v) => {
                field.onChange(v ? Number(v) : null);
                form.setValue("cidade_id", null);
              }}
            >
              <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
              <SelectContent>
                {estados.map((e) => (
                  <SelectItem key={e.id} value={e.id.toString()}>{e.sigla} - {e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="cidade_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Cidade</FormLabel>
            <Select
              value={field.value?.toString() ?? ""}
              onValueChange={(v) => field.onChange(v ? Number(v) : null)}
              disabled={!form.watch("estado_id")}
            >
              <FormControl><SelectTrigger><SelectValue placeholder="Selecione o estado primeiro..." /></SelectTrigger></FormControl>
              <SelectContent>
                {cidades.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        {/* Linha 2: Endereço | Número | Bairro */}
        <FormField control={form.control} name="endereco" render={({ field }) => (
          <FormItem>
            <FormLabel>Endereço</FormLabel>
            <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="numero" render={({ field }) => (
          <FormItem>
            <FormLabel>Número</FormLabel>
            <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="bairro" render={({ field }) => (
          <FormItem>
            <FormLabel>Bairro</FormLabel>
            <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      {/* ── Contato Principal ── */}
      <Separator />
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Contato Principal</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!clienteId}
                  onClick={() => setContatosOpen(true)}
                >
                  <Users className="h-4 w-4 mr-1" />
                  Contatos Adicionais
                </Button>
              </span>
            </TooltipTrigger>
            {!clienteId && (
              <TooltipContent>Salve o cliente primeiro</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField control={form.control} name="contato_nome" render={({ field }) => (
          <FormItem>
            <FormLabel>Nome do Contato</FormLabel>
            <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="contato_cpf" render={({ field }) => (
          <FormItem>
            <FormLabel>CPF do Contato</FormLabel>
            <FormControl>
              <Input
                placeholder="000.000.000-00"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(maskCPF(e.target.value))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="contato_fone" render={({ field }) => (
          <FormItem>
            <FormLabel>Fone do Contato</FormLabel>
            <FormControl>
              <Input
                placeholder="(00) 00000-0000"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(maskPhone(e.target.value))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="contato_aniversario" render={({ field }) => (
          <FormItem>
            <FormLabel>Data de Aniversário</FormLabel>
            <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      {clienteId && (
        <ContatosAdicionaisModal
          clienteId={clienteId}
          open={contatosOpen}
          onOpenChange={setContatosOpen}
        />
      )}
    </div>
  );
}
