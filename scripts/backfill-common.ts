import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const dryRun = process.argv.includes("--dry-run");
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID });
export const db = getFirestore();
export const PAGE_SIZE = 200;
export const BATCH_SIZE = 400;
