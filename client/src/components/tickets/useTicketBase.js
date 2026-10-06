import { useLocation } from "react-router-dom";
import { portalBase } from "../../ui/shell/nav";

/** "/agents" or "/portal": the same ticket screens serve both mail-style layouts. */
export function useBase() {
  return portalBase(useLocation().pathname);
}
