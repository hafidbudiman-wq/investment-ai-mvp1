import type { P0AProviderUsage } from "@/lib/financial/p0a/types";

export function zeroAiShadowUsage(selectedPageCount: number, requirementCount: number, processingLatencyMs: number): P0AProviderUsage {
  return {
    provider: null,
    model: null,
    selectedPageCount,
    requirementCount,
    providerRequestId: null,
    providerResponseId: null,
    retryCount: 0,
    inputTokens: null,
    outputTokens: null,
    processingLatencyMs,
    estimatedCostUsd: null,
    billedCostUsd: null,
    providerCalls: 0,
  };
}

export function costPerValidatedFact(usage: P0AProviderUsage, validatedFactCount: number): string | null {
  if (!usage.billedCostUsd || validatedFactCount <= 0) return null;
  const cost = Number(usage.billedCostUsd);
  if (!Number.isFinite(cost)) return null;
  return (cost / validatedFactCount).toFixed(8);
}

export function validatedFactsPerAiPage(usage: P0AProviderUsage, validatedFactCount: number): string | null {
  if (usage.providerCalls === 0 || usage.selectedPageCount <= 0) return null;
  return (validatedFactCount / usage.selectedPageCount).toFixed(6);
}
