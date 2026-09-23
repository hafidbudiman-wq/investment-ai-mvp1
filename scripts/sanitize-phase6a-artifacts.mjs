import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = process.argv[2] ?? "artifacts/phase6a";
const artifactNames = (await readdir(directory))
  .filter((name) => name.endsWith(".json"))
  .sort();

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;

  const keys = Object.keys(value);
  const isEvidence = keys.includes("pageNumber")
    && (keys.includes("snippetHash") || keys.includes("evidenceHash"));
  if (isEvidence) {
    return Object.fromEntries([
      "pageNumber",
      "printedPageLabel",
      "sourceType",
      "evidenceHash",
      "snippetHash",
      "locatorHash",
      "rowIndex",
      "columnIndex",
    ].filter((key) => value[key] !== undefined).map((key) => [key, sanitize(value[key])]));
  }

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "rawValue")
    .map(([key, child]) => [key, sanitize(child)]));
}

const checksums = [];
for (const name of artifactNames) {
  const path = join(directory, name);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  const serialized = `${JSON.stringify({
    ...sanitize(parsed),
    repositoryArtifactPolicy: "SANITIZED_METADATA_HASHES_ONLY",
  }, null, 2)}\n`;
  await writeFile(path, serialized, "utf8");
  checksums.push(`${createHash("sha256").update(serialized).digest("hex")}  ${name}`);
}

await writeFile(join(directory, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ directory, artifactNames, sanitized: true }, null, 2));
