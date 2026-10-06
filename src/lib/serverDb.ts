// server-only
import "server-only";
import { getFirestore } from "firebase-admin/firestore";

import { getAdminApp } from "./firebaseAdmin";

export class AdminDbUnavailableError extends Error {
  constructor(message = "Firebase Admin Firestore is not configured.") {
    super(message);
    this.name = "AdminDbUnavailableError";
  }
}

// Admin (preferido)
export function tryGetAdminDb() {
  const app = getAdminApp();
  if (!app) return null;
  return getFirestore(app);
}

export function getAdminDbOrThrow() {
  const db = tryGetAdminDb();
  if (!db) {
    throw new AdminDbUnavailableError();
  }
  return db;
}
