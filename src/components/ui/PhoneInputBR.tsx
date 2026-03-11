import * as React from "react";
import { cn } from "@/lib/utils";
import { maskBRPhoneLive, normalizeBRPhone, isValidBRPhone, formatBRPhone } from "@/lib/phoneBR";

export interface PhoneInputBRProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  /** Controlled value — can be raw digits, formatted, or E.164 */
  value: string | null | undefined;
  /** Called with the MASKED display string on every keystroke */
  onChange: (maskedValue: string) => void;
  /** Show validation error below input */
  showError?: boolean;
  /** Custom error message */
  errorMessage?: string;
}

/**
 * Brazilian phone input with live +55 mask, paste support, and validation.
 * Displays: +55 (DD) NNNNN-NNNN
 * Internally works with masked display values; normalize before saving to DB.
 */
const PhoneInputBR = React.forwardRef<HTMLInputElement, PhoneInputBRProps>(
  ({ className, value, onChange, showError, errorMessage, onBlur, ...props }, ref) => {

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const masked = maskBRPhoneLive(raw);
      onChange(masked);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text");
      const masked = maskBRPhoneLive(pasted);
      onChange(masked);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      // On blur, normalize and reformat for consistency
      if (value) {
        const normalized = normalizeBRPhone(value);
        if (isValidBRPhone(normalized)) {
          onChange(formatBRPhone(normalized));
        }
      }
      onBlur?.(e);
    };

    const displayValue = value ?? "";
    const normalized = displayValue ? normalizeBRPhone(displayValue) : "";
    const isInvalid = showError && displayValue.replace(/\D/g, "").length > 0 && !isValidBRPhone(normalized);

    return (
      <div className="w-full">
        <input
          ref={ref}
          type="text"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+55 (DD) 9XXXX-XXXX"
          value={displayValue}
          onChange={handleChange}
          onPaste={handlePaste}
          onBlur={handleBlur}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            isInvalid && "border-destructive focus-visible:ring-destructive",
            className
          )}
          {...props}
        />
        {isInvalid && (
          <p className="text-xs text-destructive mt-1">
            {errorMessage || "Telefone inválido. Use formato: +55 (DD) 9XXXX-XXXX"}
          </p>
        )}
      </div>
    );
  }
);

PhoneInputBR.displayName = "PhoneInputBR";

export { PhoneInputBR };
