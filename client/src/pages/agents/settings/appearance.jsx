import React, { useState } from "react";
import { Check } from "lucide-react";
import { Section, Tabs, cn, focusRing } from "../../../ui";
import { useTheme } from "../../../ui/shell/theme";

const DENSITIES = [{ value: "dense", label: "Compact" }, { value: "comfortable", label: "Comfortable" }];

function readDensity() {
  try {
    return localStorage.getItem("layoutDensity") === "comfortable" ? "comfortable" : "dense";
  } catch {
    return "dense";
  }
}

export default function AppearanceSettings() {
  const { theme, setTheme, themes } = useTheme();
  const [density, setDensity] = useState(readDensity);

  function changeDensity(value) {
    setDensity(value);
    try {
      localStorage.setItem("layoutDensity", value);
      // The thread views listen for this event to re-read the density.
      window.dispatchEvent(new Event("storage"));
    } catch {
      /* storage unavailable: applies until reload */
    }
  }

  return (
    <>
      <Section title="Theme" description="Applies to the whole app on this device.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {themes.map((t) => {
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(t.id)}
                className={cn(
                  "flex items-center gap-3 rounded-ds-lg border p-2.5 text-left text-body-sm font-medium transition-colors",
                  active ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink hover:bg-subtle",
                  focusRing
                )}
              >
                <span aria-hidden="true" className="relative h-8 w-12 shrink-0 overflow-hidden rounded-ds border border-line" style={{ background: t.swatch[0] }}>
                  <span className="absolute bottom-1 left-1 right-4 h-1.5 rounded-full" style={{ background: t.swatch[1] }} />
                </span>
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                {active ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Density" description="How much space thread and message lists use.">
        <Tabs idBase="density" variant="segmented" label="Density" value={density} items={DENSITIES} onValueChange={changeDensity} />
      </Section>
    </>
  );
}
