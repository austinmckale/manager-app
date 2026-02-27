import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type EnvMap = Record<string, string>;

type StorageManifestFile = {
  bucket: string;
  path: string;
  size: number | null;
  mimetype: string | null;
  updatedAt: string | null;
};

type BackupManifest = {
  createdAt: string;
  outputDir: string;
  databaseDumpFile: string;
  storageManifestFile: string;
  usedDatabaseUrlSource: "DIRECT_URL" | "DATABASE_URL";
  buckets: string[];
  fileCount: number;
  downloadedFiles: boolean;
  failedDownloads: Array<{ bucket: string; path: string; error: string }>;
};

const ENV_FILES = [".env.local", ".env"];

function timestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function loadEnvFromFiles() {
  const merged: EnvMap = {};

  for (const envFile of ENV_FILES) {
    try {
      const content = await readFile(envFile, "utf8");
      const lines = content.split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        merged[key] = value;
      }
    } catch {
      // Optional file.
    }
  }

  for (const [key, value] of Object.entries(merged)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getRequiredEnv(name: string) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getBoolEnv(name: string, defaultValue: boolean) {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  if (!value) return defaultValue;
  return value === "1" || value === "true" || value === "yes";
}

function getNumberEnv(name: string, defaultValue: number) {
  const value = Number(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

async function runCommand(command: string, args: string[], extraEnv?: EnvMap) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
    });
    let stderr = "";

    child.stdout.on("data", () => {
      // quiet
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function buildPgDumpConnection(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const password = decodeURIComponent(parsed.password);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("DATABASE_URL/DIRECT_URL must use a postgres protocol.");
  }
  parsed.password = "";
  return {
    connectionStringWithoutPassword: parsed.toString(),
    password,
  };
}

async function dumpDatabase(databaseUrl: string, outputPath: string) {
  const conn = buildPgDumpConnection(databaseUrl);
  await runCommand(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      outputPath,
      "--dbname",
      conn.connectionStringWithoutPassword,
    ],
    conn.password ? { PGPASSWORD: conn.password } : undefined,
  );
}

async function listBucketFilesRecursive(
  client: SupabaseClient<any, any, any, any, any>,
  bucket: string,
  prefix = "",
): Promise<StorageManifestFile[]> {
  const pageSize = 100;
  let offset = 0;
  const files: StorageManifestFile[] = [];

  // Paginate each folder.
  while (true) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw new Error(`[${bucket}] list failed at "${prefix || "/"}": ${error.message}`);
    }

    const rows = data ?? [];
    for (const row of rows) {
      const rowName = row.name ?? "";
      if (!rowName) continue;
      const fullPath = prefix ? `${prefix}/${rowName}` : rowName;
      const isFolder =
        (row as { id?: string | null }).id == null &&
        !(row as { metadata?: Record<string, unknown> | null }).metadata;

      if (isFolder) {
        files.push(...(await listBucketFilesRecursive(client, bucket, fullPath)));
      } else {
        const metadata = (row as { metadata?: Record<string, unknown> | null }).metadata ?? null;
        const size = metadata && typeof metadata.size === "number" ? metadata.size : null;
        const mimetype = metadata && typeof metadata.mimetype === "string" ? metadata.mimetype : null;
        const updatedAt =
          typeof (row as { updated_at?: string }).updated_at === "string"
            ? (row as { updated_at?: string }).updated_at ?? null
            : null;

        files.push({
          bucket,
          path: fullPath,
          size,
          mimetype,
          updatedAt,
        });
      }
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return files;
}

async function downloadBucketFile(
  client: SupabaseClient<any, any, any, any, any>,
  outputDir: string,
  file: StorageManifestFile,
) {
  const { data, error } = await client.storage.from(file.bucket).download(file.path);
  if (error || !data) {
    throw new Error(error?.message ?? "Unknown download error");
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const localPath = path.join(outputDir, file.bucket, file.path);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, bytes);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  await loadEnvFromFiles();

  const stamp = timestamp();
  const outputRoot = path.resolve(process.env.BACKUP_OUTPUT_DIR?.trim() || "backups");
  const outputDir = path.join(outputRoot, stamp);
  await mkdir(outputDir, { recursive: true });

  const databaseUrl = (process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim() || "");
  const usedDatabaseUrlSource = process.env.DIRECT_URL?.trim() ? "DIRECT_URL" : "DATABASE_URL";
  if (!databaseUrl) {
    throw new Error("No database URL found. Set DIRECT_URL (recommended) or DATABASE_URL.");
  }

  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRole = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const defaultBucket = (process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").trim();
  const bucketList = (process.env.BACKUP_BUCKETS ?? `${defaultBucket},site-public`)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const downloadFiles = getBoolEnv("BACKUP_DOWNLOAD_FILES", true);
  const downloadConcurrency = getNumberEnv("BACKUP_DOWNLOAD_CONCURRENCY", 3);

  const databaseDumpFile = path.join(outputDir, "database.dump");
  const storageManifestFile = path.join(outputDir, "storage-manifest.json");
  const storageFilesOutputDir = path.join(outputDir, "storage-files");

  console.log(`[backup] output: ${outputDir}`);
  console.log(`[backup] dumping database via ${usedDatabaseUrlSource}...`);
  await dumpDatabase(databaseUrl, databaseDumpFile);
  console.log("[backup] database dump complete.");

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`[backup] indexing storage buckets: ${bucketList.join(", ")}`);
  const allFiles: StorageManifestFile[] = [];
  for (const bucket of bucketList) {
    const files = await listBucketFilesRecursive(supabase, bucket);
    allFiles.push(...files);
    console.log(`[backup] ${bucket}: ${files.length} files`);
  }

  await writeFile(
    storageManifestFile,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        buckets: bucketList,
        files: allFiles,
      },
      null,
      2,
    ),
    "utf8",
  );

  const failedDownloads: Array<{ bucket: string; path: string; error: string }> = [];
  if (downloadFiles) {
    console.log(`[backup] downloading ${allFiles.length} storage files...`);
    await runWithConcurrency(allFiles, downloadConcurrency, async (file) => {
      try {
        await downloadBucketFile(supabase, storageFilesOutputDir, file);
      } catch (err) {
        failedDownloads.push({
          bucket: file.bucket,
          path: file.path,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    });
    console.log("[backup] storage file download pass complete.");
  } else {
    console.log("[backup] file downloads disabled (manifest only).");
  }

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    outputDir,
    databaseDumpFile,
    storageManifestFile,
    usedDatabaseUrlSource,
    buckets: bucketList,
    fileCount: allFiles.length,
    downloadedFiles: downloadFiles,
    failedDownloads,
  };
  await writeFile(path.join(outputDir, "backup-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  if (failedDownloads.length > 0) {
    console.error(`[backup] completed with ${failedDownloads.length} failed storage downloads.`);
    process.exitCode = 2;
    return;
  }

  console.log("[backup] success.");
}

main().catch((err) => {
  console.error("[backup] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
