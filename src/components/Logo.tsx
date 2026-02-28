import logoIcon from "@/assets/logo-icon.svg";
import logoHorizontalDark from "@/assets/logo-horizontal-dark.svg";
import logoHorizontalLight from "@/assets/logo-horizontal-light.svg";

type LogoVariant = "icon" | "horizontal-dark" | "horizontal-light";
type LogoSize = "sm" | "md" | "lg" | "xl" | "splash";

interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  className?: string;
  showBranding?: boolean;
}

const sizeMap: Record<LogoSize, string> = {
  sm: "h-8 w-8",
  md: "h-9 w-auto",
  lg: "h-16 w-16",
  xl: "h-20 w-20",
  splash: "h-20 w-20",
};

const variantSrc: Record<LogoVariant, string> = {
  "icon": logoIcon,
  "horizontal-dark": logoHorizontalDark,
  "horizontal-light": logoHorizontalLight,
};

export function Logo({ variant = "horizontal-dark", size = "md", className = "", showBranding = false }: LogoProps) {
  const sizeClass = sizeMap[size];
  const src = variantSrc[variant];
  const isSplash = size === "splash";

  return (
    <span className={`inline-flex flex-col items-center ${className}`}>
      <img
        src={src}
        alt="DoctorSaaS"
        className={`${sizeClass} object-contain ${isSplash ? "animate-pulse drop-shadow-[0_0_24px_rgba(34,197,94,0.25)]" : ""}`}
      />
      {showBranding && (
        <span className="mt-3 flex flex-col items-center gap-1">
          <span className="font-sans font-extrabold text-2xl tracking-[-0.5px] text-foreground">
            DoctorSaaS
          </span>
          <span className="font-sans font-normal text-sm text-muted-foreground">
            Business Analytics
          </span>
        </span>
      )}
    </span>
  );
}
