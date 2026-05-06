import { useMemo, useState, forwardRef, useId } from "react";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const DEFAULT_PASSWORD_RULES: PasswordRule[] = [
  { id: "min8", label: "Mínimo 8 caracteres", test: (v) => v.length >= 8 },
  { id: "upper", label: "Pelo menos uma letra maiúscula", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "Pelo menos uma letra minúscula", test: (v) => /[a-z]/.test(v) },
  { id: "digit", label: "Pelo menos um número", test: (v) => /\d/.test(v) },
  {
    id: "special",
    label: "Pelo menos um caractere especial (!@#$%...)",
    test: (v) => /[^A-Za-z0-9\s]/.test(v),
  },
];

export function isPasswordValid(value: string, rules: PasswordRule[] = DEFAULT_PASSWORD_RULES) {
  return rules.every((r) => r.test(value));
}

interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  rules?: PasswordRule[];
  showRules?: boolean;
  rulesTitle?: string;
}

/**
 * Input de senha com:
 *  - toggle ver/ocultar
 *  - lista de regras com ✓/✗ em tempo real
 *  - aria-describedby apontando para a lista
 *  - aria-invalid quando alguma regra falha
 *
 * O componente NÃO submete sozinho. Use isPasswordValid(value) no parent
 * para desabilitar o botão de envio até todas as regras passarem.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      value,
      onChange,
      rules = DEFAULT_PASSWORD_RULES,
      showRules = true,
      rulesTitle = "Requisitos da senha:",
      className,
      id,
      ...rest
    },
    ref
  ) => {
    const [show, setShow] = useState(false);
    const reactId = useId();
    const inputId = id ?? `pwd-${reactId}`;
    const rulesId = `${inputId}-rules`;

    const checks = useMemo(
      () => rules.map((r) => ({ ...r, ok: r.test(value) })),
      [rules, value]
    );
    const allOk = checks.every((c) => c.ok);
    const touched = value.length > 0;

    return (
      <div className="space-y-2">
        <div className="relative">
          <Input
            {...rest}
            ref={ref}
            id={inputId}
            type={show ? "text" : "password"}
            value={value}
            onChange={onChange}
            aria-describedby={showRules ? rulesId : undefined}
            aria-invalid={touched && !allOk ? true : undefined}
            className={cn("pr-10", className)}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={show ? "Ocultar senha" : "Mostrar senha"}
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {showRules && (
          <ul id={rulesId} className="space-y-1 text-xs" aria-live="polite">
            <li className="font-medium text-muted-foreground mb-1">{rulesTitle}</li>
            {checks.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "flex items-center gap-2 transition-colors",
                  c.ok ? "text-green-600 dark:text-green-500" : "text-muted-foreground"
                )}
              >
                {c.ok ? (
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{c.label}</span>
                <span className="sr-only">{c.ok ? "atendido" : "não atendido"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
);

PasswordInput.displayName = "PasswordInput";
