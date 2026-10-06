"use client";

import dynamic from "next/dynamic";

import type { DeletePackageButtonProps } from "./DeletePackageButton";

const DeletePackageButtonLazy = dynamic(() => import("./DeletePackageButton"), {
  ssr: false,
  loading: () => (
    <span className="text-sm text-muted-foreground">Carregando…</span>
  ),
});

export default function DeletePackageButtonDynamic(props: DeletePackageButtonProps) {
  return <DeletePackageButtonLazy {...props} />;
}
