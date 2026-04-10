import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  ExternalLink, QrCode, Settings, Copy, Webhook, CheckCircle2,
  Globe, MessageSquare, Shield, Zap, Rocket, ChevronDown, Key, Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";

interface InstanceSetupCollapsibleProps {
  onOpenAddDialog?: () => void;
}

type Provider = 'evolution' | 'zapi' | 'meta';

const evolutionSteps = [
  { id: 1, phase: "evolution", title: "Acessar o Evolution", description: "Acesse a sua instância do Evolution API ou contrate utilizando o Cloudfy.", link: "https://www.cloudfy.host", linkText: "Contratar no Cloudfy", icon: Globe },
  { id: 2, phase: "evolution", title: "Criar uma instância nova", description: "No painel do Evolution, crie uma nova instância para conectar seu WhatsApp.", icon: MessageSquare },
  { id: 3, phase: "evolution", title: "Conectar via QR Code no Evolution", description: "Clique no ícone de engrenagem (⚙️) na instância criada e selecione 'Get QR Code'. Escaneie o QR Code com o WhatsApp.", icon: QrCode },
  { id: 4, phase: "evolution", title: "Ignorar grupos", description: "Acesse Configurations > Settings e ative 'Ignore All Groups' para evitar mensagens de grupos.", icon: Shield },
  { id: 5, phase: "platform", title: "Criar nova instância na plataforma", description: "Na plataforma, clique em 'Nova Instância' e selecione o tipo 'Evolution API Self-Hosted' ou 'Evolution Cloud'.", icon: Zap, showAddInstanceButton: true },
  { id: 6, phase: "platform", title: "Nome de identificação", description: "Adicione o nome que identifique a instância (ex: 'WhatsApp Vendas').", icon: Settings },
  { id: 7, phase: "platform", title: "Nome da instância no Evolution", description: "Adicione o nome exato da instância configurada no Evolution (ex: 'my-instance').", icon: Settings },
  { id: 8, phase: "platform", title: "URL da API", description: "Adicione a URL da API do Evolution (a mesma URL do navegador, sem barra no final).", icon: ExternalLink },
  { id: 9, phase: "platform", title: "Chave da API", description: "Adicione a chave da API (Global API Key). Se usa Cloudfy, encontre em 'Infraestrutura'.", icon: Shield },
  { id: 10, phase: "platform", title: "Salvar configurações", description: "Clique em 'Salvar' para criar a instância na plataforma.", icon: CheckCircle2 },
  { id: 11, phase: "webhook", title: "Copiar URL do Webhook", description: "Copie a URL do Webhook exibida no card da instância criada.", icon: Copy },
  { id: 12, phase: "webhook", title: "Acessar configuração de Webhook", description: "No Evolution, acesse a instância > Events > Webhook.", icon: Webhook },
  { id: 13, phase: "webhook", title: "Configurar Webhook", description: "Ative o Webhook e cole a URL copiada no campo 'Webhook URL'. Ative 'Webhook base 64'.", icon: Settings },
  {
    id: 14, phase: "webhook", title: "Ativar eventos", description: "Ative os seguintes eventos e clique em Salvar.", icon: CheckCircle2,
    showEventsInfo: true, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_DELETE", "SEND_MESSAGE", "CONNECTION_UPDATE"],
  },
  { id: 15, phase: "finalization", title: "Testar conexão", description: "Pronto! Envie uma mensagem pelo WhatsApp conectado e verifique se ela aparece na plataforma.", icon: CheckCircle2 },
];

const zapiSteps = [
  { id: 1, phase: "zapi", title: "Criar conta na Z-API", description: "Acesse o painel da Z-API e crie sua conta ou faça login.", link: "https://app.z-api.io", linkText: "Acessar Z-API", icon: Globe },
  { id: 2, phase: "zapi", title: "Criar uma instância na Z-API", description: "No painel da Z-API, clique em 'Criar instância' e dê um nome para ela.", icon: MessageSquare },
  { id: 3, phase: "zapi", title: "Conectar via QR Code", description: "Na instância criada, clique em 'Conectar' e escaneie o QR Code com o WhatsApp.", icon: QrCode },
  { id: 4, phase: "zapi", title: "Copiar ID da Instância", description: "Copie o 'Instance ID' exibido no painel da instância Z-API.", icon: Copy },
  { id: 5, phase: "zapi", title: "Copiar Token da Instância", description: "Copie o 'Token' exibido no painel da instância Z-API.", icon: Key },
  { id: 6, phase: "zapi", title: "Copiar Client-Token (opcional)", description: "Se disponível, copie o 'Client-Token' de segurança adicional.", icon: Shield },
  { id: 7, phase: "platform", title: "Criar nova instância na plataforma", description: "Na plataforma, clique em 'Nova Instância' e selecione o tipo 'Z-API'.", icon: Zap, showAddInstanceButton: true },
  { id: 8, phase: "platform", title: "Preencher ID e Token", description: "Cole o Instance ID, Token e Client-Token (se houver) nos campos correspondentes.", icon: Settings },
  { id: 9, phase: "platform", title: "Salvar configurações", description: "Clique em 'Salvar' para criar a instância.", icon: CheckCircle2 },
  { id: 10, phase: "webhook", title: "Copiar URL do Webhook", description: "Copie a URL do Webhook exibida no card da instância Z-API criada.", icon: Copy },
  { id: 11, phase: "webhook", title: "Configurar Webhook na Z-API", description: "No painel da Z-API, acesse a instância > Webhooks e cole a URL copiada no campo 'Webhook'.", icon: Webhook },
  { id: 12, phase: "webhook", title: "Ativar eventos na Z-API", description: "Ative os eventos: 'On Message Received' e 'On Message Status'. Salve.", icon: CheckCircle2, showEventsInfo: true, events: ["On Message Received", "On Message Status (delivered/read)"] },
  { id: 13, phase: "finalization", title: "Testar conexão", description: "Envie uma mensagem para o número conectado e verifique se ela aparece na plataforma.", icon: CheckCircle2 },
];

