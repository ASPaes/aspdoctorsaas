import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Paperclip, Upload, Download, ExternalLink, FileText, Image as ImageIcon,
  Loader2, Trash2, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminLike } from "@/lib/permissions";

export interface ContratoAnexo {
  id: string;
  contrato_id: string;
  tenant_id?: string | null;
  storage_path: string;
  nome_original: string;
  nome_omie?: string | null;
  mime_type: string | null;
  tamanho_bytes: number | null;
  tipo?: string | null;
  omie_status: string | null;
  omie_erro: string | null;
  omie_enviado_em?: string | null;
  created_at?: string | null;
}

/**
 * Controlled: parent passes the rows (already fetched in bulk) plus invalidateKey.
 * Self-fetch: parent only passes contratoId (+ tenantId to allow writes); component
 * queries its own anexo rows and invalidates itself.
 *
 * DEM-0328: um contrato pode ter N documentos ativos (contrato + termos aditivos).
 * Antes disso a lista era um registro só e enviar um arquivo novo apagava o anterior.
 */
interface BaseProps {
  contratoId: string | null;
  tenantId: string | null;
  readOnly?: boolean;
}
interface ControlledProps extends BaseProps {
  anexos: ContratoAnexo[];
  invalidateKey: readonly unknown[];
}
interface SelfFetchProps extends BaseProps {
  anexos?: undefined;
  invalidateKey?: undefined;
}
type Props = ControlledProps | SelfFetchProps;

// ---------- shared helpers (exported for the modal's staged-upload flow) ----------

export const ANEXO_MAX_BYTES = 10 * 1024 * 1024;
export const ANEXO_ACCEPT = "application/pdf,image/jpeg,image/png";
const ACCEPTED_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/jpg"]);
const NOME_OMIE_REGEX = /^[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{1,10}$/;

export const ANEXO_TIPOS = [
  { value: "contrato", label: "Contrato" },
  { value: "aditivo", label: "Termo aditivo" },
  { value: "outro", label: "Outro documento" },
] as const;

export type AnexoTipo = (typeof ANEXO_TIPOS)[number]["value"];

export function anexoTipoLabel(tipo: string | null | undefined): string {
  return ANEXO_TIPOS.find((t) => t.value === tipo)?.label ?? "Contrato";
}

export function validateAnexoFile(file: File): string | null {
  if (!ACCEPTED_MIMES.has(file.type)) return "Formato inválido. Aceito: PDF, JPG, PNG.";
  if (file.size > ANEXO_MAX_BYTES) return "Arquivo muito grande (máximo 10 MB).";
  if (!normalizeNomeOmie(file.name)) return "Nome de arquivo não suportado. Renomeie e tente de novo.";
  return null;
}

export function normalizeNomeOmie(nomeOriginal: string): string | null {
  const i = nomeOriginal.lastIndexOf(".");
  if (i <= 0) return null;
  const ext = nomeOriginal
    .slice(i + 1)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 10);
  const base = nomeOriginal
    .slice(0, i)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 80);
  if (!base || !ext) return null;
  const nome = `${base}.${ext}`;
  return NOME_OMIE_REGEX.test(nome) ? nome : null;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * End-to-end upload: validate → hash → upload to storage → call RPC.
 * On RPC failure the uploaded blob is removed from storage.
 * Reused by both the section (inline upload) and the create-product modal
 * (staged files uploaded right after the RPC that creates the contract).
 *
 * `duplicado` = o mesmo arquivo já está anexado neste contrato. A RPC devolve o id
 * existente em vez de criar linha nova; o blob recém-enviado é apagado aqui, senão o
 * bucket acumularia cópia órfã a cada tentativa.
 */
