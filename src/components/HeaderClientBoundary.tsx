"use client";

import dynamic from "next/dynamic";

const HeaderClient = dynamic(() => import("@/components/HeaderClient"), { ssr: false });

export default function HeaderClientBoundary() {
  return <HeaderClient />;
}
