import logoColor from "@/assets/logo-doctorsaas.png";

type LogoVariant = "color" | "black" | "white";
type LogoSize = "sm" | "md" | "lg" | "xl";

interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  className?: string;
  showText?: boolean;
}

const sizeMap: Record<LogoSize, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-auto",
  lg: "h-16 w-auto",
  xl: "h-24 w-auto",
};

export function Logo({ variant = "color", size = "md", className = "", showText = false }: LogoProps) {
  const sizeClass = sizeMap[size];

  // For black/white variants we apply CSS filters to the color logo
  const filterClass =
    variant === "black"
      ? "brightness-0"
      : variant === "white"
        ? "brightness-0 invert"
        : "";

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src={logoColor}
        alt="DoctorSaaS"
        className={`${sizeClass} object-contain ${filterClass}`}
      />
      {showText && (
        <span className="font-semibold text-foreground text-lg tracking-tight">
          DoctorSaaS
        </span>
      )}
    </span>
  );
}