export async function uploadContratoAnexo(args: {
  contratoId: string;
  tenantId: string;
  file: File;
  tipo?: AnexoTipo;
}): Promise<{ id: string; duplicado: boolean }> {
  const { contratoId, tenantId, file, tipo = "contrato" } = args;
  const err = validateAnexoFile(file);
  if (err) throw new Error(err);

  const nomeOmie = normalizeNomeOmie(file.name)!;
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const ext = nomeOmie.slice(nomeOmie.lastIndexOf(".") + 1);
  const uuid = crypto.randomUUID();
  const path = `${tenantId}/${contratoId}/${uuid}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("contrato-anexos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  const { data, error: rpcErr } = await (supabase.rpc as any)("contrato_anexo_adicionar", {
    p_contrato_id: contratoId,
    p_storage_path: path,
    p_nome_original: file.name,
    p_nome_omie: nomeOmie,
    p_mime_type: file.type,
    p_tamanho_bytes: file.size,
    p_hash_sha256: hash,
    p_tipo: tipo,
  });
  if (rpcErr) {
    await supabase.storage.from("contrato-anexos").remove([path]).catch(() => {});
    throw rpcErr;
  }

  const duplicado = (data as any)?.duplicado === true;
  if (duplicado) {
    await supabase.storage.from("contrato-anexos").remove([path]).catch(() => {});
  }
  return { id: (data as any)?.id as string, duplicado };
}

// ---------- UI helpers ----------

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

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return ""; }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return ""; }
}

function ehPdf(a: ContratoAnexo): boolean {
  return a.mime_type === "application/pdf" || !!a.nome_original?.toLowerCase().endsWith(".pdf");
}

function ehImagem(a: ContratoAnexo): boolean {
  return !!a.mime_type?.startsWith("image/") || /\.(jpe?g|png)$/i.test(a.nome_original ?? "");
}

function omieBadge(status: string | null, erro: string | null, enviadoEm: string | null | undefined) {
  const map: Record<string, { label: string; variant: "secondary" | "default" | "destructive" | "outline"; className?: string }> = {
    pendente:                  { label: "Na fila para o Omie", variant: "secondary" },
    aguardando_contrato_omie:  { label: "Aguardando o contrato existir no Omie", variant: "outline", className: "text-amber-600 border-amber-500/40" },
    enviado:                   { label: "No Omie", variant: "default", className: "bg-emerald-600 hover:bg-emerald-600 text-white" },
    erro:                      { label: "Falha temporária, vai retentar", variant: "outline", className: "text-amber-600 border-amber-500/40" },
    invalido:                  { label: "Falhou definitivamente", variant: "destructive" },
    fora_do_escopo:            { label: "Não sincroniza", variant: "secondary" },
  };
  const info = map[status ?? "pendente"] ?? { label: status ?? "sem status", variant: "secondary" as const };
  const badge = (
    <Badge variant={info.variant} className={info.className}>
      {info.label}
      {status === "enviado" && enviadoEm ? ` · ${fmtDateTime(enviadoEm)}` : null}
    </Badge>
  );
  const tip = (status === "erro" || status === "invalido") ? erro : null;
  if (!tip) return badge;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild><span>{badge}</span></TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-wrap">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function ContratoAnexoSection(props: Props) {
  const { contratoId, tenantId, readOnly = false } = props;
  const controlled = "invalidateKey" in props && props.invalidateKey !== undefined;
  const qc = useQueryClient();
  const { profile } = useAuth();
  const canWrite = !readOnly && isAdminLike(profile) && !!contratoId && !!tenantId;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tipoUpload, setTipoUpload] = useState<AnexoTipo | null>(null);

  // Preview é de UM documento por vez: guardar o id evita abrir o PDF errado
  // quando a lista tem contrato e aditivo lado a lado.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsBlob, setPreviewIsBlob] = useState(false);
  const [previewFallbackUrl, setPreviewFallbackUrl] = useState<string | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);

  const [locallyRemoved, setLocallyRemoved] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<ContratoAnexo | null>(null);
  const [removing, setRemoving] = useState(false);

  // Self-fetch mode: query the active rows for this contract.
  const selfQueryKey = useMemo(
    () => ["contrato_anexos_lista", contratoId] as const,
    [contratoId],
  );
  const selfQuery = useQuery<ContratoAnexo[]>({
    queryKey: selfQueryKey,
    enabled: !controlled && !!contratoId,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await (supabase.from("contrato_anexos" as any) as any)
        .select("id, contrato_id, storage_path, nome_original, nome_omie, mime_type, tamanho_bytes, tipo, omie_status, omie_erro, omie_enviado_em, created_at")
        .eq("contrato_id", contratoId)
        .eq("ativo", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContratoAnexo[];
    },
  });

  const anexosDoPai = (props as ControlledProps).anexos;
  const anexosProprios = selfQuery.data;
  const anexos = useMemo(
    () => ((controlled ? anexosDoPai : anexosProprios) ?? [])
      .filter((a) => !locallyRemoved.includes(a.id))
      .slice()
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [controlled, anexosDoPai, anexosProprios, locallyRemoved],
  );

  const disabled = !contratoId;
  const ios = isIOS();

  // Primeiro documento é o contrato; a partir do segundo o normal é aditivo.
  const tipoEfetivo: AnexoTipo = tipoUpload ?? (anexos.length === 0 ? "contrato" : "aditivo");

  useEffect(() => {
    return () => {
      if (previewIsBlob && previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl, previewIsBlob]);

  const clearPreview = () => {
    if (previewIsBlob && previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewId(null);
    setPreviewUrl(null);
    setPreviewIsBlob(false);
    setPreviewFallbackUrl(null);
  };

  const invalidateAnexos = () => {
    if (controlled) {
      qc.invalidateQueries({ queryKey: (props as ControlledProps).invalidateKey });
    } else {
      qc.invalidateQueries({ queryKey: selfQueryKey });
    }
  };

  const loadPreview = async (anexo: ContratoAnexo) => {
    clearPreview();
    setLoadingPreviewId(anexo.id);
    const { data, error } = await supabase.storage
      .from("contrato-anexos")
      .createSignedUrl(anexo.storage_path, 300);
    if (error || !data?.signedUrl) {
      setLoadingPreviewId(null);
      toast({ title: "Erro ao gerar preview", description: error?.message, variant: "destructive" });
      return;
    }
    if (!ehPdf(anexo)) {
      setPreviewId(anexo.id);
      setPreviewUrl(data.signedUrl);
      setPreviewIsBlob(false);
      setLoadingPreviewId(null);
      return;
    }
    try {
      const res = await fetch(data.signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewId(anexo.id);
      setPreviewUrl(url);
      setPreviewIsBlob(true);
    } catch (err: any) {
      setPreviewId(anexo.id);
      setPreviewFallbackUrl(data.signedUrl);
      toast({
        title: "Não foi possível carregar o preview",
        description: err?.message ?? "Tente abrir em nova aba.",
        variant: "destructive",
      });
    } finally {
      setLoadingPreviewId(null);
    }
  };

  const handleDownload = async (anexo: ContratoAnexo) => {
    const { data, error } = await supabase.storage
      .from("contrato-anexos")
      .createSignedUrl(anexo.storage_path, 60, { download: anexo.nome_original });
    if (error || !data?.signedUrl) {
      toast({ title: "Erro ao baixar", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleOpen = async (anexo: ContratoAnexo) => {
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
    if (!canWrite || uploading) return;
    inputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    if (!contratoId || !tenantId) {
      toast({ title: "Salve o produto para anexar arquivos", variant: "destructive" });
      return;
    }
    setUploading(true);
    const enviados: string[] = [];
    const duplicados: string[] = [];
    const falhas: string[] = [];
    try {
      // Sequencial de propósito: cada arquivo é um hash + um upload + uma RPC, e a
      // dedup por hash só enxerga o que já foi gravado.
      for (const file of files) {
        try {
          const r = await uploadContratoAnexo({ contratoId, tenantId, file, tipo: tipoEfetivo });
          if (r.duplicado) duplicados.push(file.name);
          else enviados.push(file.name);
        } catch (err: any) {
          falhas.push(`${file.name}: ${err?.message ?? String(err)}`);
        }
      }
      if (enviados.length > 0) {
        toast({
          title: enviados.length === 1 ? "Documento anexado" : `${enviados.length} documentos anexados`,
          description: enviados.join(", "),
        });
      }
      if (duplicados.length > 0) {
        toast({
          title: "Arquivo já anexado neste contrato",
          description: duplicados.join(", "),
        });
      }
      if (falhas.length > 0) {
        toast({
          title: "Erro ao enviar anexo",
          description: falhas.join(" · "),
          variant: "destructive",
        });
      }
      setTipoUpload(null);
      invalidateAnexos();
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    const alvo = confirmRemove;
    if (!alvo) return;
    setRemoving(true);
    try {
      const { error } = await (supabase.rpc as any)("contrato_anexo_excluir", {
        p_anexo_id: alvo.id,
      });
      if (error) throw error;
      setLocallyRemoved((prev) => [...prev, alvo.id]);
      if (previewId === alvo.id) clearPreview();
      setConfirmRemove(null);
      toast({ title: "Documento removido", description: "A remoção no Omie será feita pelo cron." });
      invalidateAnexos();
    } catch (err: any) {
      toast({ title: "Erro ao remover documento", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="rounded border bg-background/50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4" />
          Documentos do contrato
          {anexos.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{anexos.length}</Badge>
          )}
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Select
              value={tipoEfetivo}
              onValueChange={(v) => setTipoUpload(v as AnexoTipo)}
              disabled={disabled || uploading}
            >
              <SelectTrigger className="h-8 w-[10.5rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANEXO_TIPOS.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ANEXO_ACCEPT}
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
              {anexos.length > 0 ? "Adicionar documento" : "Enviar arquivo"}
            </Button>
          </div>
        )}
      </div>

      {readOnly && anexos.length > 0 && (
        <p className="text-xs text-amber-600">
          Estes documentos são do contrato, compartilhados com os outros produtos vinculados a ele.
          Para mexer neles, use o painel do produto.
        </p>
      )}

      {disabled ? (
        <p className="text-xs text-muted-foreground">Salve o produto para anexar arquivos.</p>
      ) : anexos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {canWrite
            ? "Nenhum arquivo anexado. Aceito: PDF, JPG, PNG (até 10 MB por arquivo). Pode enviar vários de uma vez."
            : "Nenhum arquivo anexado."}
        </p>
      ) : (
        <div className="space-y-2">
          {anexos.map((anexo) => {
            const isPdf = ehPdf(anexo);
            const isImage = ehImagem(anexo);
            const mostrandoPreview = previewId === anexo.id;
            return (
              <div key={anexo.id} className="rounded border bg-background/60 p-2 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {isPdf ? <FileText className="h-4 w-4 text-primary shrink-0" /> : <ImageIcon className="h-4 w-4 text-primary shrink-0" />}
                  <span className="text-sm font-medium truncate max-w-[22rem]" title={anexo.nome_original}>
                    {anexo.nome_original}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{anexoTipoLabel(anexo.tipo)}</Badge>
                  {anexo.created_at ? (
                    <span className="text-xs text-muted-foreground">{fmtDate(anexo.created_at)}</span>
                  ) : null}
                  {anexo.tamanho_bytes ? (
                    <span className="text-xs text-muted-foreground">{fmtBytes(anexo.tamanho_bytes)}</span>
                  ) : null}
                  {omieBadge(anexo.omie_status, anexo.omie_erro, anexo.omie_enviado_em)}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {isPdf && ios ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => handleOpen(anexo)}>
                      <ExternalLink className="h-4 w-4 mr-1" /> Abrir
                    </Button>
                  ) : mostrandoPreview && previewUrl ? (
                    <Button type="button" variant="outline" size="sm" onClick={clearPreview}>
                      <X className="h-4 w-4 mr-1" /> Fechar preview
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => loadPreview(anexo)}
                      disabled={loadingPreviewId === anexo.id}
                    >
                      {loadingPreviewId === anexo.id
                        ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        : <ExternalLink className="h-4 w-4 mr-1" />}
                      Ver preview
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => handleDownload(anexo)}>
                    <Download className="h-4 w-4 mr-1" /> Baixar
                  </Button>
                  {canWrite && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmRemove(anexo)}
                      disabled={removing}
                      aria-label={`Remover ${anexo.nome_original}`}
                      title="Remover documento"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {mostrandoPreview && previewUrl && !ios && (
                  <div className="rounded border overflow-hidden bg-muted/30">
                    {isImage ? (
                      <img src={previewUrl} alt={anexo.nome_original} className="max-h-96 w-auto mx-auto" />
                    ) : isPdf ? (
                      <iframe src={previewUrl} title={anexo.nome_original} className="w-full h-96" />
                    ) : null}
                  </div>
                )}

                {mostrandoPreview && previewFallbackUrl && !previewUrl && (
                  <div className="rounded border bg-muted/30 p-4 flex items-center gap-3">
                    <FileText className="h-8 w-8 text-muted-foreground shrink-0" />
                    <div className="flex-1 text-sm text-muted-foreground">
                      Não foi possível exibir o preview aqui.
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(previewFallbackUrl, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="h-4 w-4 mr-1" /> Abrir em nova aba
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => { if (!removing && !o) setConfirmRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover documento</AlertDialogTitle>
            <AlertDialogDescription>
              Remover <span className="font-medium">{confirmRemove?.nome_original}</span> deste contrato?
              Ele também será removido do Omie. Os outros documentos continuam anexados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleRemove(); }}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
