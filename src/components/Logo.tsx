import logoLight from "@/assets/brand/logo-light.svg"; // nome em preto  → fundo claro
import logoDark from "@/assets/brand/logo-dark.svg"; // nome em branco → fundo escuro
import iconGreen from "@/assets/brand/icon.svg"; // só o ícone (verde)

type LogoSize = "sm" | "md" | "lg" | "xl" | "2xl";

interface LogoProps {
  size?: LogoSize;
  className?: string;
  /** Mostra só o ícone (verde), sem o nome — ex.: sidebar recolhido. */
  iconOnly?: boolean;
}

// lockup tem proporção ~4,2:1 (450×108) → altura manda, largura é automática
const lockupHeight: Record<LogoSize, string> = {
  sm: "h-6",
  md: "h-8",
  lg: "h-10",
  xl: "h-12",
  "2xl": "h-24",
};

// ícone é 1:1 (108×108)
const iconBox: Record<LogoSize, string> = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-11 w-11",
  xl: "h-14 w-14",
  "2xl": "h-20 w-20",
};

export function Logo({ size = "md", className = "", iconOnly = false }: LogoProps) {
  if (iconOnly) {
    return (
      <img
        src={iconGreen}
        alt="DoctorSaaS"
        className={`${iconBox[size]} object-contain ${className}`}
      />
    );
  }

  return (
    <span className={`inline-flex items-center ${className}`}>
      {/* claro: nome preto */}
      <img
        src={logoLight}
        alt="DoctorSaaS"
        className={`${lockupHeight[size]} w-auto object-contain block dark:hidden`}
      />
      {/* escuro: nome branco */}
      <img
        src={logoDark}
        alt="DoctorSaaS"
        aria-hidden="true"
        className={`${lockupHeight[size]} w-auto object-contain hidden dark:block`}
      />
    </span>
  );
}
