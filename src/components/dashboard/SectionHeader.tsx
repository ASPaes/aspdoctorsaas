import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
  tvMode?: boolean;
}

export function SectionHeader({ title, description, icon, className, tvMode = false }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center gap-3 pb-2', className)}>
      {icon && (
        <div className="flex items-center justify-center rounded-lg bg-primary/10 p-2">
          {icon}
        </div>
      )}
      <div>
        <h3 className={cn('font-semibold tracking-tight text-foreground', tvMode ? 'text-2xl' : 'text-lg')}>
          {title}
        </h3>
        {description && (
          <p className={cn('text-muted-foreground', tvMode ? 'text-base' : 'text-sm')}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
