// src/utils/logLimiter.ts - Anti-spam pour les logs
const last = new Map<string, number>();

export function shouldLog(key: string, everyMs = 3000): boolean {
  const now = Date.now();
  const t = last.get(key) ?? 0;
  if (now - t >= everyMs) {
    last.set(key, now);
    return true;
  }
  return false;
}

export function shortId(id: string): string {
  return id.length > 20 ? id.slice(0, 20) + '...' : id;
}
