import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Anexo } from "./tipos";

/**
 * Arquivos do chat interno. Upload direto para o Storage não funciona neste
 * projeto: a edge function `equipe-anexos` confere se a pessoa participa da
 * conversa e devolve um link assinado; o navegador sobe por ele.
 */

export const LIMITE_BYTES = 25 * 1024 * 1024;
// mesma lista da edge function equipe-anexos (lá é quem manda; aqui só evita gastar o upload)
const BLOQUEADAS = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "mjs", "jar", "sh", "apk", "dll", "reg", "lnk", "hta",
  "html", "htm", "xhtml", "svg", "svgz", "xml", "mht", "mhtml"]);

export const ehImagem = (mime: string) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(mime);

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Motivo para recusar antes de gastar upload, ou null se o arquivo pode ir. */
export function motivoRecusa(f: File): string | null {
  const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
  if (BLOQUEADAS.has(ext)) return `${f.name}: esse tipo de arquivo não é aceito`;
  if (f.size > LIMITE_BYTES) return `${f.name}: o limite é 25 MB por arquivo`;
  return null;
}

/** Print colado vem como "image.png": dá um nome que diga o que é. */
export function nomeDoColado(f: File): string {
  if (f.name && f.name !== "image.png") return f.name;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `print-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

async function dimensoes(f: File): Promise<{ largura?: number; altura?: number }> {
  if (!ehImagem(f.type)) return {};
  try {
    const bmp = await createImageBitmap(f);
    const r = { largura: bmp.width, altura: bmp.height };
    bmp.close();
    return r;
  } catch {
    return {};
  }
}

async function chamar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("equipe-anexos", { body });
  if (error) {
    // a function devolve { error } em português; o invoke embrulha num FunctionsHttpError
    const ctx = (error as { context?: Response }).context;
    const msg = ctx ? await ctx.json().then((j) => j?.error).catch(() => null) : null;
    throw new Error(msg || "Não foi possível enviar o arquivo. Tente de novo.");
  }
  return data as T;
}

/** Sobe um arquivo para a conversa e devolve o anexo pronto para a mensagem. */
export async function subirArquivo(canalId: string, arquivo: File, nome = arquivo.name): Promise<Anexo> {
  const mime = arquivo.type || "application/octet-stream";
  const { arquivos } = await chamar<{ arquivos: { path: string; token: string }[] }>({
    acao: "enviar", canalId, arquivos: [{ nome, mime, tamanho: arquivo.size }],
  });
  const { path, token } = arquivos[0];
  const { error } = await supabase.storage.from("equipe-anexos").uploadToSignedUrl(path, token, arquivo, { contentType: mime });
  if (error) throw new Error(`${nome}: o envio falhou. Tente de novo.`);
  return { path, nome, mime, tamanho: arquivo.size, ...(await dimensoes(arquivo)) };
}

const BASE = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");

/**
 * Links de leitura dos anexos de uma mensagem. Valem 1 hora; relê aos 50 min.
 * A function só entrega arquivo de mensagem viva de conversa que a pessoa vê.
 */
export function useLinksDosAnexos(anexos: Anexo[] | null | undefined) {
  const paths = (anexos ?? []).map((a) => a.path).filter(Boolean);
  return useQuery({
    queryKey: ["equipe", "anexo-links", paths.join("|")],
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    refetchInterval: 50 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { urls } = await chamar<{ urls: Record<string, string> }>({ acao: "ler", paths });
      const completos: Record<string, string> = {};
      for (const [p, rel] of Object.entries(urls ?? {})) completos[p] = `${BASE}${rel}`;
      return completos;
    },
  });
}

/** Link que força o download com o nome original do arquivo. */
export const linkDeDownload = (url: string, nome: string) =>
  `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(nome)}`;
