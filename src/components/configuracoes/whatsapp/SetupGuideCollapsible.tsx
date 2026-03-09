import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { SetupStepCard } from "./SetupStepCard";
import { useSetupProgress } from "@/hooks/useSetupProgress";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Rocket, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ChatTimezoneSelector } from "./ChatTimezoneSelector";

export const SetupGuideCollapsible = () => {
  const {
    categories,
    totalProgress,
    completedCount,
    totalSteps,
    toggleManualCompletion,
    resetProgress,
  } = useSetupProgress();

  const [selectedCategory, setSelectedCategory] = useState(categories[0]?.id || 'initial');
  const navigate = useNavigate();
  const { toast } = useToast();

  const currentCategory = categories.find(c => c.id === selectedCategory);

  const handleStepAction = (stepId: string) => {
    switch (stepId) {
      case 'connect-instance':
        // Already on the instances tab
        break;
      case 'create-macro':
        // Navigate to macros sub-tab handled by parent
        break;
      case 'configure-assignment':
        break;
      case 'visit-reports':
        toggleManualCompletion('visit-reports');
        navigate('/whatsapp/relatorio');
        break;
      case 'visit-contacts':
        toggleManualCompletion('visit-contacts');
        navigate('/whatsapp/contatos');
        break;
    }
  };

  const handleReset = () => {
    resetProgress();
    toast({
      title: "Progresso resetado",
      description: "Todos os passos foram desmarcados.",
    });
  };

  return (
    <div className="space-y-4">
      <ChatTimezoneSelector />
      <div className="w-full bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-3 rounded-md">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          <span className="font-medium">Checklist de configuração</span>
          {completedCount < totalSteps && (
            <span className="text-xs bg-primary-foreground/20 px-2 py-0.5 rounded-full">
              {completedCount}/{totalSteps}
            </span>
          )}
        </div>
      </div>

      <div className="flex border rounded-lg overflow-hidden min-h-[400px]">
        {/* Sidebar */}
        <div className="w-56 border-r border-border bg-muted/30 p-4 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progresso geral</span>
              <span className="font-semibold">{totalProgress}%</span>
            </div>
            <Progress value={totalProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {completedCount} de {totalSteps} passos concluídos
            </p>
          </div>

          <div className="space-y-1">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  selectedCategory === category.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{category.title}</span>
                  <span className={cn(
                    "text-xs",
                    selectedCategory === category.id
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground"
                  )}>
                    {category.progress}%
                  </span>
                </div>
                <Progress
                  value={category.progress}
                  className={cn(
                    "h-1 mt-1",
                    selectedCategory === category.id && "[&>div]:bg-primary-foreground"
                  )}
                />
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="w-full justify-start text-xs"
          >
            <RefreshCw className="mr-2 h-3 w-3" />
            Resetar progresso
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-6 border-b border-border">
            <h3 className="text-lg font-semibold">{currentCategory?.title}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {currentCategory?.steps.filter(s => s.completed).length} de {currentCategory?.steps.length} passos concluídos
            </p>
          </div>

          <ScrollArea className="flex-1 p-6">
            <div className="space-y-3">
              {currentCategory?.steps.map((step) => (
                <SetupStepCard
                  key={step.id}
                  step={{
                    ...step,
                    actionLabel: step.completed ? undefined : getActionLabel(step.id),
                  }}
                  onAction={() => handleStepAction(step.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};

function getActionLabel(stepId: string): string {
  switch (stepId) {
    case 'connect-instance':
      return 'Adicionar Instância';
    case 'create-macro':
      return 'Criar Macro';
    case 'configure-assignment':
      return 'Configurar Regras';
    case 'visit-reports':
      return 'Ver Relatórios';
    case 'visit-contacts':
      return 'Ver Contatos';
    default:
      return 'Iniciar';
  }
}
