import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, PauseCircle, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  rotuloOffset,
  useApagarToque,
  useFinReguaEstado,
  useFinToques,
  useInstanciasDaRegua,
  useSalvarCanalDaRegua,
  useSalvarToque,
  type FinToque,
} from '@/hooks/useFinRegua';

/**
 * Régua de cobrança — configuração e estado.
 *
 * A tela abre pelo ESTADO, e isso é deliberado: a pergunta de quem chega aqui é
 * "isso está mandando mensagem para cliente?", e a resposta não pode depender
 * de ler o código. Parada é âmbar, liberada é esmeralda.
 *
 * Logo abaixo vem o número por onde a cobrança sai, que é a segunda pergunta.
 * O número oficial da Meta é uma instância como as outras — trocar de um para
 * o outro é trocar essa escolha, nada mais.
 */
export default function ReguaTab() {
  const { data: estado, isLoading: carregandoEstado } = useFinReguaEstado();
  const { data: toques = [], isLoading: carregandoToques } = useFinToques();
  const salvar = useSalvarToque();
  const { data: instancias = [], isLoading: carregandoInstancias } = useInstanciasDaRegua();
  const salvarCanal = useSalvarCanalDaRegua();
  const apagar = useApagarToque();

  const [edicao, setEdicao] = useState<Partial<FinToque> | null>(null);

  const novo = () =>
    setEdicao({ dias_offset: 0, rotulo: '', mensagem: '', template_name: '', ativo: true });

  return (
    <div className="space-y-4">
      {/* Estado do freio, antes de qualquer outra coisa.
          A cor acompanha o estado: âmbar parada, esmeralda liberada. Fixar
          âmbar deixaria o cartão com cara de alerta ao lado do ícone verde
          justamente no dia em que a régua estiver certa. */}
      <Card
        className={
          estado?.liberada
            ? 'border-emerald-300/60 bg-emerald-50/60 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20'
            : 'border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20'
        }
      >
        <div className="flex items-start gap-3">
          {estado?.liberada ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {carregandoEstado
                ? 'Verificando…'
                : estado?.liberada
                  ? 'Régua liberada: mensagens chegam aos clientes'
                  : 'Régua parada: nenhum cliente recebe cobrança automática'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              As mensagens saem pelo número escolhido abaixo, uma por vez e só em horário
              comercial. Enquanto a régua está parada, nada é enviado.
            </p>

            {/* O número por onde a cobrança sai.
                Fica aqui, junto do estado, porque é a primeira pergunta de quem
                vai ligar a régua: "sai por qual número?". O número oficial da
                Meta é uma instância como as outras — trocar de um para o outro
                é trocar esta escolha, nada mais. */}
            <div className="mt-3 max-w-sm">
              <Label htmlFor="regua-canal" className="text-xs text-muted-foreground">
                Número da cobrança
              </Label>
              <Select
                value={estado?.instance_id ?? 'nenhum'}
                onValueChange={(v) => salvarCanal.mutate(v === 'nenhum' ? null : v)}
                disabled={salvarCanal.isPending || carregandoInstancias}
              >
                <SelectTrigger id="regua-canal" className="mt-1 bg-background">
                  <SelectValue placeholder="Escolha o número" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Nenhum — a régua não envia</SelectItem>
                  {instancias.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.instance_name}
                      {i.oficial ? ' · oficial (Meta)' : ''}
                      {!i.is_active ? ' · inativa' : i.status !== 'connected' ? ' · desconectada' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                A régua responde na conversa que o cliente já tem. Este número vale como padrão e
                é o que define se ela manda texto livre ou template aprovado.
              </p>
            </div>

            {!carregandoEstado && (
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Pediram para sair: </span>
                  <span className="font-medium">{estado?.opt_outs ?? 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Já enviadas: </span>
                  <span className="font-medium">{estado?.envios ?? 0}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Os toques */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Toques</h2>
          <p className="text-sm text-muted-foreground">
            Quando falar com o cliente, contado a partir do vencimento da fatura.
          </p>
        </div>
        <Button size="sm" onClick={novo} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Novo toque
        </Button>
      </div>

      {carregandoToques ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : toques.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum toque configurado. A régua não teria o que fazer.
        </Card>
      ) : (
        <div className="space-y-2">
          {toques.map((t) => (
            <Card key={t.id} className={`p-4 ${t.ativo ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={t.dias_offset > 0 ? 'destructive' : 'secondary'}>
                      {rotuloOffset(t.dias_offset)}
                    </Badge>
                    <span className="font-medium">{t.rotulo}</span>
                    {!t.ativo && (
                      <Badge variant="outline" className="text-[10px]">
                        desligado
                      </Badge>
                    )}
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {t.mensagem}
                  </p>

                  <div className="mt-2 text-xs">
                    {t.template_name ? (
                      <span className="text-muted-foreground">
                        Template da Meta: <code className="font-mono">{t.template_name}</code> (
                        {t.template_language})
                      </span>
                    ) : estado?.instancia_modo === 'oficial' ? (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-500">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Sem template. Pelo número oficial este toque não sairia.
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Texto livre</span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" title="Editar toque" onClick={() => setEdicao(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remover toque"
                    onClick={() => {
                      if (confirm(`Remover o toque "${t.rotulo}"?`)) apagar.mutate(t.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!edicao} onOpenChange={(a) => !a && setEdicao(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{edicao?.id ? 'Editar toque' : 'Novo toque'}</DialogTitle>
            <DialogDescription>
              Use {'{cliente}'}, {'{valor}'}, {'{vencimento}'} e {'{documento}'} no texto. Marcador
              que eu não reconheço fica visível na mensagem, para você ver o erro de digitação antes
              do cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="toque-dias">Dias do vencimento</Label>
                <Input
                  id="toque-dias"
                  type="number"
                  value={edicao?.dias_offset ?? 0}
                  disabled={!!edicao?.id}
                  onChange={(e) =>
                    setEdicao((a) => ({ ...a, dias_offset: Number(e.target.value) }))
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Negativo antes, 0 no dia, positivo em atraso.
                  {edicao?.id && ' Não muda depois de criado: é a chave que impede cobrar duas vezes.'}
                </p>
              </div>
              <div>
                <Label htmlFor="toque-rotulo">Nome</Label>
                <Input
                  id="toque-rotulo"
                  value={edicao?.rotulo ?? ''}
                  onChange={(e) => setEdicao((a) => ({ ...a, rotulo: e.target.value }))}
                  placeholder="Aviso antes do vencimento"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="toque-msg">Mensagem</Label>
              <Textarea
                id="toque-msg"
                rows={5}
                value={edicao?.mensagem ?? ''}
                onChange={(e) => setEdicao((a) => ({ ...a, mensagem: e.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="toque-tpl">Template da Meta</Label>
              <Input
                id="toque-tpl"
                value={edicao?.template_name ?? ''}
                onChange={(e) => setEdicao((a) => ({ ...a, template_name: e.target.value }))}
                placeholder="cobranca_aviso_vencimento"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Obrigatório quando a cobrança sai por número oficial: fora da janela de 24h a Meta
                não entrega texto livre.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="toque-ativo"
                checked={edicao?.ativo ?? true}
                onCheckedChange={(v) => setEdicao((a) => ({ ...a, ativo: v }))}
              />
              <Label htmlFor="toque-ativo" className="cursor-pointer">
                Toque ligado
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdicao(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!edicao?.rotulo?.trim() || !edicao?.mensagem?.trim() || salvar.isPending}
              onClick={() => {
                salvar.mutate(edicao!, { onSuccess: () => setEdicao(null) });
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
