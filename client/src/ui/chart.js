// Charts (recharts) need real colour strings, not CSS variables. Resolve design tokens at render time so
// charts follow the active theme. Usage: tokenColor("--ds-brand")
export function tokenColor(name, fallback = "currentColor") {
  if (typeof document === "undefined") return fallback;
  const channels = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return channels ? `rgb(${channels})` : fallback;
}
