import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  decimals?: number;
  suffix?: string;
}

/**
 * Masked numeric input with Brazilian locale (comma as decimal separator).
 * Stores value as a JS number, displays formatted with comma.
 */
const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ className, value, onChange, decimals = 2, suffix, ...props }, ref) => {
    const [displayValue, setDisplayValue] = React.useState("");
    const isFocused = React.useRef(false);

    // Format number to display string with comma
    const formatValue = React.useCallback(
      (num: number | null | undefined): string => {
        if (num === null || num === undefined) return "";
        return num.toFixed(decimals).replace(".", ",");
      },
      [decimals]
    );

    // Sync display when value changes externally (only when not focused)
    React.useEffect(() => {
      if (!isFocused.current) {
        setDisplayValue(formatValue(value));
      }
    }, [value, formatValue]);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      isFocused.current = true;
      props.onFocus?.(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let raw = e.target.value;

      // Allow only digits, comma, and minus
      raw = raw.replace(/[^0-9,\-]/g, "");

      // Ensure only one comma
      const parts = raw.split(",");
      if (parts.length > 2) {
        raw = parts[0] + "," + parts.slice(1).join("");
      }

      // Limit decimal places
      if (parts.length === 2 && parts[1].length > decimals) {
        raw = parts[0] + "," + parts[1].slice(0, decimals);
      }

      setDisplayValue(raw);

      // Parse to number
      if (raw === "" || raw === "-") {
        onChange(null);
        return;
      }

      const parsed = parseFloat(raw.replace(",", "."));
      if (!isNaN(parsed)) {
        onChange(parsed);
      }
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      isFocused.current = false;
      // Re-format on blur
      if (value !== null && value !== undefined) {
        setDisplayValue(formatValue(value));
      }
      props.onBlur?.(e);
    };

    return (
      <div className="relative">
        <Input
          ref={ref}
          type="text"
          inputMode="decimal"
          className={cn(suffix && "pr-8", className)}
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    );
  }
);
NumericInput.displayName = "NumericInput";

export { NumericInput };
