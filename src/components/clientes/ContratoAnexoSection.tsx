import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Paperclip, Upload, Download, ExternalLink, FileText, Image as ImageIcon,
  Loader2,
} from "lucide-react";

export interface ContratoAnexo {
  id: string;
  contrato_id: string;
  tenant_id: string;
  storage_path: string;
  nome_original: string;
  nome_omie: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  omie_status: string | null;
  omie_erro: string | null;
}

interface Props {
  contratoId: string | null;
  tenantId: string | null;
  anexo?: ContratoAnexo | null;
  invalidateKey: readonly unknown[];
}

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png";
const ACCEPTED_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/jpg"]);

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
}

function fmtBytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeNomeOmie(originalName: string): string {
  const lastDot = originalName.lastIndexOf(".");
  const rawExt = lastDot > 0 ? originalName.slice(lastDot + 1) : "";
  const rawBase = lastDot > 0 ? originalName.slice(0, lastDot) : originalName;

  const clean = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");

  let base = clean(rawBase);
  const ext = clean(rawExt).toLowerCase();
  if (base.length > 80) base = base.slice(0, 80);
  if (!base) base = "arquivo";
  return ext ? `${base}.${ext}` : base;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function omieBadge(status: string | null, erro: string | null) {
  const map: Record<string, { label: string; variant: "secondary" | "default" | "destructive" | "outline"; className?: string }> = {
    pendente: { label: "Aguardando envio", variant: "secondary" },
    aguardando_contrato_omie: { label: "Contrato ainda não existe no Omie", variant: "outline", className: "text-amber-600 border-amber-500/40" },
    enviado: { label: "No Omie", variant: "default", className: "bg-emerald-600 hover:bg-emerald-600 text-white" },
    erro: { label: "Falha no envio", variant: "outline", className: "text-amber-600 border-amber-500/40" },
    invalido: { label: "Falha — precisa de ajuste", variant: "destructive" },
    fora_do_escopo: { label: "Não sincroniza", variant: "secondary" },
  };
  const info = map[status ?? "pendente"] ?? { label: status ?? "—", variant: "secondary" as const };
  const badge = (
    <Badge variant={info.variant} className={info.className}>
      {info.label}
    </Badge>
  );
  const showTip = (status === "erro" || status === "invalido") && !!erro;
  if (!showTip) return badge;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild><span>{badge}</span></TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-wrap">{erro}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function ContratoAnexoSection({ contratoId, tenantId, anexo, invalidateKey }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const disabled = !contratoId;
  const ios = isIOS();
  const isPdf = anexo?.mime_type === "application/pdf" || anexo?.nome_original?.toLowerCase().endsWith(".pdf");
  const isImage = anexo?.mime_type?.startsWith("image/") || /\.(jpe?g|png)$/i.test(anexo?.nome_original ?? "");

  const loadPreview = async () => {
    if (!anexo) return;
    setLoadingPreview(true);
    const { data, error } = await supabase.storage
      .from("contrato-anexos")
      .createSignedUrl(anexo.storage_path, 300);
    setLoadingPreview(false);
    if (error || !data?.signedUrl) {
      toast({ title: "Erro ao gerar preview", description: error?.message, variant: "destructive" });
      return;
    }
    setPreviewUrl(data.signedUrl);
  };

  const handleDownload = async () => {
    if (!anexo) return;
    const { data, error } = await supabase.storage
      .from("contrato-anexos")
      .createSignedUrl(anexo.storage_path, 60, { download: anexo.nome_original });
    if (error || !data?.signedUrl) {
      toast({ title: "Erro ao baixar", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleOpen = async () => {
    if (!anexo) return;
    const { data, error } = await supabase.storage
      .from("contrato-anexos")
      .createSignedUrl(anexo.storage_path, 60);
    if (error || !data?.signedUrl) {
      toast({ title: "Erro ao abrir", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handlePickFile = () => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!contratoId || !tenantId) {
      toast({ title: "Salve o produto para anexar arquivos", variant: "destructive" });
      return;
    }

    if (!ACCEPTED_MIMES.has(file.type)) {
      toast({ title: "Formato inválido", description: "Aceito: PDF, JPG, PNG.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "Arquivo muito grande", description: "Máximo 10 MB.", variant: "destructive" });
      return;
    }

    setUploading(true);
    let uploadedPath: string | null = null;
    try {
      const buffer = await file.arrayBuffer();
      const hash = await sha256Hex(buffer);
      const nomeOmie = normalizeNomeOmie(file.name);
      const lastDot = nomeOmie.lastIndexOf(".");
      const ext = lastDot > 0 ? nomeOmie.slice(lastDot + 1) : "bin";
      const uuid = crypto.randomUUID();
      const path = `${tenantId}/${contratoId}/${uuid}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("contrato-anexos")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      uploadedPath = path;

      const { error: rpcErr } = await (supabase.rpc as any)("contrato_anexo_substituir", {
        p_contrato_id: contratoId,
        p_storage_path: path,
        p_nome_original: file.name,
        p_nome_omie: nomeOmie,
        p_mime_type: file.type,
        p_tamanho_bytes: file.size,
        p_hash_sha256: hash,
      });
      if (rpcErr) throw rpcErr;

      toast({ title: "Anexo enviado", description: file.name });
      setPreviewUrl(null);
      qc.invalidateQueries({ queryKey: invalidateKey });
    } catch (err: any) {
      if (uploadedPath) {
        await supabase.storage.from("contrato-anexos").remove([uploadedPath]).catch(() => {});
      }
      toast({ title: "Erro ao enviar anexo", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded border bg-background/50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4" />
          Anexo do contrato
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePickFile}
            disabled={disabled || uploading}
            title={disabled ? "Salve o produto para anexar arquivos" : undefined}
          >
            {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            {anexo ? "Substituir" : "Enviar arquivo"}
          </Button>
        </div>
      </div>

      {disabled ? (
        <p className="text-xs text-muted-foreground">Salve o produto para anexar arquivos.</p>
      ) : !anexo ? (
        <p className="text-xs text-muted-foreground">
          Nenhum arquivo anexado. Aceito: PDF, JPG, PNG (até 10 MB).
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {isPdf ? <FileText className="h-4 w-4 text-primary" /> : <ImageIcon className="h-4 w-4 text-primary" />}
            <span className="text-sm font-medium truncate max-w-[24rem]" title={anexo.nome_original}>
              {anexo.nome_original}
            </span>
            {anexo.tamanho_bytes ? (
              <span className="text-xs text-muted-foreground">{fmtBytes(anexo.tamanho_bytes)}</span>
            ) : null}
            {omieBadge(anexo.omie_status, anexo.omie_erro)}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isPdf && ios ? (
              <Button type="button" variant="outline" size="sm" onClick={handleOpen}>
                <ExternalLink className="h-4 w-4 mr-1" /> Abrir
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={loadPreview} disabled={loadingPreview}>
                {loadingPreview ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-1" />}
                {previewUrl ? "Recarregar preview" : "Ver preview"}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" /> Baixar
            </Button>
          </div>

          {previewUrl && !ios && (
            <div className="rounded border overflow-hidden bg-muted/30">
              {isImage ? (
                <img src={previewUrl} alt={anexo.nome_original} className="max-h-96 w-auto mx-auto" />
              ) : isPdf ? (
                <iframe src={previewUrl} title={anexo.nome_original} className="w-full h-96" />
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