const metaSteps = [
  { id: 1, phase: "meta", title: "Acessar o Meta for Developers", description: "Acesse o portal de desenvolvedores da Meta e faça login com sua conta.", link: "https://developers.facebook.com", linkText: "Acessar Meta for Developers", icon: Globe },
  { id: 2, phase: "meta", title: "Criar um App do tipo Business", description: "Clique em 'Criar App', selecione o tipo 'Business' e conclua a criação.", icon: MessageSquare },
  { id: 3, phase: "meta", title: "Adicionar produto WhatsApp", description: "No painel do App, clique em 'Adicionar produto' e selecione 'WhatsApp'.", icon: Zap },
  { id: 4, phase: "meta", title: "Configurar número de telefone", description: "Em WhatsApp > Configuração da API, adicione e verifique seu número de telefone comercial.", icon: Phone },
  { id: 5, phase: "meta", title: "Copiar Phone Number ID", description: "Copie o 'Phone Number ID' exibido na tela de Configuração da API.", icon: Copy },
  { id: 6, phase: "meta", title: "Gerar Access Token permanente", description: "Em Configurações > Usuários do sistema, crie um Usuário do Sistema, gere um token com permissão 'whatsapp_business_messaging' e copie-o.", icon: Key },
  { id: 7, phase: "meta", title: "Copiar App Secret", description: "Em Configurações > Básico, copie o 'App Secret'. Ele é usado para validar a autenticidade dos webhooks.", icon: Shield },
  { id: 8, phase: "meta", title: "Definir Verify Token", description: "Escolha uma string secreta de sua preferência (ex: 'meu-token-secreto'). Você vai usá-la na plataforma e no Meta.", icon: Key },
  { id: 9, phase: "platform", title: "Criar nova instância na plataforma", description: "Na plataforma, clique em 'Nova Instância' e selecione 'Meta Cloud API (Oficial)'.", icon: Zap, showAddInstanceButton: true },
  { id: 10, phase: "platform", title: "Preencher os campos", description: "Cole o Phone Number ID, Access Token, App Secret e o Verify Token que você definiu.", icon: Settings },
  { id: 11, phase: "platform", title: "Salvar configurações", description: "Clique em 'Salvar' para criar a instância.", icon: CheckCircle2 },
  { id: 12, phase: "webhook", title: "Copiar URL do Webhook", description: "Copie a URL do Webhook Meta exibida no card da instância criada.", icon: Copy },
  { id: 13, phase: "webhook", title: "Configurar Webhook no Meta", description: "Em WhatsApp > Configuração > Webhooks, cole a URL e o Verify Token. Clique em 'Verificar e salvar'.", icon: Webhook },
  { id: 14, phase: "webhook", title: "Assinar campo 'messages'", description: "Após verificar, clique em 'Gerenciar' ao lado do campo 'messages' e ative a assinatura.", icon: CheckCircle2, showEventsInfo: true, events: ["messages"] },
  { id: 15, phase: "finalization", title: "Testar conexão", description: "Envie uma mensagem para o número conectado e verifique se ela aparece na plataforma.", icon: CheckCircle2 },
];

const STORAGE_KEYS: Record<Provider, string> = {
  evolution: 'whatsapp-onboarding-progress',
  zapi: 'zapi-onboarding-progress',
  meta: 'meta-onboarding-progress',
};

const getSteps = (provider: Provider) => {
  if (provider === 'zapi') return zapiSteps;
  if (provider === 'meta') return metaSteps;
  return evolutionSteps;
};

const getPhaseColor = (phase: string) => {
  switch (phase) {
    case "evolution": case "zapi": case "meta": return "bg-blue-500/10 text-blue-600 border-blue-500/20";
    case "platform": return "bg-green-500/10 text-green-600 border-green-500/20";
    case "webhook": return "bg-purple-500/10 text-purple-600 border-purple-500/20";
    case "finalization": return "bg-primary/10 text-primary border-primary/20";
    default: return "";
  }
};

