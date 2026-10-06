import { getFirebasePublicConfig } from "@/lib/firebaseConfig";

function serializeConfig(config: Record<string, unknown>) {
  return JSON.stringify(config).replace(/</g, "\\u003c");
}

export default function FirebaseConfigScript() {
  try {
    const config = getFirebasePublicConfig();
    const serialized = serializeConfig(config);
    const code = `window.__FIREBASE_PUBLIC_CONFIG=${serialized};`;
    return <script id="firebase-public-config" dangerouslySetInnerHTML={{ __html: code }} suppressHydrationWarning />;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[firebase] Failed to expose Firebase public config", error);
    }
    return null;
  }
}
