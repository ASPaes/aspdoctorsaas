import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

/**
 * Shim: `use-toast` do shadcn reescrito sobre o Sonner (13/08/2026).
 *
 * O projeto tinha DOIS toasters montados no mesmo canto — o do Radix e o do
 * Sonner. Em vez de migrar os 48 arquivos que importam este hook, o hook passa a
 * delegar: quem chama continua escrevendo `toast({ title, description, variant })`
 * e o aviso sai pelo Sonner, com empilhamento e limite únicos.
 *
 * Superfície medida no repo antes da troca: title, description e
 * variant="destructive". Ninguém usa `action`, o array `toasts`, nem o retorno de
 * `toast()` — por isso o retorno aqui é só o id do Sonner.
 */
export type ToastVariant = "default" | "destructive";

export type ToastInput = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  duration?: number;
};

export function toast({ title, description, variant, duration }: ToastInput) {
  // Sem título, a descrição vira o texto principal — o Sonner não renderiza um
  // toast só com `description`.
  const message = title !== undefined ? title : description;
  const opts: { description?: ReactNode; duration?: number } = {
    description: title !== undefined ? description : undefined,
  };
  if (duration !== undefined) opts.duration = duration;

  return variant === "destructive"
    ? sonnerToast.error(message, opts)
    : sonnerToast(message, opts);
}

export function useToast() {
  return {
    toast,
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  };
}
