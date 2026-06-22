import { useState } from "react";
import * as XLSX from "xlsx";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSuperTenants } from "@/hooks/useSuperAdmin";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}

interface ParsedItem {
  produto?: string;
  categoria: string;
  subcategoria?: string;
}

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "service_catalog", label: "Catálogo de serviços" },
  { value: "service_types", label: "Tipos de serviço" },
  { value: "segmentos", label: "Segmentos" },
  { value: "areas_atuacao", label: "Áreas de atuação" },
  { value: "motivos_cancelamento", label: "Motivos de cancelamento" },
  { value: "motivos_pausa", label: "Motivos de pausa" },
  { value: "modelos_contrato", label: "Modelos de contrato" },
  { value: "origens_venda", label: "Origens de venda" },
];

export default function NewCatalogTemplateModal({ open, onOpenChange, onCreated }: Props) {
  const [kind, setKind] = useState("service_catalog");
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [saving, setSaving] = useState(false);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");

  const { data: tenants = [] } = useSuperTenants();

  const reset = () => {
    setKind("service_catalog");
    setNome("");
    setDescricao("");
    setParsedItems([]);
    setSelectedTenantId("");
    setSaving(false);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as any[][];
      if (!rows.length) {
        toast.error("Planilha vazia.");
        return;
      }
      const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
      const iProd = header.indexOf("produto");
      const iCat = header.indexOf("categoria");
      const iSub = header.indexOf("subcategoria");
      if (iCat === -1) {
        toast.error("Planilha precisa das colunas: produto, categoria, subcategoria");
        return;
      }
      const items: ParsedItem[] = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] ?? [];
        const categoria = String(row[iCat] ?? "").trim();
        if (!categoria) continue;
        const produto = iProd !== -1 ? String(row[iProd] ?? "").trim() : "";
        const subcategoria = iSub !== -1 ? String(row[iSub] ?? "").trim() : "";
        const item: ParsedItem = { categoria };
        if (produto) item.produto = produto;
        if (subcategoria) item.subcategoria = subcategoria;
        items.push(item);
      }
      setParsedItems(items);
    } catch (err: any) {
      toast.error("Erro ao ler arquivo: " + (err?.message ?? "desconhecido"));
    }
  };

  const distinctProdutos = new Set(parsedItems.map((i) => i.produto).filter(Boolean)).size;
  const distinctCategorias = new Set(parsedItems.map((i) => i.categoria)).size;

  const handleCreateFromFile = async () => {
    if (!nome.trim() || parsedItems.length === 0) return;
    setSaving(true);
    const { data: tpl, error: e1 } = await (supabase.from("catalog_templates" as any) as any)
      .insert({
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        kind: "service_catalog",
        origem: "upload",
        is_published: false,
      })
      .select("id")
      .single();
    if (e1 || !tpl) {
      setSaving(false);
      toast.error("Erro ao criar template: " + (e1?.message ?? ""));
      return;
    }
    const items = parsedItems.map((it, i) => ({
      template_id: tpl.id,
      payload: it,
      sort_order: i,
    }));
    const { error: e2 } = await (supabase.from("catalog_template_items" as any) as any).insert(items);
    setSaving(false);
    if (e2) {
      toast.error("Erro ao inserir itens: " + e2.message);
      return;
    }
    toast.success("Template criado.");
    onCreated();
    handleOpenChange(false);
  };

  const handleCreateFromTenant = async () => {
    if (!nome.trim() || !selectedTenantId) return;
    setSaving(true);
    const rpcName =
      kind === "service_catalog"
        ? "create_catalog_template_from_tenant"
        : "create_simple_template_from_tenant";
    const args: any =
      kind === "service_catalog"
        ? {
            p_source_tenant_id: selectedTenantId,
            p_nome: nome.trim(),
            p_descricao: descricao.trim() || null,
          }
        : {
            p_kind: kind,
            p_source_tenant_id: selectedTenantId,
            p_nome: nome.trim(),
            p_descricao: descricao.trim() || null,
          };
    const { error } = await (supabase as any).rpc(rpcName, args);
    setSaving(false);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success("Template criado a partir do tenant.");
    onCreated();
    handleOpenChange(false);
  };

  const copyFromTenantBlock = (
    <div className="space-y-4 pt-2">
      <div className="space-y-2">
        <Label>Tenant de origem</Label>
        <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um tenant" />
          </SelectTrigger>
          <SelectContent>
            {tenants.map((t: any) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Copia os registros do tenant como estão, incluindo eventuais erros de digitação.
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={handleCreateFromTenant}
          disabled={!nome.trim() || !selectedTenantId || saving}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Criar template
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo template</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v);
                setParsedItems([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-nome">Nome</Label>
            <Input
              id="tpl-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Catálogo contábil padrão"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-desc">Descrição</Label>
            <Textarea
              id="tpl-desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Opcional"
              rows={2}
            />
          </div>

          {kind === "service_catalog" ? (
            <Tabs defaultValue="arquivo">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="arquivo">Arquivo</TabsTrigger>
                <TabsTrigger value="tenant">Copiar de tenant</TabsTrigger>
              </TabsList>
              <TabsContent value="arquivo" className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="tpl-file">Planilha (.xlsx, .xls)</Label>
                  <Input
                    id="tpl-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Cabeçalho esperado: produto, categoria, subcategoria.
                  </p>
                </div>

                {parsedItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {parsedItems.length} linhas · {distinctProdutos} produtos ·{" "}
                      {distinctCategorias} categorias
                    </p>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Produto</TableHead>
                            <TableHead>Categoria</TableHead>
                            <TableHead>Subcategoria</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parsedItems.slice(0, 5).map((it, i) => (
                            <TableRow key={i}>
                              <TableCell>{it.produto ?? "—"}</TableCell>
                              <TableCell>{it.categoria}</TableCell>
                              <TableCell>{it.subcategoria ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={handleCreateFromFile}
                    disabled={!nome.trim() || parsedItems.length === 0 || saving}
                  >
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Criar template
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="tenant">{copyFromTenantBlock}</TabsContent>
            </Tabs>
          ) : (
            copyFromTenantBlock
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
