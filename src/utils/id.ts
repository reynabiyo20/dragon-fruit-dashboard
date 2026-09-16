/** Generate a simple unique ID (crypto.randomUUID with fallback) */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function now(): string {
  return new Date().toISOString();
}
