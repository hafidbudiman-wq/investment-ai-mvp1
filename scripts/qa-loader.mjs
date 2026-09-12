import http from "node:http";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const port = Number(process.env.PORT || "8080");
const expectedSha = "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089";
const pdfPath = "/tmp/ICBP_billingual_30Jun25.pdf";
const maxBytes = 5 * 1024 * 1024;
let loading = false;

if (!process.env.DATABASE_URL) throw new Error("QA loader database configuration is incomplete.");

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

const uploadHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>ICBP QA Loader</title></head>
<body><main><h1>ICBP QA Loader</h1><p>One-shot loader. Only the approved SHA-256 is accepted.</p>
<form id="load"><input id="pdf" type="file" accept="application/pdf" required><button>Load approved ICBP PDF</button></form><pre id="result"></pre></main>
<script>document.getElementById("load").addEventListener("submit",async(e)=>{e.preventDefault();const f=document.getElementById("pdf").files[0];const o=document.getElementById("result");o.textContent="Loading...";const r=await fetch("/load-icbp",{method:"POST",headers:{"Content-Type":"application/pdf"},body:f});o.textContent=await r.text();});</script></body></html>`;

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end('{"status":"ok"}');
    return;
  }
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(uploadHtml);
    return;
  }
  if (request.method !== "POST" || request.url !== "/load-icbp") {
    response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end('{"error":"Not found"}');
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
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
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
