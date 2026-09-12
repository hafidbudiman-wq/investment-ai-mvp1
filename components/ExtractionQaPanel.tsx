"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ExtractionQaFact,
  ExtractionQaReadModel,
} from "@/lib/financial/p0a/compatibility-read";

const ALL = "ALL";

function ShortHash({ value }: { value: string }) {
  return <code title={value}>{value.slice(0, 12)}…</code>;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return <div className="qa-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function FactCard({ fact }: { fact: ExtractionQaFact }) {
  return (
    <article className="qa-fact-card">
      <header>
        <div>
          <code>{fact.code}</code>
          <h2>{fact.name}</h2>
          <small className="qa-requirement-id">{fact.requirementId}</small>
        </div>
        <span className={"qa-state qa-state-" + fact.state.toLowerCase()}>{fact.state}</span>
      </header>

      <p className="qa-definition">{fact.definition}</p>
      <dl className="qa-fact-grid">
        <div><dt>Value</dt><dd>{fact.value ?? "—"}</dd></div>
        <div><dt>Currency / unit / scale</dt><dd>{(fact.currency ?? "—") + " / " + fact.unitType + " / " + (fact.scale ?? "—")}</dd></div>
        <div><dt>Origin</dt><dd>{fact.origin ?? "—"}</dd></div>
        <div><dt>Statement</dt><dd>{fact.statement}</dd></div>
        <div><dt>Period / scope</dt><dd>{fact.period.type} · {fact.period.end} · {fact.period.consolidationScope}</dd></div>
        <div><dt>Source</dt><dd>{fact.source} · page {fact.sourcePage ?? "—"}</dd></div>
        <div><dt>Confidence</dt><dd>read {fact.readConfidence ?? "—"} · map {fact.mappingConfidence ?? "—"}</dd></div>
        <div><dt>Evidence</dt><dd>{fact.evidenceStatus}</dd></div>
        <div>
          <dt>Legacy</dt>
          <dd className={fact.legacyComparison === "DIFFERENT" ? "danger" : ""}>{fact.legacyComparison}</dd>
        </div>
      </dl>

      {fact.standardizedAlternativeAvailable && (
        <p className="qa-note">
          A standardized aggregate existed transiently; the reported scalar remains NOT_DISCLOSED.
        </p>
      )}
      <p className="qa-legacy-reason">
        {fact.legacyComparisonReason}
        {fact.legacyValue !== null ? " Legacy value: " + fact.legacyValue : ""}
      </p>

      <details>
        <summary>Evidence inspector ({fact.evidence.length})</summary>
        {fact.evidence.length === 0 ? (
          <p>No persisted evidence for this semantic state.</p>
        ) : fact.evidence.map((item, index) => (
          <div className="qa-evidence" key={item.evidenceHash + "-" + index}>
            <b>PDF {item.pdfPage}{item.printedPage ? " · printed " + item.printedPage : ""}</b>
            <dl>
              <div><dt>Row</dt><dd>{item.rowLabel}</dd></div>
              <div><dt>Column</dt><dd>{item.columnLabel}</dd></div>
              <div><dt>Raw value</dt><dd>{item.rawValue}</dd></div>
            </dl>
            <p>{item.snippet}</p>
            <small>Evidence <ShortHash value={item.evidenceHash} /> · locator <ShortHash value={item.locatorHash} /></small>
          </div>
        ))}
      </details>
    </article>
  );
}

