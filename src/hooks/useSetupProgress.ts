import { useState, useEffect } from 'react';
import { useWhatsAppInstances } from '@/components/whatsapp/hooks/useWhatsAppInstances';
import { useWhatsAppMacros } from '@/components/whatsapp/hooks/useWhatsAppMacros';
import { useAssignmentRules } from '@/components/whatsapp/hooks/useAssignmentRules';
import { Rocket, Zap, Settings as SettingsIcon, BarChart3, UserCircle } from 'lucide-react';

export interface SetupStep {
  id: string;
  category: string;
  title: string;
  description: string;
  icon: any;
  action?: () => void;
  actionLabel?: string;
  completed: boolean;
}

export interface SetupCategory {
  id: string;
  title: string;
  steps: SetupStep[];
  progress: number;
}

const STORAGE_KEY = 'whatsapp-setup-guide-manual';

export const useSetupProgress = () => {
  const { instances } = useWhatsAppInstances();
  const { macros } = useWhatsAppMacros();
  const { rules: assignmentRules } = useAssignmentRules();

  const [manualCompletions, setManualCompletions] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(manualCompletions));
  }, [manualCompletions]);

  const toggleManualCompletion = (stepId: string) => {
    setManualCompletions(prev =>
      prev.includes(stepId)
        ? prev.filter(id => id !== stepId)
        : [...prev, stepId]
    );
  };

  const isManuallyCompleted = (stepId: string) => manualCompletions.includes(stepId);

  const categories: SetupCategory[] = [
    {
      id: 'initial',
      title: 'Configuração Inicial',
      steps: [
        {
          id: 'connect-instance',
          category: 'initial',
          title: 'Conectar instância do WhatsApp',
          description: 'Configure sua primeira instância da Evolution API para começar a receber mensagens.',
          icon: Rocket,
          completed: instances.length > 0 && instances.some(i => i.status === 'connected'),
        },
      ],
      progress: 0,
    },
    {
      id: 'productivity',
      title: 'Produtividade',
      steps: [
        {
          id: 'create-macro',
          category: 'productivity',
          title: 'Criar primeira macro',
          description: 'Configure respostas rápidas para agilizar o atendimento.',
          icon: Zap,
          completed: macros.length > 0,
        },
        {
          id: 'configure-assignment',
          category: 'productivity',
          title: 'Configurar regra de atribuição',
          description: 'Automatize a distribuição de conversas entre os agentes.',
          icon: SettingsIcon,
          completed: assignmentRules.length > 0,
        },
      ],
      progress: 0,
    },
    {
      id: 'explore',
      title: 'Explorar Recursos',
      steps: [
        {
          id: 'visit-reports',
          category: 'explore',
          title: 'Conhecer relatórios',
          description: 'Explore métricas e análises de desempenho da equipe.',
          icon: BarChart3,
          completed: isManuallyCompleted('visit-reports'),
        },
        {
          id: 'visit-contacts',
          category: 'explore',
          title: 'Explorar visualização de contatos',
          description: 'Veja o histórico completo e análises de cada cliente.',
          icon: UserCircle,
          completed: isManuallyCompleted('visit-contacts'),
        },
      ],
      progress: 0,
    },
  ];

  categories.forEach(category => {
    const completedSteps = category.steps.filter(s => s.completed).length;
    category.progress = Math.round((completedSteps / category.steps.length) * 100);
  });

  const allSteps = categories.flatMap(c => c.steps);
  const completedCount = allSteps.filter(s => s.completed).length;
  const totalProgress = Math.round((completedCount / allSteps.length) * 100);

  const resetProgress = () => {
    setManualCompletions([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    categories,
    totalProgress,
    completedCount,
    totalSteps: allSteps.length,
    toggleManualCompletion,
    resetProgress,
  };
};
