export type WorkerHeartbeat = {
  name: string;
  intervalMs: number;
  lastTickAt: string | null;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  running: boolean;
};

const registry = new Map<string, WorkerHeartbeat>();

export function registerWorker(name: string, intervalMs: number): void {
  registry.set(name, {
    name,
    intervalMs,
    lastTickAt: null,
    lastOkAt: null,
    lastErrorAt: null,
    lastError: null,
    running: false,
  });
}

export function markWorkerTickStart(name: string): void {
  const row = registry.get(name);
  if (!row) return;
  row.lastTickAt = new Date().toISOString();
  row.running = true;
}

export function markWorkerTickOk(name: string): void {
  const row = registry.get(name);
  if (!row) return;
  row.lastOkAt = new Date().toISOString();
  row.running = false;
}

export function markWorkerTickError(name: string, message: string): void {
  const row = registry.get(name);
  if (!row) return;
  row.lastErrorAt = new Date().toISOString();
  row.lastError = message.slice(0, 500);
  row.running = false;
}

export function getWorkerStatuses(): WorkerHeartbeat[] {
  return [...registry.values()];
}

export function readGitSha(): string {
  return process.env.GIT_SHA?.trim() || process.env.IMAGE_TAG?.trim() || "unknown";
}
