import { notFound } from "next/navigation";
import { ExtractionQaPanel } from "@/components/ExtractionQaPanel";
import { getPlatformFeatureFlags } from "@/lib/platform/feature-flags";

export const dynamic = "force-dynamic";

export default function ExtractionQaPage() {
  if (!getPlatformFeatureFlags().investaiExtractionQa) notFound();
  return <ExtractionQaPanel />;
}
