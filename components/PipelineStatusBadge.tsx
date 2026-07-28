type Props = {
  status: string;
  compact?: boolean;
};

const styles: Record<string, { background: string; border: string; color: string }> = {
  NEED_REVIEW: { background: "rgba(245, 158, 11, 0.14)", border: "rgba(245, 158, 11, 0.48)", color: "#fbbf24" },
  READY_TO_COMMIT: { background: "rgba(56, 189, 248, 0.14)", border: "rgba(56, 189, 248, 0.48)", color: "#7dd3fc" },
  COMMITTED: { background: "rgba(52, 211, 153, 0.14)", border: "rgba(52, 211, 153, 0.48)", color: "#6ee7b7" },
  FAILED: { background: "rgba(248, 113, 113, 0.14)", border: "rgba(248, 113, 113, 0.48)", color: "#fca5a5" },
  PENDING: { background: "rgba(245, 158, 11, 0.14)", border: "rgba(245, 158, 11, 0.48)", color: "#fbbf24" },
  ACCEPTED: { background: "rgba(56, 189, 248, 0.14)", border: "rgba(56, 189, 248, 0.48)", color: "#7dd3fc" },
  REJECTED: { background: "rgba(248, 113, 113, 0.14)", border: "rgba(248, 113, 113, 0.48)", color: "#fca5a5" },
};

export function PipelineStatusBadge({ status, compact = false }: Props) {
  const normalized = status.replaceAll(" ", "_").toUpperCase();
  const palette = styles[normalized] ?? { background: "rgba(148, 163, 184, 0.12)", border: "rgba(148, 163, 184, 0.38)", color: "#cbd5e1" };
  return <span style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${palette.border}`, background: palette.background, color: palette.color, borderRadius: 999, padding: compact ? "3px 8px" : "5px 10px", fontSize: compact ? 11 : 12, fontWeight: 800, letterSpacing: 0.2, whiteSpace: "nowrap" }}>{status.replaceAll("_", " ")}</span>;
}
