import { openDB } from "idb";

export type UploadQueueItem = {
  id: string;
  jobId: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  fileType: "PHOTO" | "VIDEO" | "DOCUMENT" | "RECEIPT";
  stage?: "BEFORE" | "DURING" | "AFTER";
  area?: string;
  tags: string[];
  description?: string;
  isPortfolio?: boolean;
  isClientVisible?: boolean;
  expenseId?: string;
  expenseVendor?: string;
  expenseAmount?: number;
  expenseCategory?: "MATERIALS" | "SUBCONTRACTOR" | "PERMIT" | "EQUIPMENT" | "MISC";
  expenseDate?: string;
  expenseNotes?: string;
  retryCount?: number;
  lastError?: string;
  lastAttemptAt?: string;
};

const DB_NAME = "fieldflow-offline";
const STORE_NAME = "uploads";
const KEY = "queue";

async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

export async function getUploadQueue() {
  const db = await getDb();
  return ((await db.get(STORE_NAME, KEY)) as UploadQueueItem[] | undefined) ?? [];
}

export async function enqueueUpload(item: UploadQueueItem) {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const queue: UploadQueueItem[] = (await tx.store.get(KEY)) ?? [];
  if (!queue.some((existing) => existing.id === item.id)) queue.push(item);
  await tx.store.put(queue, KEY);
  await tx.done;
}

export async function removeQueuedUpload(id: string) {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const queue: UploadQueueItem[] = (await tx.store.get(KEY)) ?? [];
  await tx.store.put(
    queue.filter((item) => item.id !== id),
    KEY,
  );
  await tx.done;
}

export async function updateQueuedUpload(id: string, updater: (item: UploadQueueItem) => UploadQueueItem) {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const queue: UploadQueueItem[] = (await tx.store.get(KEY)) ?? [];
  await tx.store.put(queue.map((item) => (item.id === id ? updater(item) : item)), KEY);
  await tx.done;
}

export async function clearUploadQueue() {
  const db = await getDb();
  await db.put(STORE_NAME, [], KEY);
}
