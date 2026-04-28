import { useState, useEffect } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface ContactAvatarProps {
  name: string;
  profilePictureUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: { container: "h-8 w-8", text: "text-xs" },
  md: { container: "h-10 w-10", text: "text-sm" },
  lg: { container: "h-12 w-12", text: "text-base" },
} as const;

function getInitials(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";

  if (parts.length === 1) {
    const word = parts[0];
    return (word.length >= 2 ? word.slice(0, 2) : word).toUpperCase();
  }

  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  return (first + last).toUpperCase();
}

function isValidUrl(url?: string | null): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== "null" && trimmed.toLowerCase() !== "undefined";
}

export default function ContactAvatar({
  name,
  profilePictureUrl,
  size = "md",
  className,
}: ContactAvatarProps) {
  const [imageError, setImageError] = useState(false);
  const sizes = sizeMap[size];
  const initials = getInitials(name);
  const valid = isValidUrl(profilePictureUrl);
  const showImage = valid && !imageError;

  // Reset error state when URL changes
  useEffect(() => {
    setImageError(false);
  }, [profilePictureUrl]);

  return (
    <Avatar className={cn(sizes.container, "shrink-0", className)}>
      {showImage && (
        <AvatarImage
          src={profilePictureUrl as string}
          alt={name}
          className="object-cover"
          onError={() => setImageError(true)}
        />
      )}
      <AvatarFallback
        aria-label={name}
        className={cn(
          "bg-primary text-primary-foreground font-medium flex items-center justify-center",
          sizes.text
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
