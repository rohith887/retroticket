import { useMemo } from "react";
import { useUser } from "./session";

/**
 * Client-side mirror of the server's permission rule, used only to decide what to SHOW.
 * The API remains the authority; hiding a button never replaces a server check.
 *
 *  - admins and the "*" permission can do everything
 *  - while role enforcement is off (Config.roles_active === false) the server lets every signed-in user through,
 *    so the UI shows everything too
 *  - otherwise a permission must be present on one of the user's roles
 */
export function usePermissions() {
  const { user } = useUser();
  return useMemo(() => {
    const granted = new Set(user?.permissions || []);
    const enforced = user?.rolesActive === true;
    const everything = Boolean(user?.isAdmin) || granted.has("*") || !enforced;
    const can = (permission) => everything || granted.has(permission);
    const canAny = (...permissions) => permissions.some(can);
    return { can, canAny, enforced };
  }, [user]);
}
