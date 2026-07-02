import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// All values are NEXT_PUBLIC_* because this runs in the browser.
// Firebase web config is not a secret (it's scoped by Firebase security
// rules / authorized domains), but keep the file itself out of anything
// that shouldn't be public if you ever add server-side admin keys elsewhere.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Avoid re-initializing on hot reload / multiple imports.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
