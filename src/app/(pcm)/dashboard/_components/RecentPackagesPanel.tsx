"use client";

import Link from "next/link";
import type { Package } from "@/types";

function normaliseStatus(status: Package["status"]): "Aberto" | "Pendente" | "Concluído" {
  const raw = String(status ?? "").toLowerCase();
  if (raw === "concluido" || raw === "concluído" || raw === "encerrado") return "Concluído";
  if (raw === "pendente") return "Pendente";
  return "Aberto";
}

export default function RecentPackagesPanel({ packages }: { packages: Package[] }) {
  return (
    <div className="space-y-2">
      {packages.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Nenhum pacote cadastrado.</div>
      ) : (
        packages.slice(0, 5).map((pkg) => {
          const packageHref = `/pacotes/${encodeURIComponent(pkg.id)}`;
          const status = normaliseStatus(pkg.status);
          return (
            <Link
              key={pkg.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 transition hover:border-primary/40 hover:bg-muted/40"
              href={packageHref}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{pkg.name || pkg.code || pkg.id}</p>
                <p className="text-xs text-muted-foreground">{status}</p>
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}
