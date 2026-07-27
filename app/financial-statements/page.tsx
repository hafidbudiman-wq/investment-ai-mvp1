import { FinancialStatementsWorkspace } from "@/components/FinancialStatementsWorkspace";

export const dynamic = "force-dynamic";

export default function StatementsPage() {
  return (
    <>
      <div className="header">
        <div>
          <h1>Financial Statements</h1>
          <p>Pilih satu jalur input. PDF + AI diproses melalui staging dan human review sebelum boleh masuk canonical database.</p>
        </div>
      </div>

      <FinancialStatementsWorkspace />
    </>
  );
}
