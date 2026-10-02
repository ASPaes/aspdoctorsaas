// Envio em lote pelo WhatsApp (DEM-0492).
//
// Abre pelo botão de megafone no cabeçalho "Conversas" do Chat, ao lado de
// Contatos, e segue o desenho da tela de Contatos: lista à esquerda, conteúdo à
// direita, seta para voltar. Só admin e head, e só em empresa com
// `tenants.envio_lote_enabled` (portão da regra "nada fala com cliente antes do
// teste"). A regra de verdade está nas RPCs; aqui a tela só esconde.
import { useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Eye, Loader2, Megaphone, Plus, Repeat, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import AccessDenied from "@/pages/AccessDenied";
import { useEnvioLoteAcesso, useEnviosLote } from "@/components/whatsapp/envio-lote/useEnvioLote";
import { NovoEnvioLote } from "@/components/whatsapp/envio-lote/NovoEnvioLote";
import { PreviaMensagemDialog } from "@/components/whatsapp/envio-lote/PreviaMensagemDialog";
import type { EnvioLote } from "@/components/whatsapp/envio-lote/useEnvioLote";
import { DetalheEnvioLote, situacaoDoEnvio } from "@/components/whatsapp/envio-lote/DetalheEnvioLote";
import { DetalheRecorrente, ListaRecorrentes } from "@/components/whatsapp/envio-lote/PainelRecorrentes";
import { LimitesNumerosDialog, PainelDescadastrados } from "@/components/whatsapp/envio-lote/PainelProtecao";

type Aba = "envios" | "recorrentes" | "descadastrados";

export default function WhatsAppEnvioLote() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { pode, mudaRitmo, carregando } = useEnvioLoteAcesso();
  const { data: envios = [], isLoading, isFetching } = useEnviosLote();
  const [busca, setBusca] = useState("");
  // Contador da chave do formulário: "Novo" sempre abre um formulário limpo.
  const [novoKey, setNovoKey] = useState(0);
  const [previa, setPrevia] = useState<EnvioLote | null>(null);
  const [limites, setLimites] = useState(false);

  const selecionado = params.get("envio");
  const aba = (params.get("aba") as Aba) || "envios";
  const recSelecionada = params.get("rec");
  const abrir = (id: string | null) => {
    const p = new URLSearchParams(params);
    p.delete("aba"); p.delete("rec");
    if (id) p.set("envio", id); else p.delete("envio");
    setParams(p, { replace: true });
  };
  const irPara = (a: Aba, rec?: string | null) => {
    const p = new URLSearchParams();
    if (a !== "envios") p.set("aba", a);
    if (rec) p.set("rec", rec);
    setParams(p, { replace: true });
  };

  if (carregando) {
    return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!pode) return <AccessDenied />;

  const envio = envios.find((e) => e.id === selecionado) || null;
  const filtrados = envios.filter((e) => !busca.trim() || e.titulo.toLowerCase().includes(busca.trim().toLowerCase()));
  const mostrandoNovo = !envio;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-background">
      <div className="hidden w-80 shrink-0 flex-col border-r border-border lg:flex">
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/whatsapp")} aria-label="Voltar ao Chat">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="whitespace-nowrap text-sm font-semibold">Envio em lote</h2>
            <Badge variant="secondary" className="text-[10px]">{envios.length}</Badge>
            <Button size="sm" className="ml-auto h-8 gap-1.5" onClick={() => { irPara("envios"); setNovoKey((k) => k + 1); }}>
              <Plus className="h-3.5 w-3.5" /> Novo
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <div className="inline-flex flex-1 rounded-lg bg-muted p-1 text-xs font-semibold">
              {([["envios", "Envios"], ["recorrentes", "Recorrentes"], ["descadastrados", "Não recebem"]] as [Aba, string][]).map(([id, rot]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => irPara(id)}
                  className={`flex-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] ${aba === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  {rot}
                </button>
              ))}
            </div>
            {mudaRitmo && (
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Proteção dos números (limite por dia)" onClick={() => setLimites(true)}>
                <ShieldCheck className="h-4 w-4" />
              </Button>
            )}
          </div>
          {aba === "envios" && (
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar envios..." value={busca} onChange={(e) => setBusca(e.target.value)} className="h-9 pl-8" />
            </div>
          )}
        </div>
        {aba === "recorrentes" && (
          <div className="flex-1 overflow-auto">
            <ListaRecorrentes selecionada={recSelecionada} onAbrir={(id) => irPara("recorrentes", id)} />
          </div>
        )}
        {aba === "descadastrados" && (
          <div className="flex-1 overflow-auto px-4 py-6 text-center text-sm text-muted-foreground">
            A lista de quem não recebe está à direita.
          </div>
        )}
        <div className={`flex-1 overflow-auto ${aba === "envios" ? "" : "hidden"}`}>
          {mostrandoNovo && (
            <div className="border-b border-border bg-muted/60 px-3 py-2.5 shadow-[inset_3px_0_0_hsl(var(--primary))]">
              <div className="text-sm font-semibold">Novo envio</div>
              <div className="text-xs text-muted-foreground">ainda não enviado</div>
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
          ) : filtrados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
              <Megaphone className="h-8 w-8 opacity-50" />
              Nenhum envio ainda.
            </div>
          ) : (
            filtrados.map((e) => {
              const sit = situacaoDoEnvio(e);
              return (
                <div
                  key={e.id}
                  className={`relative border-b border-border hover:bg-muted/60 ${e.id === selecionado ? "bg-muted/60 shadow-[inset_3px_0_0_hsl(var(--primary))]" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => abrir(e.id)}
                    className="flex w-full flex-col gap-1 px-3 py-2.5 pr-11 text-left"
                  >
                    <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      {e.recurrence_id && <Repeat className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      <span className="truncate">{e.titulo}</span>
                      {e.teste && <Badge variant="secondary" className="shrink-0 text-[10px]">teste</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {e.total} destinatários · {format(new Date(e.created_at), "dd/MM HH:mm")}
                    </span>
                    <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${sit.classe}`}>{sit.rotulo}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute bottom-2 right-2 h-7 w-7"
                    onClick={() => setPrevia(e)}
                    aria-label={`Ver a mensagem de ${e.titulo}`}
                    title="Ver mensagem"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {aba === "recorrentes" ? (
          recSelecionada ? (
            <DetalheRecorrente id={recSelecionada} onApagada={() => irPara("recorrentes")} onAbrirEnvio={(id) => abrir(id)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <Repeat className="h-10 w-10 opacity-40" />
              Escolha um envio recorrente à esquerda. Para criar um, monte um envio e, no passo Revisar, escolha <b>Repetir sempre</b>.
            </div>
          )
        ) : aba === "descadastrados" ? (
          <PainelDescadastrados />
        ) : envio ? (
          <DetalheEnvioLote envio={envio} />
        ) : selecionado && (isLoading || isFetching) ? (
          // Acabou de criar: a lista ainda está trazendo o envio novo.
          <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <NovoEnvioLote
            key={novoKey}
            mudaRitmo={mudaRitmo}
            onCriado={(id) => abrir(id)}
            onRecorrenciaCriada={(id) => irPara("recorrentes", id)}
          />
        )}
      </div>

      <LimitesNumerosDialog aberto={limites} onFechar={() => setLimites(false)} />

      <PreviaMensagemDialog
        aberto={!!previa}
        onFechar={() => setPrevia(null)}
        titulo={previa?.titulo ?? ""}
        subtitulo={previa ? `Mensagem como foi escrita · ${previa.total} destinatários. Cada um recebeu o próprio nome no lugar do destaque.` : undefined}
        conteudo={previa?.content ?? ""}
        arquivo={previa?.media_file_name}
        horario={previa?.created_at}
        modelo
        envioId={previa?.id}
      />
    </div>
  );
}
