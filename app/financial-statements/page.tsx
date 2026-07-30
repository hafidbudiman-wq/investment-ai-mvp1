import { FinancialStatementsWorkspace } from "@/components/FinancialStatementsWorkspace";
import { getPlatformFeatureFlags } from "@/lib/platform/feature-flags";

export const dynamic = "force-dynamic";

export default function StatementsPage() {
  const flags = getPlatformFeatureFlags();
  return (
    <>
      <div className="header">
        <div>
          <h1>Financial Statements</h1>
          <p>Pilih satu jalur input. PDF + AI diproses melalui staging dan human review sebelum boleh masuk canonical database.</p>
        </div>
      </div>

      <FinancialStatementsWorkspace pdfUploadV2={flags.pdfUploadV2} />
    </>
  );
}
