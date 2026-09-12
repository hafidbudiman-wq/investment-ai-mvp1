import { chromium } from "playwright-core";

const base = process.env.QA_URL;
const user = process.env.QA_BASIC_AUTH_USER;
const password = process.env.QA_BASIC_AUTH_PASSWORD;
if (!base || !user || !password) throw new Error("QA smoke configuration incomplete");

const route = "/diagnostics/extraction-qa";
const apiRoute = "/api/diagnostics/extraction-qa?ticker=ICBP&year=2025&periodType=H1";
const auth = "Basic " + Buffer.from(user + ":" + password).toString("base64");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expectedPages = [4,5,6,7,8,9,10,86,88];

const browser = await chromium.launch({ headless: true });
try {
  const unauth = await browser.newContext();
  const unauthPage = await unauth.newPage();
  const unauthPageResponse = await unauthPage.goto(base + route, { waitUntil: "domcontentloaded" });
  const unauthApiResponse = await unauthPage.goto(base + apiRoute, { waitUntil: "domcontentloaded" });
  assert(unauthPageResponse?.status() === 401, "unauthorized page was not blocked");
  assert(unauthApiResponse?.status() === 401, "unauthorized API was not blocked");
  await unauth.close();

  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { Authorization: auth },
  });
  const page = await desktop.newPage();
  const health = await page.goto(base + "/api/health", { waitUntil: "domcontentloaded" });
  assert(health?.status() === 200, "health endpoint failed");

  const pageResponse = await page.goto(base + route, { waitUntil: "domcontentloaded" });
  assert(pageResponse?.status() === 200, "authorized QA page failed");
  await page.waitForFunction(() => document.querySelector(".qa-result-count")?.textContent?.includes("34 of 34 requirements"));
  assert(await page.locator(".qa-fact-card").count() === 34, "page did not render 34 facts");
  assert((await page.locator("body").innerText()).includes("ICBP · H1 2025"), "ICBP H1 2025 missing");

  const stateFilter = page.locator(".qa-filters select").first();
  await stateFilter.selectOption({ label: "NOT_DISCLOSED" });
  await page.waitForFunction(() => document.querySelector(".qa-result-count")?.textContent?.includes("5 of 34 requirements"));
  assert(await page.locator(".qa-fact-card").count() === 5, "state filter did not render 5 NOT_DISCLOSED facts");
  await stateFilter.selectOption({ label: "ALL" });
  await page.waitForFunction(() => document.querySelector(".qa-result-count")?.textContent?.includes("34 of 34 requirements"));

  const evidenceCard = page.locator(".qa-fact-card").filter({ has: page.locator(".qa-evidence") }).first();
  await evidenceCard.locator("summary").click();
  const evidence = evidenceCard.locator("details[open] .qa-evidence").first();
  await evidence.waitFor({ state: "visible" });
  assert((await evidence.innerText()).includes("Raw value"), "evidence inspector did not expose evidence");

  const api = await page.evaluate(async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, apiRoute);
  assert(api.status === 200, "authorized QA API failed");
  const data = api.body;
  assert(data?.facts?.length === 34, "API does not contain 34 facts");
  assert(new Set(data.facts.map((fact) => fact.requirementId)).size === 34, "requirement IDs are not unique");
  assert(JSON.stringify(data.summary.selectedPages) === JSON.stringify(expectedPages), "selected pages mismatch");
  assert(data.summary.documentPages === 109, "page count mismatch");
  assert(data.summary.valueZeroCount === 28, "VALUE/ZERO mismatch");
  assert(data.summary.notApplicableCount === 1, "NOT_APPLICABLE mismatch");
  assert(data.summary.notDisclosedCount === 5, "NOT_DISCLOSED mismatch");
  assert(data.summary.missingCount === 0 && data.summary.ambiguousCount === 0 && data.summary.conflictCount === 0, "semantic error counts mismatch");
  assert(data.summary.providerCalls === 0 && data.summary.inputTokens === 0 && data.summary.outputTokens === 0 && Number(data.summary.apiCostUsd) === 0, "provider usage was nonzero");
  const requiredFactKeys = ["requirementId","state","value","rawValue","currency","unitType","scale","period","origin","statement","sourcePage","readConfidence","mappingConfidence","legacyComparison","lineage","evidence","source"];
  assert(data.facts.every((fact) => requiredFactKeys.every((key) => Object.hasOwn(fact, key))), "QA fact fields incomplete");
  const requiredEvidenceKeys = ["pdfPage","rowLabel","columnLabel","rawValue","snippet","snippetHash","evidenceHash","locatorHash"];
  assert(data.facts.flatMap((fact) => fact.evidence).every((item) => requiredEvidenceKeys.every((key) => Object.hasOwn(item, key))), "QA evidence fields incomplete");
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    extraHTTPHeaders: { Authorization: auth },
  });
  const mobilePage = await mobile.newPage();
  const mobileResponse = await mobilePage.goto(base + route, { waitUntil: "domcontentloaded" });
  assert(mobileResponse?.status() === 200, "mobile QA page failed");
  await mobilePage.waitForFunction(() => document.querySelector(".qa-result-count")?.textContent?.includes("34 of 34 requirements"));
  const mobileLayout = await mobilePage.evaluate(() => ({
    viewport: window.innerWidth,
    bodyWidth: document.body.scrollWidth,
    factsColumns: getComputedStyle(document.querySelector(".qa-facts")).gridTemplateColumns.split(" ").length,
    summaryColumns: getComputedStyle(document.querySelector(".qa-summary")).gridTemplateColumns.split(" ").length,
    queryColumns: getComputedStyle(document.querySelector(".qa-query")).gridTemplateColumns.split(" ").length,
  }));
  assert(mobileLayout.viewport === 390, "mobile viewport mismatch");
  assert(mobileLayout.bodyWidth <= 390, "mobile horizontal overflow");
  assert(mobileLayout.factsColumns === 1 && mobileLayout.summaryColumns === 1 && mobileLayout.queryColumns === 1, "mobile responsive columns failed");
  await mobile.close();

  console.log(JSON.stringify({
    status: "passed",
    unauthorized: { page: 401, api: 401 },
    health: 200,
    authorized: { page: 200, api: 200 },
    dataset: {
      ticker: data.summary.ticker,
      period: data.summary.period,
      documentPages: data.summary.documentPages,
      selectedPages: data.summary.selectedPages,
      requirements: data.facts.length,
      valueZero: data.summary.valueZeroCount,
      notApplicable: data.summary.notApplicableCount,
      notDisclosed: data.summary.notDisclosedCount,
      missing: data.summary.missingCount,
      ambiguous: data.summary.ambiguousCount,
      conflict: data.summary.conflictCount,
    },
    ui: { filterNotDisclosed: 5, evidenceInspector: "passed", mobile: mobileLayout },
    provider: {
      calls: data.summary.providerCalls,
      inputTokens: data.summary.inputTokens,
      outputTokens: data.summary.outputTokens,
      costUsd: data.summary.apiCostUsd,
    },
    apiFields: "complete",
  }));
} finally {
  await browser.close();
}
