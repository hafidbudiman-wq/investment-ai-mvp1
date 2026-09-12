import type { P0ARoutedPage, P0ARoutingSnapshotEntry } from "@/lib/financial/p0a/types";

export const LEGACY_CLASSIFICATION_UNAVAILABLE = "LEGACY_CLASSIFICATION_UNAVAILABLE" as const;
export const ROUTING_SNAPSHOT_IDENTITY_CONFLICT = "ROUTING_SNAPSHOT_IDENTITY_CONFLICT" as const;

export class RoutingSnapshotIdentityConflictError extends Error {
  readonly code = ROUTING_SNAPSHOT_IDENTITY_CONFLICT;

  constructor() {
    super(
      `${ROUTING_SNAPSHOT_IDENTITY_CONFLICT}: the persisted routing history differs from the rerun under the same complete pass identity. Bump routerVersion before retrying.`,
    );
    this.name = "RoutingSnapshotIdentityConflictError";
  }
}

export function createRoutingSnapshot(
  pages: readonly P0ARoutedPage[],
): P0ARoutingSnapshotEntry[] {
  return [...pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => ({
      pageNumber: page.pageNumber,
      pageClass: page.pageClass,
      statementType: page.statementType,
      confidence: page.confidence,
      matchedAnchors: [...page.matchedAnchors],
      textHash: page.textHash,
      layoutHash: page.layoutHash,
    }));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function routingSnapshotsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function assertRoutingSnapshotIdentity(
  persisted: unknown,
  current: readonly P0ARoutingSnapshotEntry[],
): void {
  if (!routingSnapshotsEqual(persisted, current)) {
    throw new RoutingSnapshotIdentityConflictError();
  }
}
