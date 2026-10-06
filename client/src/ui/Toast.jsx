import React from "react";
import { ToastContainer, toast } from "react-toastify";

/**
 * Toasts use react-toastify (already used across the legacy app) themed from design tokens in tokens.css.
 * Mount <Toaster /> once; call `toast.success("…")`, `toast.error("…")` from anywhere.
 */
export function Toaster() {
  return (
    <ToastContainer
      position="bottom-right"
      autoClose={4000}
      hideProgressBar
      newestOnTop
      closeOnClick
      pauseOnFocusLoss
      pauseOnHover
      theme="light"
      className="ds-root"
    />
  );
}

export { toast };
