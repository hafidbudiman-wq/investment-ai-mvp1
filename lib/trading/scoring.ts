export type TradingCandidate = {
  ticker: string;
  name: string;
  sector: string;
  shariaStatus: "DES" | "NON_DES" | "UNKNOWN";
  catalystScore: number;
  technicalScore: number;
  volumeScore: number;
  brokerFlowScore: number;
  liquidityScore: number;
  riskReward: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  target1: number;
  target2: number;
  timeStopDays: number;
  note: string;
};

export type TradingAssessment = TradingCandidate & {
  score: number;
  status: "READY" | "WAIT" | "WATCH" | "AVOID";
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function scoreCandidate(candidate: TradingCandidate): TradingAssessment {
  const rrScore = clamp((candidate.riskReward / 3) * 100);
  const score = Math.round(
    candidate.catalystScore * 0.2 +
      candidate.technicalScore * 0.25 +
      candidate.volumeScore * 0.15 +
      candidate.brokerFlowScore * 0.2 +
      candidate.liquidityScore * 0.1 +
      rrScore * 0.1,
  );

  let status: TradingAssessment["status"] = "AVOID";
  if (candidate.riskReward >= 2 && score >= 78) status = "READY";
  else if (candidate.riskReward >= 1.7 && score >= 68) status = "WAIT";
  else if (score >= 55) status = "WATCH";

  return { ...candidate, score, status };
}
