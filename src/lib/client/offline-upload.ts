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
  const queue = await getUploadQueue();
  queue.push(item);
  const db = await getDb();
  await db.put(STORE_NAME, queue, KEY);
}

export async function removeQueuedUpload(id: string) {
  const queue = await getUploadQueue();
  const db = await getDb();
  await db.put(
    STORE_NAME,
    queue.filter((item) => item.id !== id),
    KEY,
  );
}

export async function clearUploadQueue() {
  const db = await getDb();
  await db.put(STORE_NAME, [], KEY);
}
