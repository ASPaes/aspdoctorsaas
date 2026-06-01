import { Stethoscope } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { DiagnosticoInlineCard } from './DiagnosticoInlineCard';
import type { Diagnostico } from '@/lib/diagnostico';

interface DiagnosticoSectionProps {
  diagnostico: Diagnostico;
  onSeeMore: () => void;
  tvMode?: boolean;
  className?: string;
}

/**
 * Wrapper visual da seção de Diagnóstico para todas as abas do dashboard.
 * Combina o `SectionHeader` padrão do projeto com o `DiagnosticoInlineCard`.
 *
 * Renderiza apenas quando severity !== 'ok' (estado saudável omite a seção).
 */
export function DiagnosticoSection({
  diagnostico,
  onSeeMore,
  tvMode = false,
  className,
}: DiagnosticoSectionProps) {
  if (diagnostico.severity === 'ok') return null;

  const iconSize = tvMode ? 'h-6 w-6' : 'h-5 w-5';

  return (
    <section className={className}>
      <SectionHeader
        title="Conselho DOCTOR SAAS"
        description="Diagnóstico automatizado da saúde do seu negócio"
        icon={<Stethoscope className={`${iconSize} text-primary`} />}
        tvMode={tvMode}
      />
      <DiagnosticoInlineCard
        diagnostico={diagnostico}
        onSeeMore={onSeeMore}
      />
    </section>
  );
}
