// Envio em lote pelo WhatsApp (DEM-0492).
//
// Abre pelo botão de megafone no cabeçalho "Conversas" do Chat, ao lado de
// Contatos, e segue o desenho da tela de Contatos: lista à esquerda, conteúdo à
// direita, seta para voltar. Só admin e head, e só em empresa com
// `tenants.envio_lote_enabled` (portão da regra "nada fala com cliente antes do
// teste"). A regra de verdade está nas RPCs; aqui a tela só esconde.
import { useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Loader2, Megaphone, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import AccessDenied from "@/pages/AccessDenied";
import { useEnvioLoteAcesso, useEnviosLote } from "@/components/whatsapp/envio-lote/useEnvioLote";
import { NovoEnvioLote } from "@/components/whatsapp/envio-lote/NovoEnvioLote";
import { DetalheEnvioLote, situacaoDoEnvio } from "@/components/whatsapp/envio-lote/DetalheEnvioLote";

export default function WhatsAppEnvioLote() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { pode, mudaRitmo, carregando } = useEnvioLoteAcesso();
  const { data: envios = [], isLoading, isFetching } = useEnviosLote();
  const [busca, setBusca] = useState("");
  // Contador da chave do formulário: "Novo" sempre abre um formulário limpo.
  const [novoKey, setNovoKey] = useState(0);

  const selecionado = params.get("envio");
  const abrir = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("envio", id); else p.delete("envio");
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
            <Button size="sm" className="ml-auto h-8 gap-1.5" onClick={() => { abrir(null); setNovoKey((k) => k + 1); }}>
              <Plus className="h-3.5 w-3.5" /> Novo
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar envios..." value={busca} onChange={(e) => setBusca(e.target.value)} className="h-9 pl-8" />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
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
                <button
                  key={e.id}
                  type="button"
                  onClick={() => abrir(e.id)}
                  className={`flex w-full flex-col gap-1 border-b border-border px-3 py-2.5 text-left hover:bg-muted/60 ${e.id === selecionado ? "bg-muted/60 shadow-[inset_3px_0_0_hsl(var(--primary))]" : ""}`}
                >
                  <span className="truncate text-sm font-semibold">{e.titulo}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.total} destinatários · {format(new Date(e.created_at), "dd/MM HH:mm")}
                  </span>
                  <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${sit.classe}`}>{sit.rotulo}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {envio ? (
          <DetalheEnvioLote envio={envio} />
        ) : selecionado && (isLoading || isFetching) ? (
          // Acabou de criar: a lista ainda está trazendo o envio novo.
          <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <NovoEnvioLote key={novoKey} mudaRitmo={mudaRitmo} onCriado={(id) => abrir(id)} />
        )}
      </div>
    </div>
  );
}
