import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, X } from 'lucide-react';
import {
  normalizarTelefone,
  useSalvarPortaoDaRegua,
  type FinReguaEstado,
} from '@/hooks/useFinRegua';

/**
 * A chave que faz o robô falar com cliente, e a lista de quem recebe antes dela.
 *
 * ⚠️ LIGAR ISTO É A AÇÃO MAIS IRREVERSÍVEL DO MÓDULO. Mensagem de cobrança que
 * sai errada não tem desfazer: o cliente já leu. Por isso ligar pede
 * confirmação escrita e desligar não pede nada — parar tem que ser mais fácil
 * que começar.
 *
 * Enquanto está parada, só os números da lista recebem. É assim que se testa
 * sem alcançar ninguém: põe o seu número, confere a mensagem que chega, e só
 * então vira a chave.
 */
export default function PortaoDaRegua({
  estado,
  temCanal,
}: {
  estado: FinReguaEstado | undefined;
  temCanal: boolean;
}) {
  const salvar = useSalvarPortaoDaRegua();
  const [novoTelefone, setNovoTelefone] = useState('');
  const [confirmando, setConfirmando] = useState(false);

  const telefones = estado?.telefones_teste ?? [];
  const liberada = estado?.liberada === true;

  const adicionar = () => {
    const t = normalizarTelefone(novoTelefone);
    if (t.length < 12) {
      toast.error('Telefone incompleto. Use DDD e número, como 31995418571.');
      return;
    }
    if (telefones.includes(t)) {
      toast.info('Esse número já está na lista.');
      setNovoTelefone('');
      return;
    }
    salvar.mutate(
      { telefones: [...telefones, t] },
      { onSuccess: () => { setNovoTelefone(''); toast.success('Número adicionado'); } },
    );
  };

  const remover = (t: string) =>
    salvar.mutate(
      { telefones: telefones.filter((x) => x !== t) },
      { onSuccess: () => toast.success('Número removido') },
    );

  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="regua-liberada" className="cursor-pointer font-medium">
            Enviar cobrança para os clientes
          </Label>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {liberada
              ? 'Ligada. Todos os clientes com fatura no toque do dia recebem.'
              : 'Desligada. Só os números de teste abaixo recebem.'}
          </p>
        </div>
        <Switch
          id="regua-liberada"
          checked={liberada}
          disabled={salvar.isPending || (!liberada && !temCanal)}
          onCheckedChange={(quer) => {
            // Desligar é imediato: é o freio de mão, e freio não pede licença.
            if (!quer) {
              salvar.mutate({ liberada: false }, {
                onSuccess: () => toast.success('Régua parada. Nenhum cliente recebe.'),
              });
              return;
            }
            setConfirmando(true);
          }}
        />
      </div>

      {!temCanal && !liberada && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-500">
          Escolha o número da cobrança antes de ligar.
        </p>
      )}

      {/* A lista só importa enquanto a régua está parada — depois ela deixa de
          filtrar. Continua à vista de propósito: é o histórico de quem testou. */}
      <div className="mt-4">
        <Label className="text-xs text-muted-foreground">
          {liberada ? 'Números que testaram antes da liberação' : 'Números de teste'}
        </Label>

        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {telefones.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              Nenhum. Com a régua parada e a lista vazia, ninguém recebe nada.
            </span>
          ) : (
            telefones.map((t) => (
              <Badge key={t} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 font-normal">
                {t}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 hover:bg-transparent"
                  title="Remover"
                  onClick={() => remover(t)}
                  disabled={salvar.isPending}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))
          )}
        </div>

        <div className="mt-2 flex max-w-sm gap-2">
          <Input
            id="regua-novo-telefone"
            placeholder="31995418571"
            value={novoTelefone}
            onChange={(e) => setNovoTelefone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); adicionar(); }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={adicionar}
            disabled={salvar.isPending || !novoTelefone.trim()}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar a cobrança para os clientes?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  A partir de agora, todo cliente com fatura no toque do dia recebe mensagem de
                  cobrança pelo número <strong>{estado?.instancia_nome}</strong>, sem pedir.
                </p>
                <p>
                  As mensagens saem uma por vez, só de segunda a sexta entre 07:30 e 19:00, e o
                  sistema confere no Omie se a fatura ainda está em aberto antes de cada envio.
                </p>
                <p className="text-foreground">
                  Mensagem enviada não tem desfazer. Confira antes se você já testou no seu próprio
                  número.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                salvar.mutate({ liberada: true }, {
                  onSuccess: () => toast.success('Régua liberada. Os clientes passam a receber.'),
                })
              }
            >
              Sim, ligar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
