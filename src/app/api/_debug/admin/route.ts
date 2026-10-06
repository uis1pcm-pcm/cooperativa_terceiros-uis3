import { NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { getAdminApp } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const app = getAdminApp();
    if (!app) {
      return NextResponse.json({ ok: false, message: "Firebase Admin não configurado" }, { status: 503 });
    }

    const db = getFirestore(app);
    const auth = getAuth(app);
    const pid =
      app.options.projectId ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

    // ping rápido ao Firestore
    await db.collection("_ping").doc("now").set({ t: Date.now() });
    const currentUsers = await auth.listUsers(1);

    return NextResponse.json({
      ok: true,
      projectId: pid,
      authUsersSample: currentUsers.users?.length || 0,
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[_debug/admin] ERRO:", error.stack ?? error.message);
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
}
