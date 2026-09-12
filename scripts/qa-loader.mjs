import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const port = Number(process.env.PORT || "8080");
const expectedToken = process.env.QA_LOAD_TOKEN || "";
const expectedSha = "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089";
const pdfPath = "/tmp/ICBP_billingual_30Jun25.pdf";
const maxBytes = 5 * 1024 * 1024;
let loading = false;

if (!expectedToken || !process.env.DATABASE_URL) {
  throw new Error("QA loader configuration is incomplete.");
}

function secureEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorized(header) {
  return Boolean(header?.startsWith("Bearer "))
    && secureEqual(header.slice(7), expectedToken);
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: "/app",
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(command + " exited " + code)));
  });
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end('{"status":"ok"}');
    return;
  }
  if (request.method !== "POST" || request.url !== "/load-icbp") {
    response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end('{"error":"Not found"}');
    return;
  }
  if (!authorized(request.headers.authorization)) {
    response.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end('{"error":"Unauthorized"}');
    return;
  }
  if (loading) {
    response.writeHead(409, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end('{"error":"Load already in progress"}');
    return;
  }

  loading = true;
  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > maxBytes) request.destroy(new Error("Payload too large"));
    else chunks.push(chunk);
  });
  request.on("error", () => {
    if (!response.headersSent) response.writeHead(413, { "Content-Type": "application/json" });
    response.end('{"error":"Invalid payload"}');
    loading = false;
  });
  request.on("end", async () => {
    try {
      const bytes = Buffer.concat(chunks);
      const sha = createHash("sha256").update(bytes).digest("hex");
      if (sha !== expectedSha) throw new Error("Unexpected ICBP SHA-256");
      await writeFile(pdfPath, bytes, { mode: 0o400 });
      console.log("qa-load-step migration");
      await run("npm", ["run", "db:deploy"]);
      console.log("qa-load-step phase4-acceptance");
      await run("npm", ["run", "test:p0a:phase4-roundtrip"], { P0A_ICBP_PDF_PATH: pdfPath });
      console.log("qa-load-step seed");
      await run("npm", ["run", "db:seed"]);
      console.log("qa-load-complete", expectedSha);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify({ status: "loaded", sha256: expectedSha }));
      server.close(() => process.exit(0));
    } catch (error) {
      console.error("qa-load-failed", error instanceof Error ? error.message : "unknown");
      response.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end('{"error":"QA load failed"}');
      loading = false;
    }
  });
});

server.listen(port, "0.0.0.0", () => console.log("qa-loader-ready"));
