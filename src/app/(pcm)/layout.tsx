import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getPcmSessionCookie, verifyPcmSessionToken } from "@/lib/auth/pcmSession";

export default async function PcmLayout({ children }: { children: ReactNode }) {
  const sessionCookie = await getPcmSessionCookie();
  if (!verifyPcmSessionToken(sessionCookie)) {
    redirect("/login");
  }

  return children;
}
