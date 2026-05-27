import type { Profile } from "@/hooks/useProfile";

/**
 * Helper síncrono para checar role-based capabilities legadas.
 * Mantido para consumidores que ainda não migraram para usePermissions().
 */
export const isAdminLike = (profile: Profile | null | undefined): boolean => {
  if (!profile) return false;
  return (
    profile.is_super_admin === true ||
    profile.role === "admin" ||
    profile.role === "head"
  );
};

export const isStrictAdmin = (profile: Profile | null | undefined): boolean => {
  if (!profile) return false;
  return profile.is_super_admin === true || profile.role === "admin";
};
