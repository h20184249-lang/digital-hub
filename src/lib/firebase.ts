import { getApp, getApps, initializeApp } from 'firebase/app';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseAppletConfig from '../../firebase-applet-config.json';

function pickEnvOrFallback(envValue: string | undefined, fallback: string): string {
  const trimmed = (envValue || '').trim();
  if (!trimmed) return fallback;
  const upper = trimmed.toUpperCase();
  if (
    upper.startsWith('YOUR_') ||
    upper.startsWith('REPLACE_') ||
    upper.startsWith('MY_') ||
    upper.includes('CHANGEME') ||
    upper.includes('<')
  ) {
    return fallback;
  }
  return trimmed;
}

export const resolvedFirebaseConfig = {
  ...firebaseAppletConfig,
  apiKey: pickEnvOrFallback(import.meta.env.VITE_FIREBASE_API_KEY, firebaseAppletConfig.apiKey),
  authDomain: pickEnvOrFallback(
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    firebaseAppletConfig.authDomain
  ),
  projectId: pickEnvOrFallback(
    import.meta.env.VITE_FIREBASE_PROJECT_ID,
    firebaseAppletConfig.projectId
  ),
  storageBucket: pickEnvOrFallback(
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    firebaseAppletConfig.storageBucket
  ),
  messagingSenderId: pickEnvOrFallback(
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    firebaseAppletConfig.messagingSenderId
  ),
  appId: pickEnvOrFallback(import.meta.env.VITE_FIREBASE_APP_ID, firebaseAppletConfig.appId),
  firestoreDatabaseId: pickEnvOrFallback(
    import.meta.env.VITE_FIREBASE_DATABASE_ID,
    firebaseAppletConfig.firestoreDatabaseId
  ),
  measurementId: pickEnvOrFallback(
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
    firebaseAppletConfig.measurementId || ''
  ),
};

const app = getApps().length > 0 ? getApp() : initializeApp(resolvedFirebaseConfig);

// Public read-only storefront catalog Firestore handle (Firebase Authentication has been completely removed)
export const db = getFirestore(app, resolvedFirebaseConfig.firestoreDatabaseId);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch {
    // Non-fatal: storefront seamlessly uses D1/SQLite overrides & built-in catalog data
  }
}
