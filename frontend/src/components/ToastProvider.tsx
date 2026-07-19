"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { registerToastApi } from "@/lib/toast";

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const [visible, setVisible] = useState(false);

  const show = useCallback((message: string, ms = 2200) => {
    setMsg(message);
    setVisible(true);
    window.setTimeout(() => setVisible(false), ms);
  }, []);

  useEffect(() => {
    registerToastApi({ show });
    return () => registerToastApi(null);
  }, [show]);

  return (
    <>
      {children}
      {typeof document !== "undefined" &&
        visible &&
        msg &&
        createPortal(
          <div className="app-toast" role="status" aria-live="polite">
            {msg}
          </div>,
          document.body
        )}
    </>
  );
}
