import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

type BackupManifest = {
  outputDir: string;
  databaseDumpFile: string;
  storageManifestFile: string;
  downloadedFiles: boolean;
  failedDownloads: Array<{ bucket: string; path: string; error: string }>;
};

type StorageManifest = {
  files: Array<{ bucket: string; path: string }>;
};

async function fileExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const backupDirArg = process.argv[2];
  if (!backupDirArg) {
    console.error("Usage: npm run backup:verify -- <backup-directory>");
    process.exit(1);
  }

  const backupDir = path.resolve(backupDirArg);
  const manifestPath = path.join(backupDir, "backup-manifest.json");
  if (!(await fileExists(manifestPath))) {
    throw new Error(`Missing backup-manifest.json in ${backupDir}`);
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;

  const dumpStats = await stat(manifest.databaseDumpFile);
  if (dumpStats.size <= 0) {
    throw new Error(`Database dump is empty: ${manifest.databaseDumpFile}`);
  }

  const storageManifestPath = manifest.storageManifestFile;
  if (!(await fileExists(storageManifestPath))) {
    throw new Error(`Missing storage manifest: ${storageManifestPath}`);
  }

  const storageManifest = JSON.parse(await readFile(storageManifestPath, "utf8")) as StorageManifest;
  const files = storageManifest.files ?? [];
  if (manifest.downloadedFiles) {
    const missing: string[] = [];
    for (const file of files) {
      const localPath = path.join(backupDir, "storage-files", file.bucket, file.path);
      if (!(await fileExists(localPath))) {
        missing.push(localPath);
      }
      if (missing.length >= 20) break;
    }
    if (missing.length > 0) {
      throw new Error(
        `Storage backup missing files (showing first ${missing.length}):\n${missing.join("\n")}`,
      );
    }
  }

  if ((manifest.failedDownloads ?? []).length > 0) {
    throw new Error(`Backup has ${manifest.failedDownloads.length} recorded failed downloads.`);
  }

  console.log("[backup:verify] OK");
  console.log(`[backup:verify] directory: ${backupDir}`);
  console.log(`[backup:verify] database dump bytes: ${dumpStats.size}`);
  console.log(`[backup:verify] storage files listed: ${files.length}`);
}

main().catch((err) => {
  console.error("[backup:verify] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
