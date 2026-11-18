```javascript
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});


/*
 * ============================================================
 * FRONTEND
 * ============================================================
 */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/*
 * ============================================================
 * ROOT
 * ============================================================
 */

app.get("/", (req, res) => {
  res.status(200).json({
    name: "Zenith Proxy",
    status: "online",
    version: "3.1.0"
  });
});


/*
 * ============================================================
 * HEALTH CHECKS
 * ============================================================
 */

function healthResponse(req, res) {
  res.status(200).json({
    status: "ok",
    service: "zenith-proxy",
    version: "3.1.0",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
}

app.get("/health", healthResponse);
app.get("/healthz", healthResponse);
app.get("/api/health", healthResponse);


/*
 * ============================================================
 * PROXY SECURITY
 * ============================================================
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]"
]);


function isPrivateIPv4(hostname) {
  const parts = hostname
    .split(".")
    .map(Number);

  if (
    parts.length !== 4 ||
    parts.some(Number.isNaN)
  ) {
    return false;
  }

  const [a, b] = parts;

  if (a === 10) {
    return true;
  }

  if (
    a === 172 &&
    b >= 16 &&
    b <= 31
  ) {
    return true;
  }

  if (
    a === 192 &&
    b === 168
  ) {
    return true;
  }

  return false;
}


function isSafeTarget(target) {
  try {
    const url = new URL(target);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return false;
    }

    const hostname =
      url.hostname.toLowerCase();

    if (
      BLOCKED_HOSTS.has(hostname)
    ) {
      return false;
    }

    if (
      hostname ===
        "metadata.google.internal" ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }

    if (
      isPrivateIPv4(hostname)
    ) {
      return false;
    }

    return true;

  } catch {
    return false;
  }
}


/*
 * ============================================================
 * URL HELPERS
 * ============================================================
 */

function makeAbsoluteUrl(value, base) {
  try {
    return new URL(
      value,
      base
    ).href;
  } catch {
    return null;
  }
}


function makeProxyUrl(url) {
  return (
    "/proxy?url=" +
    encodeURIComponent(url)
  );
}


/*
 * ============================================================
 * HTML REWRITING
 * ============================================================
 */

function rewriteHtml(body, target) {

  const base =
    new URL(target).href;

  return body.replace(
    /(src|href|action)\s*=\s*(["'])(.*?)\2/gi,

    (match, attribute, quote, value) => {

      const original =
        String(value || "").trim();

      if (!original) {
        return match;
      }

      if (
        original.startsWith("#") ||
        original.startsWith("data:") ||
        original.startsWith("blob:") ||
        original.startsWith("javascript:") ||
        original.startsWith("mailto:") ||
        original.startsWith("tel:")
      ) {
        return match;
      }

      const
