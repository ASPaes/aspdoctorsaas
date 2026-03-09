import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Escapes LIKE/ILIKE special characters (%, _, \) to prevent
 * pattern injection in Supabase `.ilike()` / `.or()` queries.
 */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}
