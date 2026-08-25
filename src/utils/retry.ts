export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  delayMs: number,
  onRetry?: (attempt: number, error: unknown) => void,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isTemporaryError(error)) throw error;
      attempt += 1;
      onRetry?.(attempt, error);
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
    }
  }
}

function isTemporaryError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const status = typeof error === "object" && error !== null && "response" in error
    ? Number((error as { response?: { status?: unknown } }).response?.status)
    : 0;
  return status === 429 || status >= 500 || /ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|socket hang up|timeout|temporar/i.test(text);
}