export function ExtractionQaPanel() {
  const [data, setData] = useState<ExtractionQaReadModel | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState("ICBP");
  const [year, setYear] = useState("2025");
  const [periodType, setPeriodType] = useState("H1");
  const [query, setQuery] = useState({ ticker: "ICBP", year: "2025", periodType: "H1" });
  const [stateFilter, setStateFilter] = useState(ALL);
  const [statementFilter, setStatementFilter] = useState(ALL);
  const [originFilter, setOriginFilter] = useState(ALL);
  const [sourceFilter, setSourceFilter] = useState(ALL);
  const [legacyDifferenceOnly, setLegacyDifferenceOnly] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const search = new URLSearchParams(query);
        const response = await fetch("/api/diagnostics/extraction-qa?" + search.toString(), {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Extraction QA read failed.");
        setData(payload);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setData(null);
        setError(caught instanceof Error ? caught.message : "Extraction QA read failed.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [query]);

  const filteredFacts = useMemo(() => (data?.facts ?? []).filter((fact) =>
    (stateFilter === ALL || fact.state === stateFilter)
    && (statementFilter === ALL || fact.statement === statementFilter)
    && (originFilter === ALL || (fact.origin ?? "NONE") === originFilter)
    && (sourceFilter === ALL || fact.source === sourceFilter)
    && (!legacyDifferenceOnly || fact.legacyComparison === "DIFFERENT")
  ), [data, legacyDifferenceOnly, originFilter, sourceFilter, stateFilter, statementFilter]);

  const values = (key: "state" | "statement" | "origin" | "source") =>
    [...new Set((data?.facts ?? []).map((fact) => key === "origin" ? fact.origin ?? "NONE" : fact[key]))].sort();

  return (
    <main className="qa-page">
      <div className="section-title">
        <div>
          <h1>Extraction QA</h1>
          <p>Read-only inspection of P0-A shadow facts, semantic states, evidence, and legacy comparability.</p>
        </div>
        <span className="qa-shadow-badge">SHADOW ONLY</span>
      </div>

      <form className="qa-query" onSubmit={(event) => {
        event.preventDefault();
        setQuery({ ticker, year, periodType });
      }}>
        <label>Ticker<input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} /></label>
        <label>Year<input inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value)} /></label>
        <label>Period
          <select value={periodType} onChange={(event) => setPeriodType(event.target.value)}>
            {["Q1", "H1", "Q3", "FY", "MONTHLY"].map((period) => <option key={period}>{period}</option>)}
          </select>
        </label>
        <button className="btn" type="submit" disabled={loading}>{loading ? "Loading…" : "Load"}</button>
      </form>

      {error && <div className="callout">{error}</div>}
      {data && (
        <>
          <section className="qa-summary">
            <SummaryCard label="Company" value={data.summary.ticker + " · " + data.summary.period} />
            <SummaryCard label="Document pages" value={data.summary.documentPages} />
            <SummaryCard label="Selected pages" value={data.summary.selectedPages.join(", ")} />
            <SummaryCard label="VALUE / ZERO" value={data.summary.valueZeroCount} />
            <SummaryCard label="NOT_APPLICABLE" value={data.summary.notApplicableCount} />
            <SummaryCard label="NOT_DISCLOSED" value={data.summary.notDisclosedCount} />
            <SummaryCard label="MISSING" value={data.summary.missingCount} />
            <SummaryCard label="AMBIGUOUS" value={data.summary.ambiguousCount} />
            <SummaryCard label="CONFLICT" value={data.summary.conflictCount} />
            <SummaryCard label="Provider calls" value={data.summary.providerCalls} />
            <SummaryCard label="Tokens" value={data.summary.inputTokens + data.summary.outputTokens} />
            <SummaryCard label="API cost" value={"US$" + data.summary.apiCostUsd} />
            <SummaryCard label="Native latency" value={data.summary.nativeLatencyMs + " ms"} />
            <SummaryCard label="Persistence" value={data.summary.shadowOnly ? "SHADOW ONLY" : "UNSAFE STATUS"} />
            <SummaryCard label="Routing history" value={data.summary.routingClassificationStatus} />
          </section>

          <section className="qa-identity card">
            <b>{data.summary.company}</b>
            <span>Pass {data.summary.passId}</span>
            <span>Revision {data.summary.reportRevisionId}</span>
            <span>Router {data.versions.routerVersion}</span>
          </section>

          <section className="qa-filters card">
            <label>State<select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option>{ALL}</option>{values("state").map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Statement<select value={statementFilter} onChange={(event) => setStatementFilter(event.target.value)}><option>{ALL}</option>{values("statement").map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Origin<select value={originFilter} onChange={(event) => setOriginFilter(event.target.value)}><option>{ALL}</option>{values("origin").map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Source<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option>{ALL}</option>{values("source").map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="qa-checkbox"><input type="checkbox" checked={legacyDifferenceOnly} onChange={(event) => setLegacyDifferenceOnly(event.target.checked)} /> Legacy difference only</label>
          </section>

          <p className="qa-result-count">{filteredFacts.length} of {data.facts.length} requirements</p>
          <section className="qa-facts">{filteredFacts.map((fact) => <FactCard fact={fact} key={fact.requirementId} />)}</section>
        </>
      )}
    </main>
  );
}
