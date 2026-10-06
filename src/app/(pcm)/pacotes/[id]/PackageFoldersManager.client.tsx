"use client";

import dynamic from "next/dynamic";
import type { PackageFoldersManagerProps } from "./PackageFoldersManager";

const PackageFoldersManagerDynamic = dynamic<PackageFoldersManagerProps>(
  () => import("./PackageFoldersManager"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-6 text-sm text-muted-foreground">
        Carregando gerenciamento de pastas do pacote...
      </div>
    ),
  },
);

export default function PackageFoldersManagerClient(props: PackageFoldersManagerProps) {
  return <PackageFoldersManagerDynamic {...props} />;
}
