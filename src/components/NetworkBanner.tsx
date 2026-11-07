"use client";

import { useEffect, useState } from "react";

const shouldLogReconnects = process.env.NODE_ENV !== "production";

export default function NetworkBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const reportStatus = () => {
      const isOnline = typeof navigator === "undefined" ? true : navigator.onLine;
      setOnline(isOnline);
      if (!isOnline) {
        console.warn("[rede] Conexão perdida. As chamadas ao servidor serão retomadas quando a rede voltar.");
      } else if (shouldLogReconnects) {
        console.info("[rede] Conexão com a internet restabelecida.");
      }
    };

    reportStatus();
    window.addEventListener("online", reportStatus);
    window.addEventListener("offline", reportStatus);
    return () => {
      window.removeEventListener("online", reportStatus);
      window.removeEventListener("offline", reportStatus);
    };
  }, []);

  if (online) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 9999,
        padding: "8px 12px",
        background: "rgba(255, 200, 0, 0.95)",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,.15)",
        fontSize: 14,
      }}
    >
      Você está <strong>offline</strong>. Alguns dados podem estar desatualizados; reconectaremos automaticamente assim que possível.
    </div>
  );
}
