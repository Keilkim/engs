/**
 * Safe JSON.parse wrapper that returns fallback on failure
 */
export function safeJsonParse<T>(jsonString: string | null | undefined, fallback: T): T {
  try {
    return JSON.parse(jsonString || JSON.stringify(fallback));
  } catch (err) {
    console.warn('[safeJsonParse] Failed to parse:', (err as Error).message);
    return fallback;
  }
}

/**
 * Consistent error logging with context
 */
export function logError(context: string, error: unknown): void {
  console.error(`[${context}]`, error instanceof Error ? error.message : error);
}
