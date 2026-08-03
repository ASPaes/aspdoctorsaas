import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Image, Film, Music, File } from "lucide-react";

interface Props {
  open: boolean;
  files: File[];
  onCancel: () => void;
  onConfirm: (itens: Array<{ file: File; title: string }>) => void;
}

/**
 * Nome sem a extensão — vira o título sugerido. O arquivo NUNCA é renomeado: file_name
 * continua igual no banco e no Storage; título é só um rótulo por cima.
 */
function semExtensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i > 0 ? nome.slice(0, i) : nome;
}

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function icone(type: string) {
  if (type.startsWith("image")) return <Image className="h-4 w-4 text-muted-foreground" />;
  if (type.startsWith("video")) return <Film className="h-4 w-4 text-muted-foreground" />;
  if (type.startsWith("audio")) return <Music className="h-4 w-4 text-muted-foreground" />;
  if (type.includes("pdf")) return <FileText className="h-4 w-4 text-muted-foreground" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

/**
 * Coleta um título por arquivo antes de subir. Título é OPCIONAL: enviar tudo em branco
 * é caminho válido, e a pessoa completa depois pelo lápis da lista.
 */
export function AttachmentTitlesDialog({ open, files, onCancel, onConfirm }: Props) {
  const [titulos, setTitulos] = useState<string[]>([]);

  // Nasce com o nome do arquivo: a pessoa ajusta se quiser, e ninguém fica sem título por
  // esquecimento. Nova seleção reinicia — reabrir não pode herdar o que foi digitado antes.
  useEffect(() => { setTitulos(files.map((f) => semExtensao(f.name))); }, [files]);

  const confirmar = () =>
    onConfirm(files.map((file, i) => ({ file, title: (titulos[i] ?? "").trim() })));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {files.length === 1 ? "Anexar arquivo" : `Anexar ${files.length} arquivos`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                  {icone(f.type)}
                </div>
                <span className="text-xs truncate min-w-0" title={f.name}>{f.name}</span>
                <span className="text-[11px] text-muted-foreground shrink-0 ml-auto">{tamanho(f.size)}</span>
              </div>
              <Input
                data-titulo="1"
                value={titulos[i] ?? ""}
                onChange={(e) => {
                  const novos = [...titulos];
                  novos[i] = e.target.value;
                  setTitulos(novos);
                }}
                placeholder="Título do anexo"
                className="h-8 text-xs"
                aria-label={`Título de ${f.name}`}
              />
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          O título é só um rótulo para achar o anexo na busca — o nome do arquivo não muda.
        </p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" onClick={confirmar}>
            Enviar{files.length > 1 ? ` ${files.length}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