const PROVIDER_LABELS: Record<Provider, string> = {
  evolution: 'Evolution API',
  zapi: 'Z-API',
  meta: 'Meta Cloud API',
};

export const InstanceSetupCollapsible = ({ onOpenAddDialog }: InstanceSetupCollapsibleProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>('evolution');
  const [completedSteps, setCompletedSteps] = useState<number[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.evolution);
    return saved ? JSON.parse(saved) : [];
  });
  const { toast } = useToast();
  const { instances, isLoading: isLoadingInstances } = useWhatsAppInstances();

  const steps = getSteps(provider);

  // Carregar progresso do provider selecionado
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS[provider]);
    setCompletedSteps(saved ? JSON.parse(saved) : []);
  }, [provider]);

  // Salvar progresso
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS[provider], JSON.stringify(completedSteps));
  }, [completedSteps, provider]);

  // Abrir automaticamente se não há instâncias
  useEffect(() => {
    if (!isLoadingInstances && instances.length === 0 && completedSteps.length < steps.length) {
      setIsOpen(true);
    }
  }, [isLoadingInstances, instances.length]);

  // Celebrar conclusão
  useEffect(() => {
    if (completedSteps.length === steps.length && steps.length > 0) {
      toast({ title: "🎉 Parabéns!", description: `Configuração do ${PROVIDER_LABELS[provider]} concluída!` });
    }
  }, [completedSteps.length]);

  const progressPercent = steps.length > 0 ? Math.round((completedSteps.length / steps.length) * 100) : 0;
  const remainingSteps = steps.length - completedSteps.length;

  const toggleStep = (stepId: number) => {
    setCompletedSteps(prev =>
      prev.includes(stepId) ? prev.filter(id => id !== stepId) : [...prev, stepId]
    );
  };

  const handleReset = () => {
    setCompletedSteps([]);
    localStorage.removeItem(STORAGE_KEYS[provider]);
    toast({ title: "Progresso resetado", description: "Todos os passos foram desmarcados." });
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground justify-between h-12">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            <span className="font-semibold">
              {completedSteps.length === steps.length && steps.length > 0
                ? `Configuração ${PROVIDER_LABELS[provider]} Completa! 🎉`
                : `Configurar ${PROVIDER_LABELS[provider]}`}
            </span>
            {remainingSteps > 0 && (
              <span className="text-xs bg-primary-foreground/20 px-2 py-0.5 rounded-full">
                {remainingSteps} passos
              </span>
            )}
          </div>
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isOpen && "transform rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4">
        <div className="rounded-lg border border-border overflow-hidden bg-card">
          {/* Seletor de Provider */}
          <div className="bg-muted/50 p-3 border-b flex gap-2">
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map(p => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  provider === p
                    ? "bg-primary text-primary-foreground"
                    : "bg-background border hover:bg-muted"
                )}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Progresso */}
          <div className="bg-muted p-4 border-b">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Progresso — {PROVIDER_LABELS[provider]}</span>
              <span className="text-sm font-semibold">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>

          {/* Passos */}
          <div className="p-4 max-h-[500px] overflow-y-auto">
            <Accordion type="single" collapsible className="space-y-2">
              {steps.map((step) => {
                const isCompleted = completedSteps.includes(step.id);
                const Icon = step.icon;
                return (
                  <AccordionItem key={`${provider}-${step.id}`} value={`step-${step.id}`} className="border rounded-md">
                    <div className="flex items-start gap-2 px-3 py-2">
                      <Checkbox checked={isCompleted} onCheckedChange={() => toggleStep(step.id)} className="mt-2" />
                      <AccordionTrigger className="flex-1 hover:no-underline py-0">
                        <div className="flex items-center gap-2 text-left w-full">
                          <div className={cn("p-1.5 rounded-md", getPhaseColor(step.phase))}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <span className={cn("text-sm flex-1", isCompleted && "line-through text-muted-foreground")}>
                            {step.title}
                          </span>
                        </div>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent className="px-3 pb-3 pt-0 pl-12">
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
                        {step.link && (
                          <Button variant="outline" size="sm" asChild className="w-full">
                            <a href={step.link} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-2 h-3 w-3" />{step.linkText}
                            </a>
                          </Button>
                        )}
                        {(step as any).showAddInstanceButton && (
                          <Button onClick={() => onOpenAddDialog?.()} size="sm" className="w-full">
                            <Zap className="mr-2 h-3 w-3" />Criar Nova Instância
                          </Button>
                        )}
                        {(step as any).showEventsInfo && (step as any).events && (
                          <div className="p-2 bg-primary/5 border border-primary/20 rounded-md">
                            <div className="text-xs font-medium mb-1">Eventos a ativar:</div>
                            <ul className="text-xs space-y-0.5 text-muted-foreground">
                              {(step as any).events.map((e: string) => (
                                <li key={e}>✓ {e}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>

          {/* Footer */}
          <div className="border-t p-3 bg-muted/50">
            <Button onClick={handleReset} variant="ghost" size="sm" className="w-full text-xs">
              Resetar progresso do {PROVIDER_LABELS[provider]}
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
