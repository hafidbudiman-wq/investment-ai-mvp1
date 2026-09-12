import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const port = Number(process.env.PORT || "8080");
const upstream = new URL(process.env.QA_UPSTREAM || "");
const expectedUser = process.env.QA_BASIC_AUTH_USER || "";
const expectedPassword = process.env.QA_BASIC_AUTH_PASSWORD || "";

if (!upstream.hostname || !expectedUser || !expectedPassword) {
  throw new Error("QA gateway configuration is incomplete.");
}

function secureEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAuthorized(header) {
  if (!header || !header.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return secureEqual(decoded.slice(0, separator), expectedUser)
    && secureEqual(decoded.slice(separator + 1), expectedPassword);
}

const server = http.createServer((request, response) => {
  if (request.url === "/gateway-health") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end('{"status":"ok"}');
    return;
  }

  if (!isAuthorized(request.headers.authorization)) {
    response.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="InvestAI Phase 4 QA", charset="UTF-8"',
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });
    response.end('{"error":"Unauthorized"}');
    return;
  }

  const headers = { ...request.headers };
  delete headers.authorization;
  headers.host = upstream.host;
  headers["x-forwarded-proto"] = "https";

  const proxy = http.request({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port || 80,
    method: request.method,
    path: request.url,
    headers,
  }, (upstreamResponse) => {
    const outgoing = { ...upstreamResponse.headers };
    outgoing["cache-control"] = "private, no-store, max-age=0";
    outgoing["x-content-type-options"] = "nosniff";
    response.writeHead(upstreamResponse.statusCode || 502, outgoing);
    upstreamResponse.pipe(response);
  });

  proxy.on("error", (error) => {
    console.error("qa-gateway-upstream-error", error.code || "UNKNOWN");
    if (!response.headersSent) {
      response.writeHead(502, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
    }
    response.end('{"error":"QA upstream unavailable"}');
  });

  request.pipe(proxy);
});

server.listen(port, "0.0.0.0", () => {
  console.log("qa-gateway-ready");
});
