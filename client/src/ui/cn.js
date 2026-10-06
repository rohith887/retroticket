import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about the design system's custom font sizes so `text-caption` and `text-ink-muted`
// are not mistaken for two text colours (which would silently drop the size).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "body-sm", "body", "title", "heading"] }],
      shadow: [{ shadow: ["ds-popover", "ds-dialog"] }],
      rounded: [{ rounded: ["ds-sm", "ds", "ds-lg"] }],
    },
  },
});

// Merge conditional class names and resolve Tailwind conflicts (later classes win).
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Shared focus ring used by every interactive element in the design system.
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
