"use client";

import { FileSpreadsheet } from "lucide-react";
import { useCallback } from "react";
import {
  buildPackageExcelFilename,
  buildPackageServicesExcel,
  type PackageServiceExportRow,
} from "@/lib/packageExcelExport";

type PackageExcelExportButtonProps = {
  packageLabel: string;
  rows: PackageServiceExportRow[];
};

export default function PackageExcelExportButton({ packageLabel, rows }: PackageExcelExportButtonProps) {
  const handleExport = useCallback(() => {
    const workbook = buildPackageServicesExcel(rows);
    const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildPackageExcelFilename(packageLabel);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [packageLabel, rows]);

  return (
    <button type="button" className="btn btn-outline" onClick={handleExport} disabled={!rows.length}>
      <FileSpreadsheet aria-hidden="true" className="h-4 w-4" />
      Exportar Excel
    </button>
  );
}
