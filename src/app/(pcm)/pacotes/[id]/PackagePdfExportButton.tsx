"use client";

import { Printer } from "lucide-react";
import { useCallback } from "react";

export default function PackagePdfExportButton() {
  const handlePrint = useCallback(() => {
    if (typeof window === "undefined") return;
    window.print();
  }, []);

  return (
    <button type="button" className="btn btn-outline" onClick={handlePrint}>
      <Printer aria-hidden="true" className="h-4 w-4" />
      Exportar PDF
    </button>
  );
}
