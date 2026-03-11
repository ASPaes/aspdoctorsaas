import { useState, useCallback, useEffect, useRef } from "react";

import { UseFormReturn } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Users, Loader2, MessageCircle, X, Search } from "lucide-react";
import { maskCNPJ, maskPhone, maskCPF, maskCEP, normalizePhoneBR } from "@/lib/masks";
import { normalizeBRPhone, isValidBRPhone, formatBRPhone } from "@/lib/phoneBR";
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
  unidadesBase: { id: number; nome: string }[];
  clienteId?: string;
  codigoSequencial?: number | null;
  onNavigate?: (to: string) => void;
}

export default function DadosClienteTab({ form, estados, cidades, areasAtuacao, segmentos, unidadesBase, clienteId, codigoSequencial, onNavigate }: Props) {
  const [contatosOpen, setContatosOpen] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const { toast } = useToast();
  const whatsappValue = form.watch("telefone_whatsapp");

  // Matriz lookup state
  const [matrizSearch, setMatrizSearch] = useState("");
  const [matrizNome, setMatrizNome] = useState<string | null>(null);
  const [matrizSearching, setMatrizSearching] = useState(false);
  const [matrizNotFound, setMatrizNotFound] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Load matriz info when editing existing client with matriz_id
  const matrizId = form.watch("matriz_id");
  useEffect(() => {
    if (!matrizId) {
      setMatrizSearch("");
      setMatrizNome(null);
      return;
    }
    // Fetch the matriz's codigo_sequencial to display in the search field
    (async () => {
      const { data } = await supabase
        .from("clientes")
        .select("codigo_sequencial, razao_social, nome_fantasia")
        .eq("id", matrizId)
        .single();
      if (data) {
        setMatrizSearch(String((data as any).codigo_sequencial ?? ""));
        setMatrizNome((data as any).razao_social || (data as any).nome_fantasia || "");
      }
    })();
  }, [matrizId]);

  const handleMatrizSearch = useCallback(async (codigoSeq: string) => {
    // Limit to 10 characters, digits only
    const cleaned = codigoSeq.replace(/\D/g, "").slice(0, 10);
    setMatrizSearch(cleaned);
    setMatrizNotFound(false);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!cleaned) {
      form.setValue("matriz_id", null);
      setMatrizNome(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setMatrizSearching(true);
      const { data } = await supabase
        .from("clientes")
        .select("id, razao_social, nome_fantasia")
        .eq("codigo_sequencial", Number(cleaned))
        .limit(1)
        .single();
      setMatrizSearching(false);

      if (data) {
        form.setValue("matriz_id", data.id);
        setMatrizNome(data.razao_social || data.nome_fantasia || "");
        setMatrizNotFound(false);
      } else {
        form.setValue("matriz_id", null);
        setMatrizNome(null);
        setMatrizNotFound(true);
      }
    }, 500);
  }, [form]);

  const clearMatriz = useCallback(() => {
    setMatrizSearch("");
    setMatrizNome(null);
    setMatrizNotFound(false);
    form.setValue("matriz_id", null);
  }, [form]);

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

  const handleCnpjChange = useCallback(async (maskedValue: string) => {
    const masked = maskCNPJ(maskedValue);
    form.setValue("cnpj", masked);
    const digits = masked.replace(/\D/g, "");
    if (digits.length !== 14) return;

    setCnpjLoading(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!res.ok) {
        toast({ title: "CNPJ não encontrado", variant: "destructive" });
        return;
      }
      const data = await res.json();

      if (data.razao_social) form.setValue("razao_social", data.razao_social);
      if (data.nome_fantasia) form.setValue("nome_fantasia", data.nome_fantasia);
      if (data.email) form.setValue("email", data.email);

      // Telefone: ddd_telefone_1 vem como "1133334444"
      if (data.ddd_telefone_1) {
        const phoneDig = data.ddd_telefone_1.replace(/\D/g, "");
        if (phoneDig.length >= 10) {
          form.setValue("telefone_contato", maskPhone(phoneDig));
        }
      }

      // Endereço direto
      if (data.logradouro) form.setValue("endereco", data.logradouro);
      if (data.numero) form.setValue("numero", data.numero);
      if (data.bairro) form.setValue("bairro", data.bairro);

      // Estado e cidade
      if (data.uf) {
        const estado = estados.find((e) => e.sigla === data.uf);
        if (estado) {
          form.setValue("estado_id", estado.id);
          if (data.municipio) {
            const { data: cidadesResult } = await supabase
              .from("cidades")
              .select("id")
              .eq("estado_id", estado.id)
              .ilike("nome", data.municipio)
              .limit(1);
            if (cidadesResult && cidadesResult.length > 0) {
              form.setValue("cidade_id", cidadesResult[0].id);
            }
          }
        }
      }

      // CEP por último (dispara auto-fill de endereço se os campos acima não vieram)
      if (data.cep) {
        const cepFormatted = maskCEP(data.cep.toString().replace(/\D/g, ""));
        form.setValue("cep", cepFormatted);
      }

      toast({ title: "Dados do CNPJ preenchidos com sucesso" });
    } catch {
      toast({ title: "Erro ao consultar CNPJ", variant: "destructive" });
    } finally {
      setCnpjLoading(false);
    }
  }, [estados, form, toast]);

  const whatsappDigits = (whatsappValue ?? "").replace(/\D/g, "");
  const canOpenWhatsApp = !!whatsappDigits && !!clienteId;

  const handleOpenWhatsApp = useCallback(() => {
    if (!whatsappDigits || !clienteId || !onNavigate) return;
    const normalizedPhone = normalizeBRPhone(whatsappValue ?? "");
    const clienteName = form.getValues("nome_fantasia") || form.getValues("razao_social") || "";
    onNavigate(`/whatsapp?phone=${normalizedPhone}&clienteId=${clienteId}&clienteName=${encodeURIComponent(clienteName)}`);
  }, [whatsappValue, whatsappDigits, clienteId, form, onNavigate]);

  return (
    <div className="space-y-6">
      {/* ── Dados Cadastrais ── */}
      {/* Linha 1: Cod.Seq | Data Cadastro | Unidade Base | CNPJ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <FormItem>
          <FormLabel>Cód. Seq.</FormLabel>
          <Input
            readOnly
            disabled
            value={codigoSequencial ? String(codigoSequencial) : "Auto"}
            className="bg-muted"
          />
        </FormItem>

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

        <FormField control={form.control} name="cnpj" render={({ field }) => (
          <FormItem>
            <FormLabel>CNPJ *</FormLabel>
            <FormControl>
              <div className="relative">
                <Input
                  placeholder="00.000.000/0000-00"
                  value={field.value ?? ""}
                  onChange={(e) => handleCnpjChange(e.target.value)}
                />
                {cnpjLoading && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      {/* Linha 2: Cod Matriz | Razão Social | Nome Fantasia */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_2fr] gap-4">
        <FormItem>
          <FormLabel>Código Matriz</FormLabel>
          <div className="relative">
            <Input
              placeholder="Cód. da Matriz (Cód Seq)"
              value={matrizSearch}
              maxLength={10}
              onChange={(e) => handleMatrizSearch(e.target.value)}
            />
            {matrizSearching && <Loader2 className="absolute right-8 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
            {matrizSearch && (
              <button
                type="button"
                onClick={clearMatriz}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {matrizNome && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Search className="h-3 w-3" />
              {matrizNome}
            </p>
          )}
          {matrizNotFound && !matrizSearching && (
            <p className="text-xs text-destructive mt-1">Nenhum cliente com este código</p>
          )}
        </FormItem>

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
      </div>

      {/* Restante dos campos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">

        {/* Linha 3: Email (col-span-2) | Telefone Contato */}
        <div className="sm:col-span-2">
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel>Email *</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value.toLowerCase())}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="telefone_contato" render={({ field }) => (
          <FormItem>
            <FormLabel>Telefone Contato</FormLabel>
            <FormControl>
              <Input
                placeholder="+55 (49) 99966-6019"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={() => {
                  if (field.value) {
                    const normalized = normalizeBRPhone(field.value);
                    if (isValidBRPhone(normalized)) {
                      field.onChange(formatBRPhone(normalized));
                    }
                  }
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        {/* Linha 4: Telefone WhatsApp [+btn] | Área Atuação | Segmento */}
        <FormField control={form.control} name="telefone_whatsapp" render={({ field }) => (
          <FormItem>
            <FormLabel>Telefone WhatsApp *</FormLabel>
            <div className="flex gap-2">
              <FormControl>
                <Input
                  placeholder="+55 (49) 99966-6019"
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={() => {
                    if (field.value) {
                      const normalized = normalizeBRPhone(field.value);
                      if (isValidBRPhone(normalized)) {
                        field.onChange(formatBRPhone(normalized));
                      }
                    }
                  }}
                />
              </FormControl>
              {canOpenWhatsApp && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={handleOpenWhatsApp}
                      >
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Abrir conversa no chat</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
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
        <div className="sm:col-span-2 md:col-span-3">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
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
