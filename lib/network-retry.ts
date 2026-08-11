export type NetworkRetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
};

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  return error instanceof TypeError || /failed to fetch|network|load failed/i.test(error.message);
}

export async function withNetworkRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: NetworkRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_500);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts || !isRetryableNetworkError(error)) throw error;
      options.onRetry?.(attempt + 1, error);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }

  throw new Error("Network retry exhausted.");
}
