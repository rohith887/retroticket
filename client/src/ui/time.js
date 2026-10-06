const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const STEPS = [
  ["year", 31536000],
  ["month", 2592000],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", "yesterday", "Just now". Returns `fallback` for empty values. */
export function timeAgo(value, fallback = "Never") {
  if (!value) return fallback;
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  if (Number.isNaN(seconds)) return fallback;
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "Just now";
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "";
}
