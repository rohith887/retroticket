import React from "react";
import { Dialog, DialogContent, Kbd } from "../index";
import { modKey } from "./TopBar";

function buildShortcuts(config) {
  return [
    { keys: [modKey, "K"], label: "Open search and command palette" },
    { keys: ["?"], label: "Show keyboard shortcuts" },
    ...(config.createKey ? [{ keys: [config.createKey.toUpperCase()], label: config.newAction.label }] : []),
    ...Object.entries(config.goto).map(([key, target]) => ({ keys: ["G", "then", key.toUpperCase()], label: `Go to ${target.label}` })),
    { keys: ["Esc"], label: "Close dialog, drawer or menu" },
  ];
}

export function ShortcutsDialog({ open, onOpenChange, config }) {
  const SHORTCUTS = buildShortcuts(config);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" description="Shortcuts are ignored while you are typing in a field.">
        <ul className="divide-y divide-line">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.label} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-body-sm text-ink">{shortcut.label}</span>
              <span className="flex items-center gap-1">
                {shortcut.keys.map((key, index) =>
                  key === "then" ? (
                    <span key={index} className="text-caption text-ink-faint">
                      then
                    </span>
                  ) : (
                    <Kbd key={index}>{key}</Kbd>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
