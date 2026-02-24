import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Users } from "lucide-react";
import { maskCNPJ, maskPhone, maskCPF } from "@/lib/masks";
import ContatosAdicionaisModal from "@/components/clientes/ContatosAdicionaisModal";
import type { ClienteFormValues } from "@/pages/ClienteForm";

interface Props {
  form: UseFormReturn<ClienteFormValues>;
  estados: { id: number; nome: string; sigla: string }[];
  cidades: { id: number; nome: string }[];
  areasAtuacao: { id: number; nome: string }[];
  segmentos: { id: number; nome: string }[];
  verticais: { id: number; nome: string }[];
  clienteId?: string;
}

export default function DadosClienteTab({ form, estados, cidades, areasAtuacao, segmentos, verticais, clienteId }: Props) {
  const [contatosOpen, setContatosOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField control={form.control} name="data_cadastro" render={({ field }) => (
          <FormItem>
            <FormLabel>Data Cadastro</FormLabel>
            <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="razao_social" render={({ field }) => (
          <FormItem>
            <FormLabel>Razão Social</FormLabel>
            <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="nome_fantasia" render={({ field }) => (
          <FormItem>
            <FormLabel>Nome Fantasia</FormLabel>
            <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

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

        <FormField control={form.control} name="vertical_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Vertical</FormLabel>
            <Select value={field.value?.toString() ?? ""} onValueChange={(v) => field.onChange(v ? Number(v) : null)}>
              <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
              <SelectContent>
                {verticais.map((v) => (
                  <SelectItem key={v.id} value={v.id.toString()}>{v.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        <div className="md:col-span-2">
          <FormField control={form.control} name="observacao_cliente" render={({ field }) => (
            <FormItem>
              <FormLabel>Observação do Cliente</FormLabel>
              <FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
      </div>

      {/* Contato Principal */}
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
